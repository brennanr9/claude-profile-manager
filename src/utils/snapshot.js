import { createWriteStream, createReadStream, existsSync, mkdirSync, readdirSync, statSync, rmSync, cpSync, readFileSync, writeFileSync } from 'fs';
import { join, basename, relative, sep } from 'path';
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
      // Derive structured contents from file list
      metadata.contents = deriveContentsWithMcp(metadata.files, claudeDir);
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
      // Parse MCP server names from mcp.json if possible — but at derivation
      // time we may not have access to file content, so just flag it
      if (!contents.mcp) contents.mcp = [];
      contents.mcp.push('mcp.json');
      continue;
    }

    const parts = normalized.split('/');
    if (parts.length >= 2) {
      const category = parts[0];
      // Use the immediate child name (file or subfolder)
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

  // If mcp.json is in the file list, try to read server names from it
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
function getFilesToArchive(dir, includeSecrets = false) {
  const files = [];
  const excludes = includeSecrets ? [] : DEFAULT_EXCLUDES;

  function walk(currentDir, relativePath = '') {
    const entries = readdirSync(currentDir);

    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const relPath = relativePath ? join(relativePath, entry) : entry;

      // Check if this path is in the allowlist
      if (!isAllowed(entry, relPath)) {
        continue;
      }

      // Check exclusions (secrets, credentials)
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
 * Check if a file/folder is in the allowlist
 */
function isAllowed(name, path) {
  // Normalize path separators to forward slashes for cross-platform matching
  const normalizedPath = path.split(sep).join('/');

  // Check against SAFE_INCLUDES patterns
  for (const pattern of SAFE_INCLUDES) {
    if (pattern.endsWith('/**')) {
      // Directory with all contents
      const dirName = pattern.slice(0, -3);
      if (normalizedPath.startsWith(dirName + '/') || normalizedPath === dirName) {
        return true;
      }
    } else if (name === pattern || normalizedPath === pattern) {
      // Exact match
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
 * Uses a merge strategy to work even when Claude Code is running
 */
export async function extractSnapshot(profileName, options = {}) {
  const config = await getConfig();
  const profileDir = join(config.profilesDir, profileName);
  const zipPath = join(profileDir, 'snapshot.zip');
  const claudeDir = config.claudeDir;
  const tempExtractDir = join(config.cacheDir, `extract-${Date.now()}`);
  
  if (!existsSync(zipPath)) {
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

  try {
    // Extract to temp directory first
    mkdirSync(tempExtractDir, { recursive: true });
    await extractZip(zipPath, { dir: tempExtractDir });

    // Ensure .claude directory exists
    mkdirSync(claudeDir, { recursive: true });

    // Merge files into .claude (works even with locked files)
    copyDirMerge(tempExtractDir, claudeDir);
    
    return { claudeDir };
  } finally {
    // Clean up temp directory
    if (existsSync(tempExtractDir)) {
      try {
        rmSync(tempExtractDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Extract a downloaded snapshot (from marketplace)
 * Uses a merge strategy to work even when Claude Code is running
 */
export async function extractDownloadedSnapshot(zipBuffer, options = {}) {
  const config = await getConfig();
  const claudeDir = config.claudeDir;
  const tempZip = join(config.cacheDir, `temp-${Date.now()}.zip`);
  const tempExtractDir = join(config.cacheDir, `extract-${Date.now()}`);
  
  // Write buffer to temp file
  writeFileSync(tempZip, zipBuffer);
  
  try {
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

    // Extract to temp directory first
    mkdirSync(tempExtractDir, { recursive: true });
    await extractZip(tempZip, { dir: tempExtractDir });

    // Ensure .claude directory exists
    mkdirSync(claudeDir, { recursive: true });

    // Merge files into .claude (works even with locked files)
    // Copy each file individually, overwriting existing ones
    copyDirMerge(tempExtractDir, claudeDir);
    
    return { claudeDir };
  } finally {
    // Clean up temp files
    if (existsSync(tempZip)) {
      rmSync(tempZip);
    }
    if (existsSync(tempExtractDir)) {
      try {
        rmSync(tempExtractDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Recursively copy/merge directory contents, overwriting files
 * This works even when the target directory has open file handles
 */
function copyDirMerge(src, dest) {
  const entries = readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    
    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDirMerge(srcPath, destPath);
    } else {
      // Copy file, overwriting if exists
      try {
        const content = readFileSync(srcPath);
        writeFileSync(destPath, content);
      } catch (err) {
        // If file is locked, try to write with a slight delay
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
