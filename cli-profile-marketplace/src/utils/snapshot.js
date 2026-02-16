import { createWriteStream, createReadStream, existsSync, mkdirSync, readdirSync, statSync, rmSync, cpSync, readFileSync, writeFileSync } from 'fs';
import { join, basename, relative } from 'path';
import archiver from 'archiver';
import extractZip from 'extract-zip';
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

// Files that are safe to include
const SAFE_INCLUDES = [
  'settings.json',
  'settings.local.json', 
  'CLAUDE.md',
  'commands',
  'commands/**',
  'projects',
  'projects/**',
  'templates',
  'templates/**',
  'hooks',
  'hooks/**',
  'mcp.json',
  'mcp_servers',
  'mcp_servers/**'
];

/**
 * Create a snapshot of the .claude folder
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
  
  const zipPath = join(profileDir, 'snapshot.zip');
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
  
  // Create zip archive
  const output = createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  
  return new Promise((resolve, reject) => {
    output.on('close', async () => {
      // Save metadata
      writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      resolve({ profileDir, metadata });
    });
    
    archive.on('error', reject);
    archive.on('entry', (entry) => {
      metadata.files.push(entry.name);
    });
    
    archive.pipe(output);
    
    // Add files from .claude directory
    const files = getFilesToArchive(claudeDir, options.includeSecrets);
    
    for (const file of files) {
      const fullPath = join(claudeDir, file);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory()) {
        archive.directory(fullPath, file);
      } else {
        archive.file(fullPath, { name: file });
      }
    }
    
    archive.finalize();
  });
}

/**
 * Get list of files to archive (respecting excludes)
 */
function getFilesToArchive(dir, includeSecrets = false) {
  const files = [];
  const excludes = includeSecrets ? [] : DEFAULT_EXCLUDES;
  
  function walk(currentDir, relativePath = '') {
    const entries = readdirSync(currentDir);
    
    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const relPath = relativePath ? join(relativePath, entry) : entry;
      
      // Check exclusions
      if (shouldExclude(entry, relPath, excludes)) {
        continue;
      }
      
      const stat = statSync(fullPath);
      
      if (stat.isDirectory()) {
        walk(fullPath, relPath);
      } else {
        files.push(relPath);
      }
    }
  }
  
  walk(dir);
  return files;
}

/**
 * Check if a file/folder should be excluded
 */
function shouldExclude(name, path, excludes) {
  for (const pattern of excludes) {
    if (pattern.startsWith('*.')) {
      // Extension pattern
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
 * Extract a snapshot to the .claude folder
 */
export async function extractSnapshot(profileName, options = {}) {
  const config = await getConfig();
  const profileDir = join(config.profilesDir, profileName);
  const zipPath = join(profileDir, 'snapshot.zip');
  const claudeDir = config.claudeDir;
  
  if (!existsSync(zipPath)) {
    throw new Error(`Profile "${profileName}" not found or corrupted`);
  }
  
  // Backup existing .claude if requested
  if (options.backup && existsSync(claudeDir)) {
    const backupName = `.claude-backup-${Date.now()}`;
    const backupPath = join(DEFAULTS.profilesDir, backupName);
    cpSync(claudeDir, backupPath, { recursive: true });
  }
  
  // Clear existing .claude directory (if force or confirmed)
  if (existsSync(claudeDir)) {
    if (!options.force) {
      throw new Error('Claude directory exists. Use --force to overwrite or --backup to save current config.');
    }
    rmSync(claudeDir, { recursive: true, force: true });
  }
  
  // Create fresh .claude directory
  mkdirSync(claudeDir, { recursive: true });
  
  // Extract snapshot
  await extractZip(zipPath, { dir: claudeDir });
  
  return { claudeDir };
}

/**
 * Extract a downloaded snapshot (from marketplace)
 */
export async function extractDownloadedSnapshot(zipBuffer, options = {}) {
  const config = await getConfig();
  const claudeDir = config.claudeDir;
  const tempZip = join(config.cacheDir, `temp-${Date.now()}.zip`);
  
  // Write buffer to temp file
  writeFileSync(tempZip, zipBuffer);
  
  try {
    // Backup existing .claude if requested
    if (options.backup && existsSync(claudeDir)) {
      const backupName = `.claude-backup-${Date.now()}`;
      const backupPath = join(DEFAULTS.profilesDir, backupName);
      cpSync(claudeDir, backupPath, { recursive: true });
    }
    
    // Clear existing .claude directory
    if (existsSync(claudeDir)) {
      if (!options.force) {
        throw new Error('Claude directory exists. Use --force to overwrite or --backup to save current config.');
      }
      rmSync(claudeDir, { recursive: true, force: true });
    }
    
    mkdirSync(claudeDir, { recursive: true });
    await extractZip(tempZip, { dir: claudeDir });
    
    return { claudeDir };
  } finally {
    // Clean up temp file
    if (existsSync(tempZip)) {
      rmSync(tempZip);
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
