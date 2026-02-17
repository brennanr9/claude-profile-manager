# Auto-Install Claude Code + Marketplace Profiles

Install Claude Code and a marketplace profile automatically — no `cpm` package needed. One command, all platforms.

## Codespaces / Devcontainers

Add a single `postCreateCommand` to your `.devcontainer/devcontainer.json`:

```json
{
  "name": "Dev with Claude Code",
  "image": "mcr.microsoft.com/devcontainers/universal:2",
  "features": {
    "ghcr.io/devcontainers/features/node:1": {
      "version": "lts"
    }
  },
  "postCreateCommand": "node <(curl -fsSL https://raw.githubusercontent.com/brennanr9/claude-profile-manager/main/scripts/install-profile.mjs) marketplace devtools",
  "customizations": {
    "vscode": {
      "extensions": ["anthropic.claude-code"]
    }
  }
}
```

No extra files needed in your repo.

## Local Install (Any Platform)

The same script works on Windows, macOS, and Linux. Only requires Node.js 18+.

```bash
# Download and run directly
curl -fsSL https://raw.githubusercontent.com/brennanr9/claude-profile-manager/main/scripts/install-profile.mjs -o install-profile.mjs && node install-profile.mjs marketplace devtools
```

Or if you've cloned the marketplace repo:

```bash
node scripts/install-profile.mjs marketplace devtools
```

## Available Profiles

```bash
# devtools — dependency auditing, perf profiling, scaffolding
node install-profile.mjs marketplace devtools

# code-quality — code review, test generation, type safety
node install-profile.mjs marketplace code-quality

# git-workflow — PR creation, changelog, commit management
node install-profile.mjs marketplace git-workflow
```

Full list in [`index.json`](../index.json).

## How It Works

The script fetches the profile's `profile.json` manifest directly from GitHub and maps files into Claude Code's native structure:

| Marketplace Path | Installed To |
|---|---|
| `CLAUDE.md` | `~/.claude/CLAUDE.md` (appended) |
| `commands/<name>.md` | `~/.claude/skills/<name>/SKILL.md` |
| `hooks/<name>.md` | `~/.claude/hooks/<name>.md` |

### Prerequisites

- **Node.js 18+** — uses built-in `fetch`, `fs`, and `path` (no dependencies)
- That's it. No bash, curl, or PowerShell required on the target machine.

### Why Node.js?

Node is already a requirement for installing Claude Code (`npm install -g @anthropic-ai/claude-code`), so it's guaranteed to be available. A single `.mjs` file works identically on Windows, macOS, and Linux with zero dependencies.

## Chaining With Existing Setup

```json
{
  "postCreateCommand": "npm install && node <(curl -fsSL https://raw.githubusercontent.com/brennanr9/claude-profile-manager/main/scripts/install-profile.mjs) marketplace devtools"
}
```

## Multiple Profiles

```bash
node install-profile.mjs marketplace devtools && node install-profile.mjs marketplace code-quality
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SKIP_CLAUDE_INSTALL` | `0` | Set to `1` to skip Claude Code CLI install |
| `PROFILE_BRANCH` | `main` | Branch to fetch profiles from |
| `CLAUDE_HOME` | `~/.claude` | Override the Claude config directory |
