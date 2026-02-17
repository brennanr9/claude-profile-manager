Generate a changelog entry from recent git history.

1. Read commits since the last tag (or last N commits if no tags)
2. Group changes by type: features, fixes, breaking changes, other
3. Format as a Keep a Changelog entry with the current date
4. Prepend to CHANGELOG.md (or create it if missing)
