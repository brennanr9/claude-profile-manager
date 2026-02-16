import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { existsSync, rmSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { 
  createSnapshot, 
  extractSnapshot, 
  readProfileMetadata,
  listLocalProfileNames 
} from '../utils/snapshot.js';
import { getConfig, claudeDirExists, getProfilePath } from '../utils/config.js';

/**
 * Save current .claude folder as a profile
 */
export async function saveProfile(name, options) {
  // Validate name
  if (!/^[a-z0-9][a-z0-9-_]*[a-z0-9]$|^[a-z0-9]$/i.test(name)) {
    console.log(chalk.red('✗ Invalid profile name. Use alphanumeric characters, hyphens, and underscores.'));
    process.exit(1);
  }
  
  if (!claudeDirExists()) {
    console.log(chalk.red('✗ Claude directory (.claude) not found.'));
    console.log(chalk.dim('  Make sure Claude CLI is installed and configured.'));
    process.exit(1);
  }
  
  const spinner = ora('Creating profile snapshot...').start();
  
  try {
    const result = await createSnapshot(name, options);
    spinner.succeed(chalk.green(`Profile saved: ${chalk.bold(name)}`));
    
    console.log('');
    console.log(chalk.dim('  Location: ') + result.profileDir);
    console.log(chalk.dim('  Files:    ') + result.metadata.files.length);
    
    if (options.description) {
      console.log(chalk.dim('  Desc:     ') + options.description);
    }
    
    console.log('');
    console.log(chalk.dim('Load this profile anytime with:'));
    console.log(chalk.cyan(`  cpm load ${name}`));
    
  } catch (error) {
    spinner.fail(chalk.red(`Failed to save profile: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Load a local profile
 */
export async function loadProfile(name, options) {
  const profilePath = getProfilePath(name);
  
  if (!existsSync(profilePath)) {
    console.log(chalk.red(`✗ Profile not found: ${name}`));
    console.log(chalk.dim('  List local profiles with: cpm local'));
    console.log(chalk.dim('  Browse marketplace with:  cpm list'));
    process.exit(1);
  }
  
  const metadata = readProfileMetadata(name);
  
  // Show profile info
  console.log('');
  console.log(chalk.bold('Profile: ') + chalk.cyan(name));
  if (metadata?.description) {
    console.log(chalk.dim(metadata.description));
  }
  console.log('');
  
  // Confirm if .claude exists and no force flag
  if (claudeDirExists() && !options.force) {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: 'This will replace your current .claude configuration. Continue?',
      default: false
    }]);
    
    if (!confirm) {
      console.log(chalk.yellow('Aborted.'));
      process.exit(0);
    }
    
    // Ask about backup
    if (!options.backup) {
      const { backup } = await inquirer.prompt([{
        type: 'confirm', 
        name: 'backup',
        message: 'Backup current .claude folder first?',
        default: true
      }]);
      options.backup = backup;
    }
    
    options.force = true;
  }
  
  const spinner = ora('Loading profile...').start();
  
  try {
    const result = await extractSnapshot(name, options);
    spinner.succeed(chalk.green(`Profile loaded: ${chalk.bold(name)}`));
    
    if (options.backup) {
      console.log(chalk.dim('  Previous config backed up'));
    }
    
    console.log('');
    console.log(chalk.green('✓ Your Claude CLI is now configured with this profile.'));
    
  } catch (error) {
    spinner.fail(chalk.red(`Failed to load profile: ${error.message}`));
    process.exit(1);
  }
}

/**
 * List all locally saved profiles
 */
export async function listLocalProfiles() {
  const profiles = listLocalProfileNames();
  
  console.log('');
  console.log(chalk.bold('Local Profiles'));
  console.log(chalk.dim('─'.repeat(50)));
  
  if (profiles.length === 0) {
    console.log('');
    console.log(chalk.dim('  No local profiles found.'));
    console.log('');
    console.log(chalk.dim('  Save your current config:  ') + chalk.cyan('cpm save <n>'));
    console.log(chalk.dim('  Browse marketplace:        ') + chalk.cyan('cpm list'));
    console.log('');
    return;
  }
  
  console.log('');
  
  for (const name of profiles) {
    const metadata = readProfileMetadata(name);
    
    console.log(chalk.cyan('  ' + name));
    
    if (metadata) {
      if (metadata.description) {
        console.log(chalk.dim(`    ${metadata.description}`));
      }
      
      const info = [];
      if (metadata.tags?.length) {
        info.push(chalk.yellow(metadata.tags.join(', ')));
      }
      if (metadata.createdAt) {
        const date = new Date(metadata.createdAt).toLocaleDateString();
        info.push(chalk.dim(date));
      }
      if (metadata.files?.length) {
        info.push(chalk.dim(`${metadata.files.length} files`));
      }
      
      if (info.length) {
        console.log(`    ${info.join(' • ')}`);
      }
    }
    
    console.log('');
  }
  
  console.log(chalk.dim('Commands:'));
  console.log(chalk.dim('  Load:   ') + chalk.cyan('cpm load <n>'));
  console.log(chalk.dim('  Info:   ') + chalk.cyan('cpm info <n>'));
  console.log(chalk.dim('  Delete: ') + chalk.cyan('cpm delete <n>'));
  console.log('');
}

/**
 * Delete a local profile
 */
export async function deleteLocalProfile(name, options) {
  const profilePath = getProfilePath(name);
  
  if (!existsSync(profilePath)) {
    console.log(chalk.red(`✗ Profile not found: ${name}`));
    process.exit(1);
  }
  
  if (!options.force) {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: `Delete profile "${name}"? This cannot be undone.`,
      default: false
    }]);
    
    if (!confirm) {
      console.log(chalk.yellow('Aborted.'));
      process.exit(0);
    }
  }
  
  rmSync(profilePath, { recursive: true, force: true });
  console.log(chalk.green(`✓ Deleted profile: ${name}`));
}

/**
 * Show detailed profile info
 */
export async function showProfileInfo(name) {
  const profilePath = getProfilePath(name);
  
  if (!existsSync(profilePath)) {
    console.log(chalk.red(`✗ Profile not found: ${name}`));
    process.exit(1);
  }
  
  const metadata = readProfileMetadata(name);
  
  console.log('');
  console.log(chalk.bold('Profile Information'));
  console.log(chalk.dim('─'.repeat(50)));
  console.log('');
  
  console.log(chalk.cyan('Name:        ') + name);
  console.log(chalk.cyan('Version:     ') + (metadata?.version || '1.0.0'));
  console.log(chalk.cyan('Description: ') + (metadata?.description || chalk.dim('No description')));
  console.log(chalk.cyan('Tags:        ') + (metadata?.tags?.join(', ') || chalk.dim('None')));
  console.log(chalk.cyan('Created:     ') + (metadata?.createdAt ? new Date(metadata.createdAt).toLocaleString() : chalk.dim('Unknown')));
  console.log(chalk.cyan('Platform:    ') + (metadata?.platform || chalk.dim('Unknown')));
  console.log(chalk.cyan('Claude Ver:  ') + (metadata?.claudeVersion || chalk.dim('Unknown')));
  
  console.log('');
  console.log(chalk.bold('Files Included:'));
  
  if (metadata?.files?.length) {
    const maxShow = 15;
    const files = metadata.files.slice(0, maxShow);
    
    for (const file of files) {
      console.log(chalk.dim('  • ') + file);
    }
    
    if (metadata.files.length > maxShow) {
      console.log(chalk.dim(`  ... and ${metadata.files.length - maxShow} more files`));
    }
  } else {
    console.log(chalk.dim('  No file information available'));
  }
  
  console.log('');
  console.log(chalk.dim('Location: ') + profilePath);
  console.log('');
}
