import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import fetch from 'node-fetch';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getConfig, claudeDirExists, DEFAULTS } from '../utils/config.js';
import { extractDownloadedSnapshot } from '../utils/snapshot.js';

const INDEX_CACHE_TIME = 60 * 60 * 1000; // 1 hour

// Display labels for content categories
const CATEGORY_LABELS = {
  commands: 'Commands',
  skills: 'Skills',
  mcp: 'MCP Servers',
  mcp_servers: 'MCP Servers',
  agents: 'Agents',
  plugins: 'Plugins',
  hooks: 'Hooks',
  instructions: 'Instructions'
};

/**
 * Format a contents object into display lines
 */
function formatContentsLines(contents, indent = '    ') {
  if (!contents || Object.keys(contents).length === 0) return [];

  const lines = [];
  for (const [category, items] of Object.entries(contents)) {
    if (!items || items.length === 0) continue;
    const label = CATEGORY_LABELS[category] || category;
    const display = category === 'commands'
      ? items.map(i => `/${i}`).join(', ')
      : items.join(', ');
    lines.push(`${indent}${chalk.white(label + ':')} ${chalk.dim(display)}`);
  }
  return lines;
}

/**
 * Get the marketplace index (list of all profiles)
 */
async function fetchMarketplaceIndex(forceRefresh = false) {
  const config = await getConfig();
  const cacheFile = join(config.cacheDir, 'marketplace-index.json');
  
  // Check cache
  if (!forceRefresh && existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile, 'utf-8'));
      const age = Date.now() - (cached._cachedAt || 0);
      
      if (age < INDEX_CACHE_TIME) {
        return cached;
      }
    } catch {
      // Ignore cache errors
    }
  }
  
  // Fetch from GitHub
  const indexUrl = `https://raw.githubusercontent.com/${config.marketplaceRepo}/main/index.json`;
  
  try {
    const response = await fetch(indexUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch marketplace index: ${response.status}`);
    }
    
    const index = await response.json();
    index._cachedAt = Date.now();
    
    // Cache it
    mkdirSync(config.cacheDir, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(index, null, 2));
    
    return index;
  } catch (error) {
    // Try to use stale cache if available
    if (existsSync(cacheFile)) {
      console.log(chalk.yellow('⚠ Could not refresh marketplace. Using cached data.'));
      return JSON.parse(readFileSync(cacheFile, 'utf-8'));
    }
    throw error;
  }
}

/**
 * List profiles in the marketplace
 */
export async function listMarketplace(options) {
  const spinner = ora('Fetching marketplace...').start();
  
  try {
    const index = await fetchMarketplaceIndex(options.refresh);
    spinner.stop();
    
    console.log('');
    console.log(chalk.bold('🛒 Profile Marketplace'));
    console.log(chalk.dim('─'.repeat(50)));
    console.log('');
    
    if (!index.profiles || index.profiles.length === 0) {
      console.log(chalk.dim('  No profiles available yet.'));
      console.log('');
      console.log(chalk.dim('  Be the first to publish: ') + chalk.cyan('cpm publish <n>'));
      return;
    }
    
    // Filter by category if specified
    let profiles = index.profiles;
    if (options.category) {
      profiles = profiles.filter(p =>
        (p.tags || []).includes(options.category)
      );
    }

    for (const profile of profiles) {
      const fullName = `${profile.author}/${profile.name}`;
      console.log(`  ${chalk.cyan(fullName)} ${chalk.dim('v' + (profile.version || '1.0.0'))}`);

      if (profile.description) {
        console.log(`    ${chalk.dim(profile.description.slice(0, 60))}${profile.description.length > 60 ? '...' : ''}`);
      }

      // Show contents breakdown
      const contentsLines = formatContentsLines(profile.contents);
      for (const line of contentsLines) {
        console.log(line);
      }

      if (profile.tags?.length) {
        console.log(`    ${chalk.yellow(profile.tags.join(', '))}`);
      }

      const stats = [];
      if (profile.downloads) stats.push(`↓${profile.downloads}`);
      if (profile.stars) stats.push(`★${profile.stars}`);
      if (stats.length) {
        console.log(`    ${chalk.yellow(stats.join(' • '))}`);
      }

      console.log('');
    }
    
    console.log(chalk.dim('Install a profile:'));
    console.log(chalk.cyan('  cpm install author/profile-name'));
    console.log('');
    
  } catch (error) {
    spinner.fail(chalk.red(`Failed to fetch marketplace: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Search the marketplace
 */
export async function searchMarketplace(query) {
  const spinner = ora('Searching marketplace...').start();
  
  try {
    const index = await fetchMarketplaceIndex();
    spinner.stop();
    
    const queryLower = query.toLowerCase();
    
    const results = (index.profiles || []).filter(profile => {
      const searchable = [
        profile.name,
        profile.author,
        profile.description,
        ...(profile.tags || [])
      ].join(' ').toLowerCase();
      
      return searchable.includes(queryLower);
    });
    
    console.log('');
    console.log(chalk.bold(`Search Results for "${query}"`));
    console.log(chalk.dim('─'.repeat(50)));
    console.log('');
    
    if (results.length === 0) {
      console.log(chalk.dim(`  No profiles found matching "${query}"`));
      console.log('');
      return;
    }
    
    for (const profile of results) {
      const fullName = `${profile.author}/${profile.name}`;
      console.log(`  ${chalk.cyan(fullName)} ${chalk.dim('v' + (profile.version || '1.0.0'))}`);
      
      if (profile.description) {
        console.log(`    ${chalk.dim(profile.description.slice(0, 60))}${profile.description.length > 60 ? '...' : ''}`);
      }
      
      if (profile.tags?.length) {
        console.log(`    ${chalk.yellow(profile.tags.join(', '))}`);
      }
      
      console.log('');
    }
    
    console.log(chalk.dim(`Found ${results.length} profile(s)`));
    console.log('');
    
  } catch (error) {
    spinner.fail(chalk.red(`Search failed: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Show detailed info about a marketplace profile
 */
export async function showMarketplaceInfo(profilePath) {
  const [author, name] = profilePath.includes('/') 
    ? profilePath.split('/')
    : [null, profilePath];
    
  if (!author || !name) {
    console.log(chalk.red('✗ Invalid profile format. Use: author/profile-name'));
    process.exit(1);
  }
  
  const spinner = ora('Fetching profile info...').start();
  
  try {
    const index = await fetchMarketplaceIndex();
    const profile = (index.profiles || []).find(
      p => p.author === author && p.name === name
    );
    
    if (!profile) {
      spinner.fail(chalk.red(`Profile not found: ${profilePath}`));
      process.exit(1);
    }
    
    // Fetch full profile metadata
    const config = await getConfig();
    const metadataUrl = `https://raw.githubusercontent.com/${config.marketplaceRepo}/main/profiles/${author}/${name}/profile.json`;
    
    let metadata = profile;
    try {
      const response = await fetch(metadataUrl);
      if (response.ok) {
        metadata = { ...profile, ...await response.json() };
      }
    } catch {
      // Use index data
    }
    
    spinner.stop();
    
    console.log('');
    console.log(chalk.bold('Profile Information'));
    console.log(chalk.dim('─'.repeat(50)));
    console.log('');
    
    console.log(chalk.cyan('Name:        ') + `${author}/${name}`);
    console.log(chalk.cyan('Version:     ') + (metadata.version || '1.0.0'));
    console.log(chalk.cyan('Author:      ') + author);
    console.log(chalk.cyan('Description: ') + (metadata.description || chalk.dim('No description')));
    console.log(chalk.cyan('Tags:        ') + (metadata.tags?.join(', ') || chalk.dim('None')));
    
    if (metadata.downloads) {
      console.log(chalk.cyan('Downloads:   ') + metadata.downloads);
    }
    if (metadata.stars) {
      console.log(chalk.cyan('Stars:       ') + metadata.stars);
    }
    if (metadata.createdAt) {
      console.log(chalk.cyan('Created:     ') + new Date(metadata.createdAt).toLocaleDateString());
    }
    if (metadata.updatedAt) {
      console.log(chalk.cyan('Updated:     ') + new Date(metadata.updatedAt).toLocaleDateString());
    }

    // Show contents breakdown
    if (metadata.contents && Object.keys(metadata.contents).length > 0) {
      console.log('');
      console.log(chalk.bold('Contents:'));
      const contentsLines = formatContentsLines(metadata.contents, '  ');
      for (const line of contentsLines) {
        console.log(line);
      }
    }

    console.log('');
    console.log(chalk.dim('Install with:'));
    console.log(chalk.cyan(`  cpm install ${author}/${name}`));
    console.log('');
    
  } catch (error) {
    spinner.fail(chalk.red(`Failed to fetch profile: ${error.message}`));
    process.exit(1);
  }
}

/**
 * Install a profile from the marketplace
 */
export async function installFromMarketplace(profilePath, options) {
  const [author, name] = profilePath.includes('/')
    ? profilePath.split('/')
    : [null, profilePath];
    
  if (!author || !name) {
    console.log(chalk.red('✗ Invalid profile format. Use: author/profile-name'));
    process.exit(1);
  }
  
  console.log('');
  console.log(chalk.bold(`Installing: ${chalk.cyan(profilePath)}`));
  console.log('');
  
  // Confirm if .claude exists
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
  
  const spinner = ora('Downloading profile...').start();
  
  try {
    const config = await getConfig();
    
    // Download the snapshot zip
    const zipUrl = `https://raw.githubusercontent.com/${config.marketplaceRepo}/main/profiles/${author}/${name}/snapshot.zip`;
    
    const response = await fetch(zipUrl);
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Profile not found: ${profilePath}`);
      }
      throw new Error(`Download failed: ${response.status}`);
    }
    
    spinner.text = 'Extracting profile...';
    
    const buffer = Buffer.from(await response.arrayBuffer());
    await extractDownloadedSnapshot(buffer, options);
    
    spinner.succeed(chalk.green(`Installed: ${chalk.bold(profilePath)}`));
    
    if (options.backup) {
      console.log(chalk.dim('  Previous config backed up'));
    }
    
    console.log('');
    console.log(chalk.green('✓ Your Claude CLI is now configured with this profile.'));
    console.log('');
    
  } catch (error) {
    spinner.fail(chalk.red(`Installation failed: ${error.message}`));
    process.exit(1);
  }
}
