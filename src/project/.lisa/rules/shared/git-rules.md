# Git Workflow Rules

## Commit Memory Rule

**IMPORTANT:** After every successful git commit, you MUST do TWO things:
1. Create a milestone memory summarizing what was committed
2. Update the task status if completing a Jira ticket

### Step 1: Create Commit Memory

After a commit succeeds, run:
```bash
lisa memory add "<summary>" --cache --type milestone
```

### Step 2: Update Task Status (for tickets)

If the commit completes ticket (JIRA-1234), also run:
```bash
lisa tasks add "JIRA-1234: COMPLETED - <description>" --cache --status done
```

### Summary Format

The summary should be concise and describe:
- What was added/changed/fixed
- Key features or improvements
- Any breaking changes

### Examples

**Feature commit (with Jira ticket):**
```bash
# Step 1: Save milestone
lisa memory add "FEATURE: [JIRA-1234] Added Excel brandlist parser with unit tests" --cache --type milestone

# Step 2: Update task status
lisa tasks add "JIRA-1234: COMPLETED - Excel brandlist parser utility created, PR #XXXX" --cache --status done
```

**Bug fix:**
```bash
lisa memory add "FIX: Resolved race condition in database connection pooling" --cache --type milestone
```

**Refactor:**
```bash
lisa memory add "REFACTOR: Migrated API handlers to use clean architecture pattern" --cache --type milestone
```

### Why This Matters

- Creates a searchable history of development progress
- Keeps task status accurate across sessions
- Helps future sessions understand what was achieved
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


## Pull Requests

Follow generic guidelines for pull requests, ensuring all required information is provided in the description.