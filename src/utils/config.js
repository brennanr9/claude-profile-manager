import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const HOME = homedir();

/**
 * Find Claude directory - checks project root first (codespaces), then home
 */
function findClaudeDir() {
  const candidates = [
    join(process.cwd(), '.claude'),  // Project root (codespaces, dev environments)
    join(HOME, '.claude'),           // Home directory (standard local install)
  ];

  for (const dir of candidates) {
    if (existsSync(dir)) {
      return dir;
    }
  }

  // Default to home directory if not found
  return join(HOME, '.claude');
}

// Default paths
const DEFAULTS = {
  claudeDir: findClaudeDir(),
  profilesDir: join(HOME, '.claude-profiles'),
  cacheDir: join(HOME, '.claude-profiles', '.cache'),
  configFile: join(HOME, '.claude-profiles', 'config.json'),
  marketplaceRepo: 'brennanr9/claude-profile-manager'
};

/**
 * Ensure required directories exist
 */
export function ensureDirs() {
  const dirs = [DEFAULTS.profilesDir, DEFAULTS.cacheDir];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Get current configuration
 */
export async function getConfig() {
  ensureDirs();
  
  let userConfig = {};
  
  if (existsSync(DEFAULTS.configFile)) {
    try {
      userConfig = JSON.parse(readFileSync(DEFAULTS.configFile, 'utf-8'));
    } catch (e) {
      // Ignore invalid config
    }
  }
  
  return {
    ...DEFAULTS,
    ...userConfig
  };
}

/**
 * Update configuration
 */
export async function updateConfig(updates) {
  ensureDirs();
  
  const current = await getConfig();
  const newConfig = { ...current, ...updates };
  
  // Only save user-configurable options
  const toSave = {
    marketplaceRepo: newConfig.marketplaceRepo
  };
  
  writeFileSync(DEFAULTS.configFile, JSON.stringify(toSave, null, 2));
  
  return newConfig;
}

/**
 * Get the path for a local profile
 */
export function getProfilePath(name) {
  return join(DEFAULTS.profilesDir, name);
}

/**
 * Check if Claude directory exists
 */
export function claudeDirExists() {
  return existsSync(DEFAULTS.claudeDir);
}

export { DEFAULTS };
