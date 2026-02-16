import { execSync } from 'child_process';

/**
 * Retrieve a GitHub token from Git Credential Manager.
 * Works cross-platform (Windows, macOS, Linux) — delegates to
 * whatever credential helper is configured for git.
 *
 * Returns the token string, or null if no credentials are cached.
 */
export function getGitHubToken() {
  try {
    const input = 'protocol=https\nhost=github.com\n\n';
    const output = execSync('git credential fill', {
      input,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const creds = {};
    for (const line of output.trim().split('\n')) {
      const [key, ...rest] = line.split('=');
      creds[key] = rest.join('=');
    }

    return creds.password || null;
  } catch {
    return null;
  }
}

/**
 * Get the GitHub username associated with a token.
 */
export async function getGitHubUsername(token) {
  const { default: fetch } = await import('node-fetch');

  const response = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'claude-profile-manager'
    }
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('GitHub credentials are expired or invalid. Re-authenticate with git and try again.');
    }
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const user = await response.json();
  return user.login;
}

/**
 * Create a GitHub issue on the marketplace repo.
 */
export async function createGitHubIssue(token, repo, title, body, labels = []) {
  const { default: fetch } = await import('node-fetch');

  const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'claude-profile-manager'
    },
    body: JSON.stringify({ title, body, labels })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    if (response.status === 403) {
      throw new Error('Token does not have permission to create issues. You may need a token with public_repo scope.');
    }
    if (response.status === 404) {
      throw new Error(`Marketplace repo not found: ${repo}`);
    }
    throw new Error(`GitHub API error ${response.status}: ${errorData.message || 'Unknown error'}`);
  }

  return await response.json();
}

/**
 * Returns setup instructions when no credentials are found.
 */
export function getCredentialSetupInstructions() {
  return [
    '',
    'To set up HTTPS credentials for GitHub:',
    '',
    '  1. Create a token at: https://github.com/settings/tokens/new',
    '     (select the "public_repo" scope)',
    '',
    '  2. Store it in your git credential manager:',
    '',
    '     git credential approve <<EOF',
    '     protocol=https',
    '     host=github.com',
    '     username=YOUR_USERNAME',
    '     password=YOUR_TOKEN',
    '     EOF',
    '',
    'Then re-run: cpm publish <profile-name>',
    ''
  ].join('\n');
}
