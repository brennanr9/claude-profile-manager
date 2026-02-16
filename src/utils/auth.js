import { execSync } from 'child_process';
import chalk from 'chalk';
import ora from 'ora';

const GITHUB_API = 'https://api.github.com';
const HEADERS_BASE = {
  'Accept': 'application/vnd.github+json',
  'User-Agent': 'claude-profile-manager'
};

// TODO: Replace with actual client ID after registering the OAuth App.
// Setup (one-time, by the cpm maintainer — NOT end users):
//   1. https://github.com/settings/applications/new
//   2. Enable "Device Flow" on the app settings page
//   3. Paste the client_id here and publish to npm
// The client_id is public and safe to ship in source — no secret needed.
const OAUTH_CLIENT_ID = 'Ov23liNXmVPsBOt1a3Q9';

function authHeaders(token) {
  return { ...HEADERS_BASE, 'Authorization': `Bearer ${token}` };
}

async function getFetch() {
  const { default: fetch } = await import('node-fetch');
  return fetch;
}

/**
 * Retrieve a GitHub token from Git Credential Manager.
 * Works cross-platform (Windows, macOS, Linux) -- delegates to
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
 * Authenticate via the GitHub OAuth device flow.
 * Opens a browser prompt for the user to authorize — no PAT needed.
 * Returns a short-lived access token.
 */
export async function authenticateWithDeviceFlow() {
  const fetch = await getFetch();

  // Step 1: Request a device code
  const codeResponse = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: OAUTH_CLIENT_ID,
      scope: 'public_repo'
    })
  });

  if (!codeResponse.ok) {
    throw new Error(`Device flow initiation failed: ${codeResponse.status}`);
  }

  const { device_code, user_code, verification_uri, interval, expires_in } = await codeResponse.json();

  // Step 2: Show the user the code
  console.log('');
  console.log(chalk.yellow(`  Open: ${chalk.bold(verification_uri)}`));
  console.log(chalk.yellow(`  Enter code: ${chalk.bold(user_code)}`));
  console.log('');

  // Step 3: Poll for authorization
  const spinner = ora('Waiting for authorization...').start();
  const pollInterval = (interval || 5) * 1000;
  const deadline = Date.now() + (expires_in || 900) * 1000;

  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));

    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: OAUTH_CLIENT_ID,
        device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })
    });

    const data = await tokenResponse.json();

    if (data.access_token) {
      spinner.succeed(chalk.green('Authorized.'));
      return data.access_token;
    }

    if (data.error === 'authorization_pending') {
      continue;
    }

    if (data.error === 'slow_down') {
      // Back off as requested
      await new Promise(resolve => setTimeout(resolve, 5000));
      continue;
    }

    if (data.error === 'expired_token') {
      spinner.fail('Authorization expired. Please try again.');
      throw new Error('Device flow expired.');
    }

    if (data.error === 'access_denied') {
      spinner.fail('Authorization denied.');
      throw new Error('User denied authorization.');
    }

    // Unknown error
    spinner.fail(`Authorization failed: ${data.error}`);
    throw new Error(data.error_description || data.error);
  }

  spinner.fail('Authorization timed out.');
  throw new Error('Device flow timed out.');
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
 * Ensure a fork of the marketplace repo exists under the authenticated user.
 * Returns the full name of the fork (e.g., "username/claude-profile-manager").
 */
async function ensureFork(token, upstreamRepo) {
  const fetch = await getFetch();
  const headers = { ...authHeaders(token), 'Content-Type': 'application/json' };

  // Check if fork already exists by listing user's forks of the repo
  const userResponse = await fetch(`${GITHUB_API}/user`, { headers: authHeaders(token) });
  const user = await userResponse.json();
  const repoName = upstreamRepo.split('/')[1];
  const forkFullName = `${user.login}/${repoName}`;

  // Check if the fork exists
  const checkResponse = await fetch(`${GITHUB_API}/repos/${forkFullName}`, {
    headers: authHeaders(token)
  });

  if (checkResponse.ok) {
    const fork = await checkResponse.json();
    if (fork.fork) {
      return forkFullName;
    }
  }

  // Create the fork
  const forkResponse = await fetch(`${GITHUB_API}/repos/${upstreamRepo}/forks`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ default_branch_only: true })
  });

  if (!forkResponse.ok) {
    const err = await forkResponse.json().catch(() => ({}));
    throw new Error(`Failed to fork ${upstreamRepo}: ${err.message || forkResponse.status}`);
  }

  const forkData = await forkResponse.json();

  // Wait for the fork to be ready (GitHub creates forks asynchronously)
  for (let i = 0; i < 30; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const readyCheck = await fetch(`${GITHUB_API}/repos/${forkData.full_name}/git/ref/heads/main`, {
      headers: authHeaders(token)
    });
    if (readyCheck.ok) {
      return forkData.full_name;
    }
  }

  throw new Error('Fork creation timed out. Please try again.');
}

/**
 * Create a pull request on the marketplace repo with profile files.
 *
 * Uses the Git Data API (blobs -> tree -> commit -> ref -> PR).
 * If `forkRepo` is provided, writes to the fork and opens a cross-repo PR.
 */
export async function createProfilePR(token, repo, { author, name, profileJson, snapshotBuffer, indexUpdate }, { useFork = false } = {}) {
  const fetch = await getFetch();
  const targetRepo = useFork ? await ensureFork(token, repo) : repo;
  const headers = { ...authHeaders(token), 'Content-Type': 'application/json' };

  async function api(method, path, body, apiRepo = targetRepo) {
    const response = await fetch(`${GITHUB_API}/repos/${apiRepo}${path}`, {
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

  // 1. Get the SHA of the main branch (always from upstream for consistency)
  const mainRef = await api('GET', '/git/ref/heads/main', null, repo);
  const baseSha = mainRef.object.sha;

  // 2. Get the base commit's tree
  const baseCommit = await api('GET', `/git/commits/${baseSha}`, null, repo);
  const baseTreeSha = baseCommit.tree.sha;

  // 3. Create blobs on the target repo (fork or upstream)
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

  // 6. Create a branch on the target repo
  const branchName = `profile-submission/${author}/${name}`;
  try {
    await api('POST', '/git/refs', {
      ref: `refs/heads/${branchName}`,
      sha: commit.sha
    });
  } catch (e) {
    // Branch exists from a previous attempt -- force update it
    if (e.message.includes('422')) {
      await api('PATCH', `/git/refs/heads/${branchName}`, {
        sha: commit.sha,
        force: true
      });
    } else {
      throw e;
    }
  }

  // 7. Create the pull request (always targets upstream)
  const prHead = useFork ? `${targetRepo.split('/')[0]}:${branchName}` : branchName;
  const pr = await api('POST', '/pulls', {
    title: `Add profile: ${author}/${name}`,
    body: buildPRBody(author, name, JSON.parse(profileJson)),
    head: prHead,
    base: 'main'
  }, repo);

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