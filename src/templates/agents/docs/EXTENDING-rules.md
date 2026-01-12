# Local Extensions

This project supports local rule and skill extensions that persist across package updates.

## How Local Extensions Work

When loading any rule file (e.g., `git-rules.md`), **always check if a corresponding `.local.md` file exists** (e.g., `git-rules.local.md`). If it exists, apply both files with the local file taking precedence.

## Extension Pattern

Local files use inheritance semantics:

- **Inherits**: All sections from the base file apply unless overridden
- **Override**: A section with the same name in the local file replaces the base section
- **Extend**: New sections in the local file add to the base rules

## File Naming Convention

| Base File | Local Extension |
|-----------|-----------------|
| `git-rules.md` | `git-rules.local.md` |
| `coding-standards.md` | `coding-standards.local.md` |
| `testing-principles.md` | `testing-principles.local.md` |

## Local File Format

Local extension files should include:

1. A title indicating it's a local extension
2. An `> Extends:` directive referencing the base file
3. Sections that override or extend the base

### Example: `git-rules.local.md`

```markdown
# Git Rules (Local Extensions)

> Extends: git-rules.md

## Commit Messages (Override)
- Use format: `[JIRA-123] type: description`
- All commits MUST reference a Jira ticket

## Branch Naming (New Section)
- Feature branches: `feature/JIRA-123-description`
- Bugfix branches: `bugfix/JIRA-123-description`
```

## For Skills

Custom skills use a `.local.md` file name suffix too:

## Important

- Local files are **preserved** during package updates
- Local files are **not** created automatically - users create them manually when needed
- Always apply local extensions when they exist
