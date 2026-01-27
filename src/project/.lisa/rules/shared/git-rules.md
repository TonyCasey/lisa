# Git Workflow Rules

## Branch & PR Workflow

### Branch Naming

- Create a branch and PR for each issue
- Use the issue number as the branch name (no text)
- Examples: `11`, `12`, `23`

### Commit Messages

- Use conventional commit format: `type: description`
- Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`
- Keep first line under 72 characters
- Add body for complex changes
- Keep commits focused and atomic
- Don't mix unrelated changes in one commit

## Development Checklist

Before committing, ensure:

1. **Cover new code with tests** - all new functionality must have test coverage
2. **Run full tests** on the branch before committing
3. **Check for linting errors**
4. **Review staged changes** with `git diff --staged`
5. **Update documentation** - update relevant docs (except README.md)
6. **Update CHANGELOG.md** with changes

## Solution-Issue Review

Before pushing to GitHub, perform a solution-issue review:

1. **What was the issue/feature?**
2. **Has the current solution addressed the issue/feature?**
3. **Has the solution fulfilled the requirements?**

If the answer to any of these is **no**:
- Go back and update the changes to match the requirements
- Repeat the solution-issue review
- Iterate for a **maximum of 3 iterations**

## Version & PR Creation

Use the `/git` skill for version bumping and PR operations:

```bash
# Bump version before pushing (default: minor)
lisa bump-version

# Or specify: patch, minor, major
lisa bump-version patch
```

Use the `/pr` skill to create PRs:

```bash
# Create PR (auto-links issues from branch name, auto-generates body)
lisa pr create

# Create PR linking specific issues
lisa pr create --issue 40 --issue 41
```

## After PR is Created

### Update Ticket Status

Use the `/jira` skill to transition tickets to Code Review:

```bash
lisa jira transition PROJ-123 --to "Code Review"
```

Or use the `/github` skill to update GitHub issue labels:

```bash
lisa github issues label --repo owner/repo 123 --add in-progress
```

### Monitor CI

Use the `/pr` skill to check CI status:

```bash
lisa pr checks <PR_NUMBER>
```

## After Merge

### 1. Create Milestone Memory

```bash
lisa memory add "<summary>" --cache --type milestone
```

The summary should describe:
- What was added/changed/fixed
- Key features or improvements
- Any breaking changes

### 2. Update Lisa Tasks

```bash
lisa tasks update "Task description" --status done
```

### 3. Update External Tickets

Use `/jira` skill:
```bash
lisa jira transition PROJ-123 --to "Done"
```

Or `/github` skill:
```bash
lisa github issues close --repo owner/repo 123
```

## Examples

**Feature commit:**
```bash
lisa memory add "FEATURE: [#42] Added Excel brandlist parser with unit tests" --cache --type milestone
lisa tasks update "Excel parser" --status done
lisa github issues close --repo owner/repo 42
```

**Bug fix:**
```bash
lisa memory add "FIX: Resolved race condition in database connection pooling" --cache --type milestone
```

## Why Memory Matters

- Creates a searchable history of development progress
- Keeps task status accurate across sessions
- Helps future sessions understand what was achieved
- Builds project context for AI assistants
- Tracks milestones and features over time

## Related Skills

- `/git` - Version bumping, CI retriggers, push workflows
- `/pr` - PR creation, CI checks, comment tracking
- `/github` - GitHub Issues and Projects management
- `/jira` - Jira ticket transitions and management
- `/memory` - Milestone and fact storage
- `/tasks` - Lisa task management
