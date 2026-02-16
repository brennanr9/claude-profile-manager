# 🚀 Claude Profile Manager

A marketplace for saving, sharing, and loading Claude CLI configuration profiles.

[![npm version](https://img.shields.io/npm/v/claude-profile-manager)](https://www.npmjs.com/package/claude-profile-manager)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

## What is this?

Claude Profile Manager (`cpm`) lets you:

- **📸 Save** your entire `.claude` folder as a shareable profile
- **🔄 Load** profiles to instantly switch between configurations  
- **🛒 Browse** a marketplace of community-created profiles
- **📤 Share** your profiles with others

Think of it like dotfiles for Claude CLI, with a built-in plugin marketplace.

## Installation

```bash
npm install -g claude-profile-manager
```

Requires Node.js 18+ (already installed if you're using Claude CLI).

## Quick Start

```bash
# Save your current Claude config as a profile
cpm save my-setup

# List profiles in the marketplace
cpm list

# Install a profile from the marketplace
cpm install marketplace/senior-developer

# Load your saved profile
cpm load my-setup
```

## Commands

### Local Profile Management

```bash
# Save current .claude folder as a profile
cpm save <n> [--description "desc"] [--tags "tag1,tag2"]

# Load a saved profile (replaces current .claude)
cpm load <n> [--backup] [--force]

# List your locally saved profiles
cpm local

# View profile details
cpm info <n>

# Delete a local profile
cpm delete <n> [--force]
```

### Marketplace

```bash
# Browse all marketplace profiles
cpm list [--category <cat>] [--refresh]

# Search the marketplace
cpm search <query>

# Install a profile from marketplace
cpm install author/profile-name [--backup] [--force]

# View marketplace profile details
cpm info author/profile-name
```

### Publishing

```bash
# Publish your profile to the marketplace
cpm publish <n>

# Use a custom marketplace repository
cpm repo owner/repo-name
```

### Configuration

```bash
# Show current configuration
cpm config
```

## What's in a Profile?

A profile is a complete snapshot of your `.claude` folder, including:

- `settings.json` - Your Claude CLI settings
- `CLAUDE.md` - Custom instructions
- `commands/` - Custom slash commands
- `mcp.json` & `mcp_servers/` - MCP server configurations
- `projects/` - Project-specific settings
- And more...

**Security Note:** By default, sensitive files (credentials, API keys, etc.) are excluded from snapshots. Use `--include-secrets` only if you're sure.

## Example Workflows

### Switch Between Work Personas

```bash
# Save your code review setup
cpm save work-reviewer --tags "work,code-review"

# Save your documentation setup  
cpm save docs-writer --tags "work,documentation"

# Switch between them
cpm load work-reviewer
# ... do code reviews ...
cpm load docs-writer
# ... write documentation ...
```

### Share Team Configuration

```bash
# Lead saves team config
cpm save team-standards --description "Our team's Claude configuration"
cpm publish team-standards

# Team members install it
cpm install yourname/team-standards
```

### Try Community Profiles

```bash
# Browse what's available
cpm list

# Search for Python-focused profiles
cpm search python

# Try one out (with backup)
cpm install marketplace/python-expert --backup

# Don't like it? Restore your backup
cpm load .claude-backup-*
```

## Profile Storage

Profiles are stored in `~/.claude-profiles/`:

```
~/.claude-profiles/
├── config.json           # CPM settings
├── my-setup/
│   ├── profile.json      # Profile metadata
│   └── snapshot.zip      # Compressed .claude folder
├── work-reviewer/
│   ├── profile.json
│   └── snapshot.zip
└── .cache/
    └── marketplace-index.json
```

## Contributing Profiles

Want to share your profile with the community?

1. Save your profile: `cpm save my-awesome-profile`
2. Publish it: `cpm publish my-awesome-profile`
3. Follow the instructions to submit a PR

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines.

## Creating a Custom Marketplace

You can host your own marketplace (e.g., for your company):

1. Fork this repository
2. Add profiles to the `profiles/` directory
3. Update `index.json`
4. Have users point to your repo:

```bash
cpm repo your-org/your-marketplace
```

## Repository Structure

```
claude-profile-marketplace/
├── src/                    # NPM package source
│   ├── cli.js             # CLI entry point
│   ├── commands/          # Command implementations
│   └── utils/             # Utilities
├── profiles/              # Marketplace profiles
│   └── author/
│       └── profile-name/
│           ├── profile.json
│           └── snapshot.zip
├── index.json             # Marketplace index
├── package.json
└── README.md
```

## FAQ

**Q: Is it safe to share profiles?**

A: By default, sensitive files are excluded. However, always review your profile before publishing. Don't share profiles that contain API keys or credentials.

**Q: Can I use this with GitHub Copilot CLI too?**

A: Currently focused on Claude CLI, but the architecture supports extending to other tools.

**Q: What if I mess up my config?**

A: Use `--backup` when loading profiles to save your current config first. You can restore it with `cpm load .claude-backup-*`.

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

**Made with ❤️ for the Claude CLI community**
