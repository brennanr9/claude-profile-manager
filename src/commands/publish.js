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
  createGitHubIssue,
  getCredentialSetupInstructions
} from '../utils/auth.js';

const MAX_ISSUE_BODY_LENGTH = 65535;

/**
 * Build the GitHub issue body for a profile submission.
 */
function buildIssueBody(author, name, metadata, snapshotBase64) {
  return [
    '## Profile Submission',
    '',
    `**Author:** ${author}`,
    `**Name:** ${name}`,
    `**Version:** ${metadata.version || '1.0.0'}`,
    '',
    '### Metadata',
    '```json',
    JSON.stringify(metadata, null, 2),
    '```',
    '',
    '### Snapshot',
    '```',
    snapshotBase64,
    '```'
  ].join('\n');
}

/**
 * Publish a local profile to the marketplace via GitHub Issues.
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

  // Get GitHub token from Git Credential Manager
  const spinner = ora('Checking GitHub credentials...').start();
  const token = getGitHubToken();

  if (!token) {
    spinner.fail(chalk.red('Could not find cached GitHub credentials.'));
    console.log(chalk.dim(getCredentialSetupInstructions()));
    process.exit(1);
  }

  // Get GitHub username from token
  let author;
  try {
    author = await getGitHubUsername(token);
    spinner.succeed(chalk.green(`Authenticated as ${chalk.bold(author)}`));
  } catch (error) {
    spinner.fail(chalk.red(error.message));
    process.exit(1);
  }

  // Read snapshot
  const snapshotPath = join(profilePath, 'snapshot.zip');
  if (!existsSync(snapshotPath)) {
    console.log(chalk.red('✗ Profile snapshot not found.'));
    process.exit(1);
  }

  const snapshotBuffer = readFileSync(snapshotPath);
  const snapshotBase64 = snapshotBuffer.toString('base64');

  // Show profile summary
  console.log('');
  console.log(chalk.cyan('  Name:    ') + name);
  console.log(chalk.cyan('  Version: ') + (metadata.version || '1.0.0'));
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

  // Update metadata with author
  const publishMetadata = {
    ...metadata,
    author,
    publishedAt: new Date().toISOString()
  };

  // Build issue body and check size
  const issueBody = buildIssueBody(author, name, publishMetadata, snapshotBase64);

  if (issueBody.length > MAX_ISSUE_BODY_LENGTH) {
    console.log(chalk.red('✗ Profile is too large to publish via GitHub Issues.'));
    console.log(chalk.dim(`  Payload: ${(issueBody.length / 1024).toFixed(0)}KB (max ~64KB)`));
    console.log(chalk.dim('  Try removing unnecessary files from the profile.'));
    process.exit(1);
  }

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

  // Create the issue
  const config = await getConfig();
  const publishSpinner = ora('Submitting profile to marketplace...').start();

  try {
    const issue = await createGitHubIssue(
      token,
      config.marketplaceRepo,
      `[profile-submission] ${author}/${name}`,
      issueBody,
      ['profile-submission']
    );

    publishSpinner.succeed(chalk.green('Submission created!'));
    console.log('');
    console.log(chalk.cyan('  Issue: ') + issue.html_url);
    console.log('');
    console.log(chalk.dim('A maintainer will review your profile. You\'ll be notified when the PR is ready.'));
    console.log('');
  } catch (error) {
    publishSpinner.fail(chalk.red(`Submission failed: ${error.message}`));
    process.exit(1);
  }
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
