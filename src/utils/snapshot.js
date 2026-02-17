import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, cpSync } from 'fs';
import { join, dirname, sep } from 'path';
import { getConfig, DEFAULTS } from './config.js';

// Files/patterns to exclude by default (secrets, caches, etc.)
const DEFAULT_EXCLUDES = [
  '.credentials',
  '.auth',
  '*.key',
  '*.pem',
  '*.secret',
  'oauth_token*',
  '.cache',
  'node_modules',
  '.git'
];

// Files that are safe to include (functional customizations only)
const SAFE_INCLUDES = [
  'CLAUDE.md',
  'commands',
  'commands/**',
  'skills',
  'skills/**',
  'hooks',
  'hooks/**',
  'plugins',
  'plugins/**',
  'mcp.json',
  'mcp_servers',
  'mcp_servers/**',
  'agents',
  'agents/**'
];

/**
 * Create a snapshot of the .claude folder by copying files directly
 */
export async function createSnapshot(profileName, options = {}) {
  const config = await getConfig();
  const claudeDir = config.claudeDir;
  const profileDir = join(config.profilesDir, profileName);

  if (!existsSync(claudeDir)) {
    throw new Error(`Claude directory not found: ${claudeDir}`);
  }

  // Create profile directory
  if (existsSync(profileDir)) {
    throw new Error(`Profile "${profileName}" already exists. Use a different name or delete the existing one.`);
  }

  mkdirSync(profileDir, { recursive: true });

  const metadataPath = join(profileDir, 'profile.json');

  // Create metadata
  const metadata = {
    name: profileName,
    version: '1.0.0',
    description: options.description || '',
    tags: options.tags ? options.tags.split(',').map(t => t.trim()) : [],
    createdAt: new Date().toISOString(),
    claudeVersion: await getClaudeVersion(),
    platform: process.platform,
    includesSecrets: options.includeSecrets || false,
    files: []
  };

  // Get list of files to include
  const files = getFilesToArchive(claudeDir, options.includeSecrets);
  metadata.files = files;

  // Copy each file into the profile directory
  for (const file of files) {
    const srcPath = join(claudeDir, file);
    const destPath = join(profileDir, file);

    // Ensure parent directory exists
    mkdirSync(dirname(destPath), { recursive: true });

    const content = readFileSync(srcPath);
    writeFileSync(destPath, content);
  }

  // Derive structured contents from file list
  metadata.contents = deriveContentsWithMcp(metadata.files, claudeDir);

  // Save metadata
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  return { profileDir, metadata };
}

/**
 * Derive a structured contents summary from a list of file paths.
 * Returns an object with category keys mapping to arrays of item names.
 */
export function deriveContents(files) {
  const contents = {};

  for (const file of files) {
    const normalized = file.split(sep).join('/');

    if (normalized === 'CLAUDE.md') {
      if (!contents.instructions) contents.instructions = [];
      contents.instructions.push('CLAUDE.md');
      continue;
    }

    if (normalized === 'mcp.json') {
      if (!contents.mcp) contents.mcp = [];
      contents.mcp.push('mcp.json');
      continue;
    }

    const parts = normalized.split('/');
    if (parts.length >= 2) {
      const category = parts[0];
      const itemName = parts[1].replace(/\.[^.]+$/, ''); // strip extension
      if (!contents[category]) contents[category] = [];
      if (!contents[category].includes(itemName)) {
        contents[category].push(itemName);
      }
    }
  }

  return contents;
}

/**
 * Derive contents and try to enrich MCP server names from the actual mcp.json file
 */
function deriveContentsWithMcp(files, claudeDir) {
  const contents = deriveContents(files);

  if (contents.mcp && claudeDir) {
    try {
      const mcpPath = join(claudeDir, 'mcp.json');
      if (existsSync(mcpPath)) {
        const mcpData = JSON.parse(readFileSync(mcpPath, 'utf-8'));
        const serverNames = Object.keys(mcpData.mcpServers || mcpData);
        if (serverNames.length > 0) {
          contents.mcp = serverNames;
        }
      }
    } catch {
      // Keep the fallback
    }
  }

  return contents;
}

/**
 * Get list of files to archive (using allowlist approach)
 */
export function getFilesToArchive(dir, includeSecrets = false) {
  const files = [];
  const excludes = includeSecrets ? [] : DEFAULT_EXCLUDES;

  function walk(currentDir, relativePath = '') {
    const entries = readdirSync(currentDir);

    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const relPath = relativePath ? join(relativePath, entry) : entry;

      if (!isAllowed(entry, relPath)) {
        continue;
      }

      if (shouldExclude(entry, relPath, excludes)) {
        continue;
      }

      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        walk(fullPath, relPath);
      } else {
        // Always use forward slashes for portable metadata
        files.push(relPath.split(sep).join('/'));
      }
    }
  }

  walk(dir);
  return files;
}

/**
 * Check if a file/folder is in the allowlist
 */
function isAllowed(name, path) {
  const normalizedPath = path.split(sep).join('/');

  for (const pattern of SAFE_INCLUDES) {
    if (pattern.endsWith('/**')) {
      const dirName = pattern.slice(0, -3);
      if (normalizedPath.startsWith(dirName + '/') || normalizedPath === dirName) {
        return true;
      }
    } else if (name === pattern || normalizedPath === pattern) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a file/folder should be excluded
 */
function shouldExclude(name, path, excludes) {
  for (const pattern of excludes) {
    if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1);
      if (name.endsWith(ext)) return true;
    } else if (name === pattern || path === pattern) {
      return true;
    } else if (pattern.endsWith('*') && name.startsWith(pattern.slice(0, -1))) {
      return true;
    }
  }
  return false;
}

/**
 * Extract a profile to the .claude folder by copying files directly.
 * Uses a merge strategy to work even when Claude Code is running.
 */
export async function extractSnapshot(profileName, options = {}) {
  const config = await getConfig();
  const profileDir = join(config.profilesDir, profileName);
  const claudeDir = config.claudeDir;

  if (!existsSync(profileDir) || !existsSync(join(profileDir, 'profile.json'))) {
    throw new Error(`Profile "${profileName}" not found or corrupted`);
  }

  // Backup existing .claude if requested
  if (options.backup && existsSync(claudeDir)) {
    const backupName = `.claude-backup-${Date.now()}`;
    const backupPath = join(DEFAULTS.profilesDir, backupName);
    cpSync(claudeDir, backupPath, { recursive: true });
  }

  // Check if we need force flag
  if (existsSync(claudeDir) && !options.force) {
    throw new Error('Claude directory exists. Use --force to overwrite or --backup to save current config.');
  }

  // Ensure .claude directory exists
  mkdirSync(claudeDir, { recursive: true });

  // Copy profile files (excluding profile.json) into .claude
  copyProfileFiles(profileDir, claudeDir);

  return { claudeDir };
}

/**
 * Copy profile content files (not profile.json) from source to destination.
 */
function copyProfileFiles(srcDir, destDir) {
  const entries = readdirSync(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    // Skip profile.json — it's metadata, not a profile file
    if (entry.name === 'profile.json') continue;

    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDirMerge(srcPath, destPath);
    } else {
      try {
        const content = readFileSync(srcPath);
        writeFileSync(destPath, content);
      } catch (err) {
        if (err.code === 'EBUSY') {
          throw new Error(`Cannot write to ${entry.name} - file is locked. Please close Claude Code and try again.`);
        }
        throw err;
      }
    }
  }
}

/**
 * Recursively copy/merge directory contents, overwriting files.
 * This works even when the target directory has open file handles.
 */
export function copyDirMerge(src, dest) {
  const entries = readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDirMerge(srcPath, destPath);
    } else {
      try {
        const content = readFileSync(srcPath);
        writeFileSync(destPath, content);
      } catch (err) {
        if (err.code === 'EBUSY') {
          throw new Error(`Cannot write to ${entry.name} - file is locked. Please close Claude Code and try again.`);
        }
        throw err;
      }
    }
  }
}

/**
 * Get Claude CLI version if installed
 */
async function getClaudeVersion() {
  try {
    const { execSync } = await import('child_process');
    const version = execSync('claude --version', { encoding: 'utf-8' }).trim();
    return version;
  } catch {
    return 'unknown';
  }
}

/**
 * Read profile metadata
 */
export function readProfileMetadata(profileName) {
  const config = DEFAULTS;
  const metadataPath = join(config.profilesDir, profileName, 'profile.json');

  if (!existsSync(metadataPath)) {
    return null;
  }

  return JSON.parse(readFileSync(metadataPath, 'utf-8'));
}

/**
 * List all local profiles
 */
export function listLocalProfileNames() {
  const profilesDir = DEFAULTS.profilesDir;

  if (!existsSync(profilesDir)) {
    return [];
  }

  return readdirSync(profilesDir)
    .filter(name => {
      if (name.startsWith('.')) return false;
      const profilePath = join(profilesDir, name);
      const stat = statSync(profilePath);
      return stat.isDirectory() && existsSync(join(profilePath, 'profile.json'));
    });
}
