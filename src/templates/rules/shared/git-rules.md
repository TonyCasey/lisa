# Git Workflow Rules

## Commit Memory Rule

**IMPORTANT:** After every successful git commit, you MUST create a milestone memory summarizing what was committed.

### How to Create Commit Memory

After a commit succeeds, run:
```bash
node .agents/skills/memory/scripts/memory.js add "<summary>" --cache --type milestone
```

### Summary Format

The summary should be concise and describe:
- What was added/changed/fixed
- Key features or improvements
- Any breaking changes

### Examples

**Feature commit:**
```bash
node .agents/skills/memory/scripts/memory.js add "FEATURE: Added user authentication with JWT tokens and session management" --cache --type milestone
```

**Bug fix:**
```bash
node .agents/skills/memory/scripts/memory.js add "FIX: Resolved race condition in database connection pooling" --cache --type milestone
```

**Refactor:**
```bash
node .agents/skills/memory/scripts/memory.js add "REFACTOR: Migrated API handlers to use clean architecture pattern" --cache --type milestone
```

### Why This Matters

- Creates a searchable history of development progress
- Helps future sessions understand what was accomplished
- Builds project context for AI assistants
- Tracks milestones and features over time

## General Git Rules

### Commit Messages

- Use conventional commit format: `type: description`
- Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`
- Keep first line under 72 characters
- Add body for complex changes

### Before Committing

- Run tests if available
- Check for linting errors
- Review staged changes with `git diff --staged`

### Branch Hygiene

- Keep commits focused and atomic
- Don't mix unrelated changes in one commit
- Write meaningful commit messages
