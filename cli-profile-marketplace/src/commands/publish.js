import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { existsSync, readFileSync, mkdirSync, cpSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { getConfig, updateConfig, getProfilePath } from '../utils/config.js';
import { readProfileMetadata } from '../utils/snapshot.js';

/**
 * Publish a local profile to the marketplace
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
  
  console.log('');
  console.log(chalk.bold('Publish Profile to Marketplace'));
  console.log(chalk.dim('─'.repeat(50)));
  console.log('');
  
  // Get GitHub username
  let gitUsername;
  try {
    gitUsername = execSync('git config user.name', { encoding: 'utf-8' }).trim();
  } catch {
    gitUsername = '';
  }
  
  // Gather publication info
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'author',
      message: 'Your GitHub username:',
      default: gitUsername,
      validate: (input) => {
        if (!input || !/^[a-z0-9-]+$/i.test(input)) {
          return 'Please enter a valid GitHub username';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'description',
      message: 'Profile description:',
      default: metadata.description || '',
      validate: (input) => input.length >= 10 || 'Description must be at least 10 characters'
    },
    {
      type: 'input',
      name: 'tags',
      message: 'Tags (comma-separated):',
      default: metadata.tags?.join(', ') || '',
      filter: (input) => input.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    },
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Ready to publish?',
      default: true
    }
  ]);
  
  if (!answers.confirm) {
    console.log(chalk.yellow('Aborted.'));
    process.exit(0);
  }
  
  const config = await getConfig();
  
  console.log('');
  console.log(chalk.bold('📦 Publishing Profile'));
  console.log('');
  console.log(chalk.dim('To publish your profile, you need to:'));
  console.log('');
  console.log(chalk.cyan('1.') + ' Fork the marketplace repository:');
  console.log(chalk.dim(`   https://github.com/${config.marketplaceRepo}`));
  console.log('');
  console.log(chalk.cyan('2.') + ' Clone your fork locally:');
  console.log(chalk.dim(`   git clone https://github.com/${answers.author}/claude-profile-marketplace`));
  console.log('');
  console.log(chalk.cyan('3.') + ' Copy your profile to the profiles directory:');
  
  const targetDir = `profiles/${answers.author}/${name}`;
  console.log(chalk.dim(`   mkdir -p ${targetDir}`));
  console.log(chalk.dim(`   cp -r ~/.claude-profiles/${name}/* ${targetDir}/`));
  console.log('');
  console.log(chalk.cyan('4.') + ' Update the profile metadata:');
  console.log(chalk.dim(`   Edit ${targetDir}/profile.json`));
  console.log('');
  console.log(chalk.cyan('5.') + ' Commit and push:');
  console.log(chalk.dim(`   git add .`));
  console.log(chalk.dim(`   git commit -m "Add profile: ${answers.author}/${name}"`));
  console.log(chalk.dim(`   git push origin main`));
  console.log('');
  console.log(chalk.cyan('6.') + ' Open a Pull Request on GitHub');
  console.log('');
  
  // Offer to prepare the files
  const { prepare } = await inquirer.prompt([{
    type: 'confirm',
    name: 'prepare',
    message: 'Would you like me to prepare the files for you?',
    default: true
  }]);
  
  if (prepare) {
    const exportDir = join(process.cwd(), 'publish-ready', answers.author, name);
    mkdirSync(exportDir, { recursive: true });
    
    // Copy profile files
    cpSync(profilePath, exportDir, { recursive: true });
    
    // Update metadata with author info
    const updatedMetadata = {
      ...metadata,
      author: answers.author,
      description: answers.description,
      tags: answers.tags,
      publishedAt: new Date().toISOString()
    };
    
    writeFileSync(
      join(exportDir, 'profile.json'),
      JSON.stringify(updatedMetadata, null, 2)
    );
    
    console.log('');
    console.log(chalk.green('✓ Files prepared at:'));
    console.log(chalk.cyan(`  ${exportDir}`));
    console.log('');
    console.log(chalk.dim('Copy these files to your fork of the marketplace repository.'));
  }
  
  console.log('');
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
    // Try to fetch the index to validate
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
