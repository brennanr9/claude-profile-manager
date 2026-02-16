import { execSync } from 'child_process';

const GITHUB_API = 'https://api.github.com';
const HEADERS_BASE = {
  'Accept': 'application/vnd.github+json',
  'User-Agent': 'claude-profile-manager'
};

function authHeaders(token) {
  return { ...HEADERS_BASE, 'Authorization': `Bearer ${token}` };
}

async function getFetch() {
  const { default: fetch } = await import('node-fetch');
  return fetch;
}

/**
 * Retrieve a GitHub token from Git Credential Manager.
 * Works cross-platform (Windows, macOS, Linux) — delegates to
 * whatever credential helper is configured for git.
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
  const fetch = await getFetch();

  const response = await fetch(`${GITHUB_API}/user`, {
    headers: authHeaders(token)
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
 * Create a pull request on the marketplace repo with profile files.
 *
 * Uses the Git Data API (blobs → tree → commit → ref → PR) to support
 * files of any size without the 64KB issue body limit.
 */
export async function createProfilePR(token, repo, { author, name, profileJson, snapshotBuffer, indexUpdate }) {
  const fetch = await getFetch();
  const headers = { ...authHeaders(token), 'Content-Type': 'application/json' };

  async function api(method, path, body) {
    const response = await fetch(`${GITHUB_API}/repos/${repo}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`GitHub API ${method} ${path} failed (${response.status}): ${errorData.message || 'Unknown error'}`);
    }

    return response.json();
  }

  // 1. Get the SHA of the main branch
  const mainRef = await api('GET', '/git/ref/heads/main');
  const baseSha = mainRef.object.sha;

  // 2. Get the base commit's tree
  const baseCommit = await api('GET', `/git/commits/${baseSha}`);
  const baseTreeSha = baseCommit.tree.sha;

  // 3. Create blobs for profile.json and snapshot.zip
  const profileBlob = await api('POST', '/git/blobs', {
    content: Buffer.from(profileJson).toString('base64'),
    encoding: 'base64'
  });

  const snapshotBlob = await api('POST', '/git/blobs', {
    content: snapshotBuffer.toString('base64'),
    encoding: 'base64'
  });

  const indexBlob = await api('POST', '/git/blobs', {
    content: Buffer.from(indexUpdate).toString('base64'),
    encoding: 'base64'
  });

  // 4. Create a new tree with the profile files + updated index
  const tree = await api('POST', '/git/trees', {
    base_tree: baseTreeSha,
    tree: [
      {
        path: `profiles/${author}/${name}/profile.json`,
        mode: '100644',
        type: 'blob',
        sha: profileBlob.sha
      },
      {
        path: `profiles/${author}/${name}/snapshot.zip`,
        mode: '100644',
        type: 'blob',
        sha: snapshotBlob.sha
      },
      {
        path: 'index.json',
        mode: '100644',
        type: 'blob',
        sha: indexBlob.sha
      }
    ]
  });

  // 5. Create a commit
  const commit = await api('POST', '/git/commits', {
    message: `Add profile: ${author}/${name}`,
    tree: tree.sha,
    parents: [baseSha]
  });

  // 6. Create a branch
  const branchName = `profile-submission/${author}/${name}`;
  try {
    await api('POST', '/git/refs', {
      ref: `refs/heads/${branchName}`,
      sha: commit.sha
    });
  } catch (e) {
    // Branch exists from a previous attempt — force update it
    if (e.message.includes('422')) {
      await api('PATCH', `/git/refs/heads/${branchName}`, {
        sha: commit.sha,
        force: true
      });
    } else {
      throw e;
    }
  }

  // 7. Create the pull request
  const pr = await api('POST', '/pulls', {
    title: `Add profile: ${author}/${name}`,
    body: buildPRBody(author, name, JSON.parse(profileJson)),
    head: branchName,
    base: 'main'
  });

  return pr;
}

/**
 * Fetch the current index.json from the repo.
 */
export async function fetchRepoIndex(token, repo) {
  const fetch = await getFetch();

  const response = await fetch(`${GITHUB_API}/repos/${repo}/contents/index.json`, {
    headers: authHeaders(token)
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch index.json: ${response.status}`);
  }

  const data = await response.json();
  return JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
}

function buildPRBody(author, name, metadata) {
  const lines = [
    `## Profile Submission`,
    '',
    `Adds profile **${author}/${name}** v${metadata.version || '1.0.0'}`,
    '',
    `**Description:** ${metadata.description || 'No description'}`,
    ''
  ];

  const contents = metadata.contents || {};
  if (Object.keys(contents).length > 0) {
    lines.push('**Contents:**');
    for (const [cat, items] of Object.entries(contents)) {
      if (items && items.length > 0) {
        const display = cat === 'commands' ? items.map(i => `/${i}`).join(', ') : items.join(', ');
        lines.push(`- ${cat}: ${display}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
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
