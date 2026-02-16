import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getConfig, updateConfig, getProfilePath } from '../utils/config.js';
import { readProfileMetadata } from '../utils/snapshot.js';
import {
  getGitHubToken,
  getGitHubUsername,
  createProfilePR,
  fetchRepoIndex,
  getCredentialSetupInstructions,
  authenticateWithDeviceFlow
} from '../utils/auth.js';

/**
 * Publish a local profile to the marketplace via a direct PR.
 * Falls back to OAuth device flow if git credentials lack access.
 */
export async function publishProfile(name, options) {
  const profilePath = getProfilePath(name);

  if (!existsSync(profilePath)) {
    console.log(chalk.red(`✗ Profile not found: ${name}`));
    console.log(chalk.dim('  List local profiles with: cpm local'));
    process.exit(1);
  }

  const metadata = readProfileMetadata(name);

  if (!metadata) {
    console.log(chalk.red('✗ Invalid profile: missing metadata'));
    process.exit(1);
  }

  // Check for functional content
  const contents = metadata.contents || {};
  const hasContent = Object.values(contents).some(items => items && items.length > 0);
  if (!hasContent) {
    console.log(chalk.red('✗ Profile has no functional content (commands, hooks, skills, etc.)'));
    console.log(chalk.dim('  Profiles must contain at least one functional customization.'));
    process.exit(1);
  }

  console.log('');
  console.log(chalk.bold('Publish Profile to Marketplace'));
  console.log(chalk.dim('─'.repeat(50)));
  console.log('');

  // --- Auth: try git credentials first, device flow as fallback ---
  const spinner = ora('Checking GitHub credentials...').start();
  let token = getGitHubToken();
  let useFork = false;

  if (!token) {
    spinner.warn(chalk.yellow('No cached GitHub credentials found.'));
    console.log(chalk.dim('  Falling back to browser authentication...'));
    token = await authenticateWithDeviceFlow();
    useFork = true;
  } else {
    spinner.succeed(chalk.green('Found GitHub credentials.'));
  }

  // Get GitHub username
  let author;
  const userSpinner = ora('Verifying identity...').start();
  try {
    author = await getGitHubUsername(token);
    userSpinner.succeed(chalk.green(`Authenticated as ${chalk.bold(author)}`));
  } catch (error) {
    userSpinner.fail(chalk.red(error.message));
    process.exit(1);
  }

  // Read snapshot
  const snapshotPath = join(profilePath, 'snapshot.zip');
  if (!existsSync(snapshotPath)) {
    console.log(chalk.red('✗ Profile snapshot not found.'));
    process.exit(1);
  }

  const snapshotBuffer = readFileSync(snapshotPath);

  // Show profile summary
  console.log('');
  console.log(chalk.cyan('  Name:    ') + name);
  console.log(chalk.cyan('  Version: ') + (metadata.version || '1.0.0'));
  console.log(chalk.cyan('  Size:    ') + `${(snapshotBuffer.length / 1024).toFixed(1)}KB`);
  if (metadata.description) {
    console.log(chalk.cyan('  Desc:    ') + metadata.description);
  }

  // Show contents
  for (const [category, items] of Object.entries(contents)) {
    if (items && items.length > 0) {
      const display = category === 'commands'
        ? items.map(i => `/${i}`).join(', ')
        : items.join(', ');
      console.log(chalk.cyan(`  ${category}: `) + chalk.dim(display));
    }
  }
  console.log('');

  // Confirm
  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: `Publish ${chalk.cyan(author + '/' + name)} to the marketplace?`,
    default: true
  }]);

  if (!confirm) {
    console.log(chalk.yellow('Aborted.'));
    process.exit(0);
  }

  const config = await getConfig();

  // --- Publish with retry on 403 ---
  await attemptPublish(token, config, { author, name, metadata, snapshotBuffer, useFork });
}

/**
 * Attempt to publish. On 403 (insufficient token scope), fall back to
 * OAuth device flow and retry with a fork-based PR.
 */
async function attemptPublish(token, config, { author, name, metadata, snapshotBuffer, useFork }) {
  const publishSpinner = ora('Creating pull request...').start();

  try {
    const pr = await doPublish(token, config, { author, name, metadata, snapshotBuffer, useFork });
    publishSpinner.succeed(chalk.green('Pull request created!'));
    console.log('');
    console.log(chalk.cyan('  PR: ') + pr.html_url);
    console.log('');
    console.log(chalk.dim('A maintainer will review and merge your profile.'));
    console.log('');
  } catch (error) {
    // If the error is a 403, the token lacks write access to the marketplace repo.
    // Fall back to OAuth device flow + fork-based PR.
    if (error.message.includes('403') && !useFork) {
      publishSpinner.warn(chalk.yellow('Credentials lack write access to marketplace repo.'));
      console.log(chalk.dim('  Falling back to browser authentication...'));
      console.log('');

      const deviceToken = await authenticateWithDeviceFlow();

      const retrySpinner = ora('Retrying with fork-based PR...').start();
      try {
        const pr = await doPublish(deviceToken, config, { author, name, metadata, snapshotBuffer, useFork: true });
        retrySpinner.succeed(chalk.green('Pull request created!'));
        console.log('');
        console.log(chalk.cyan('  PR: ') + pr.html_url);
        console.log('');
        console.log(chalk.dim('A maintainer will review and merge your profile.'));
        console.log('');
      } catch (retryError) {
        retrySpinner.fail(chalk.red(`Publish failed: ${retryError.message}`));
        process.exit(1);
      }
    } else {
      publishSpinner.fail(chalk.red(`Publish failed: ${error.message}`));
      process.exit(1);
    }
  }
}

/**
 * Core publish logic: fetch index, prepare metadata, create PR.
 */
async function doPublish(token, config, { author, name, metadata, snapshotBuffer, useFork }) {
  // Fetch current index
  const index = await fetchRepoIndex(token, config.marketplaceRepo);

  // Update metadata with author
  const publishMetadata = {
    ...metadata,
    author,
    publishedAt: new Date().toISOString()
  };

  // Update index: remove existing entry for this author/name, add new one
  index.profiles = (index.profiles || []).filter(
    p => !(p.author === author && p.name === name)
  );
  index.profiles.push({
    name,
    author,
    version: publishMetadata.version || '1.0.0',
    description: publishMetadata.description || '',
    tags: publishMetadata.tags || [],
    downloads: 0,
    stars: 0,
    createdAt: publishMetadata.publishedAt,
    contents: publishMetadata.contents || {}
  });
  index.lastUpdated = new Date().toISOString();

  // Create the PR
  const pr = await createProfilePR(token, config.marketplaceRepo, {
    author,
    name,
    profileJson: JSON.stringify(publishMetadata, null, 2),
    snapshotBuffer,
    indexUpdate: JSON.stringify(index, null, 2)
  }, { useFork });

  return pr;
}

/**
 * Set a custom marketplace repository
 */
export async function setRepository(repository) {
  // Validate format
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/i.test(repository)) {
    console.log(chalk.red('✗ Invalid repository format. Use: owner/repo'));
    process.exit(1);
  }

  const spinner = ora('Validating repository...').start();

  try {
    const { default: fetch } = await import('node-fetch');

    const response = await fetch(
      `https://raw.githubusercontent.com/${repository}/main/index.json`
    );

    if (!response.ok && response.status !== 404) {
      throw new Error(`Repository not accessible: ${response.status}`);
    }

    await updateConfig({ marketplaceRepo: repository });

    spinner.succeed(chalk.green(`Repository set to: ${chalk.bold(repository)}`));
    console.log('');
    console.log(chalk.dim('Browse profiles with: ') + chalk.cyan('cpm list'));

  } catch (error) {
    spinner.fail(chalk.red(`Failed to set repository: ${error.message}`));
    process.exit(1);
  }
}