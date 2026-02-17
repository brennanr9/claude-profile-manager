Generate tests for the specified file or function.

Usage: /test-gen <file-or-function>

1. Detect the project's test framework and conventions
2. Generate unit tests covering: happy path, edge cases, error conditions
3. Use the project's existing test patterns (describe/it, test(), etc.)
4. Place tests in the conventional location for this project
5. Include setup/teardown if the code under test has dependencies
