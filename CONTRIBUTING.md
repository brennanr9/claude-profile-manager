# Contributing to Claude Profile Marketplace

Thank you for your interest in contributing! This guide explains how to share your Claude CLI profiles with the community.

## Quick Start

```bash
# Install the CLI
npm install -g claude-profile-manager

# Save your current Claude config as a profile
cpm save my-awesome-profile --description "My custom setup" --tags "python,testing"

# Publish it
cpm publish my-awesome-profile
```

## Adding a Profile Manually

### 1. Fork this Repository

Click the "Fork" button on GitHub.

### 2. Create Your Profile Directory

```bash
mkdir -p profiles/YOUR_USERNAME/your-profile-name
```

### 3. Add Required Files

Each profile needs:

```
profiles/your-username/your-profile-name/
├── profile.json      # Metadata
└── snapshot.zip      # Zipped .claude folder contents
```

#### profile.json

```json
{
  "name": "your-profile-name",
  "version": "1.0.0",
  "description": "A clear description of what this profile does",
  "author": "your-github-username",
  "tags": ["tag1", "tag2"],
  "createdAt": "2025-02-15T00:00:00Z",
  "platform": "cross-platform",
  "files": ["settings.json", "CLAUDE.md", "commands/..."]
}
```

#### snapshot.zip

A zip archive containing your `.claude` folder contents:

```bash
cd ~/.claude
zip -r snapshot.zip . -x "*.credentials*" -x "*.auth*" -x "*.secret*"
```

**⚠️ Important:** Never include credentials, API keys, or other secrets!

### 4. Update index.json

Add your profile to the root `index.json`:

```json
{
  "profiles": [
    // ... existing profiles ...
    {
      "name": "your-profile-name",
      "author": "your-username",
      "version": "1.0.0",
      "description": "Your description",
      "tags": ["tag1", "tag2"],
      "createdAt": "2025-02-15T00:00:00Z"
    }
  ]
}
```

### 5. Submit a Pull Request

- Title: `Add profile: your-username/your-profile-name`
- Description: Explain what your profile does and who it's for

## Guidelines

### Profile Names
- Use lowercase letters, numbers, and hyphens
- Be descriptive: `python-testing` not `my-profile`

### Descriptions
- Clearly explain what the profile does
- Mention key features or use cases
- Keep it under 200 characters

### Tags
Use relevant tags from this list:
- `code-review`, `testing`, `documentation`
- `security`, `debugging`, `refactoring`
- `python`, `javascript`, `typescript`, `go`, `rust`
- `frontend`, `backend`, `fullstack`, `devops`
- `beginner`, `advanced`

### Security
- **Never** include credentials, tokens, or API keys
- Review your snapshot before publishing
- Use the `--exclude` patterns in your zip command

## Questions?

Open an issue or start a discussion on GitHub!
