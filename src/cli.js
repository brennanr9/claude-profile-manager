#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { 
  saveProfile, 
  loadProfile, 
  listLocalProfiles,
  deleteLocalProfile,
  showProfileInfo
} from './commands/local.js';
import { 
  listMarketplace, 
  searchMarketplace, 
  installFromMarketplace,
  showMarketplaceInfo
} from './commands/marketplace.js';
import { 
  publishProfile,
  setRepository 
} from './commands/publish.js';
import { getConfig } from './utils/config.js';

const VERSION = '1.0.0';

const program = new Command();

// Banner
const banner = `
${chalk.cyan('   ____ ____  __  __')}
${chalk.cyan('  / ___|  _ \\|  \\/  |')}
${chalk.cyan(' | |   | |_) | |\\/| |')}
${chalk.cyan(' | |___|  __/| |  | |')}
${chalk.cyan('  \\____|_|   |_|  |_|')}
  
  ${chalk.magenta('Claude Profile Manager v' + VERSION)}
`;

program
  .name('cpm')
  .description('Save, share, and load Claude CLI profiles')
  .version(VERSION)
  .addHelpText('before', banner);

// ============================================================================
// Local Profile Commands
// ============================================================================

program
  .command('save <name>')
  .description('Save current .claude folder as a profile snapshot')
  .option('-d, --description <desc>', 'Profile description')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .option('--include-secrets', 'Include sensitive files (use with caution)')
  .action(async (name, options) => {
    await saveProfile(name, options);
  });

program
  .command('load <name>')
  .description('Load a profile (local or from marketplace)')
  .option('-f, --force', 'Overwrite existing .claude folder without prompting')
  .option('--backup', 'Backup current .claude folder before loading')
  .option('--marketplace', 'Load from marketplace instead of local')
  .action(async (name, options) => {
    if (options.marketplace || name.includes('/')) {
      await installFromMarketplace(name, options);
    } else {
      await loadProfile(name, options);
    }
  });

program
  .command('local')
  .description('List locally saved profiles')
  .action(async () => {
    await listLocalProfiles();
  });

program
  .command('delete <name>')
  .description('Delete a locally saved profile')
  .option('-f, --force', 'Delete without confirmation')
  .action(async (name, options) => {
    await deleteLocalProfile(name, options);
  });

program
  .command('info <name>')
  .description('Show detailed info about a profile')
  .option('--marketplace', 'Show marketplace profile info')
  .action(async (name, options) => {
    if (options.marketplace || name.includes('/')) {
      await showMarketplaceInfo(name);
    } else {
      await showProfileInfo(name);
    }
  });

// ============================================================================
// Marketplace Commands
// ============================================================================

program
  .command('list')
  .alias('browse')
  .description('Browse profiles in the marketplace')
  .option('-c, --category <category>', 'Filter by category')
  .option('--refresh', 'Force refresh the marketplace index')
  .action(async (options) => {
    await listMarketplace(options);
  });

program
  .command('search <query>')
  .description('Search the marketplace')
  .action(async (query) => {
    await searchMarketplace(query);
  });

program
  .command('install <profile>')
  .description('Install a profile from the marketplace (format: author/name)')
  .option('-f, --force', 'Overwrite existing .claude folder')
  .option('--backup', 'Backup current config before installing')
  .action(async (profile, options) => {
    await installFromMarketplace(profile, options);
  });

// ============================================================================
// Publishing Commands
// ============================================================================

program
  .command('publish <name>')
  .description('Publish a local profile to the marketplace')
  .action(async (name, options) => {
    await publishProfile(name, options);
  });

program
  .command('repo <repository>')
  .description('Set custom marketplace repository (format: owner/repo)')
  .action(async (repository) => {
    await setRepository(repository);
  });

// ============================================================================
// Utility Commands  
// ============================================================================

program
  .command('config')
  .description('Show current configuration')
  .action(async () => {
    const config = await getConfig();
    console.log(banner);
    console.log(chalk.bold('Configuration:\n'));
    console.log(`  ${chalk.cyan('Profiles Directory:')} ${config.profilesDir}`);
    console.log(`  ${chalk.cyan('Claude Directory:')}   ${config.claudeDir}`);
    console.log(`  ${chalk.cyan('Marketplace Repo:')}   ${config.marketplaceRepo}`);
    console.log(`  ${chalk.cyan('Cache Directory:')}    ${config.cacheDir}`);
  });

program.parse();
