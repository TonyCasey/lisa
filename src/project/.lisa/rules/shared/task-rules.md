# Task Rules

Guidelines for using Lisa's task management system (`/tasks` skill) to track work across sessions.

## When to Create Tasks

### Create Tasks For

1. **Planned work** - Features, fixes, or improvements to implement
2. **Discovered issues** - Bugs or problems found during development
3. **Follow-ups** - Work identified but deferred to later
4. **Dependencies** - Work blocked by external factors

### Don't Create Tasks For

- Completed work (use memories instead)
- One-off commands or queries
- Work already tracked in Jira/GitHub Issues

## Task Status Workflow

```
todo → doing → done
        ↓
     blocked
```

| Status | When to Use |
|--------|-------------|
| `todo` | Work planned but not started |
| `doing` | Actively working on |
| `done` | Completed |
| `blocked` | Waiting on external dependency |

## Task Commands

### Create Task

```bash
# Basic task
lisa tasks add "Implement user authentication" --cache

# With status
lisa tasks add "Fix login validation" --status doing --cache

# With tags
lisa tasks add "Update API docs" --tag docs --tag api --cache
```

### List Tasks

```bash
# All tasks
lisa tasks list --cache

# With limit
lisa tasks list --cache --limit 10

# Tasks created today
lisa tasks list --since today --cache

# Tasks from the last 7 days
lisa tasks list --since 7d --cache

# Tasks from the last week
lisa tasks list --since 1w --cache

# Tasks within a date range
lisa tasks list --since 2026-01-01 --until 2026-01-31 --cache
```

### Update Task

```bash
# Mark as doing
lisa tasks update "Implement user authentication" --status doing

# Mark as done
lisa tasks update "Implement user authentication" --status done

# Mark as blocked
lisa tasks update "Implement user authentication" --status blocked
```

## Task Naming Conventions

### Format

```
<Action verb> <subject> [<context>]
```

### Good Examples

- "Implement Excel parser for brandlist imports"
- "Fix race condition in connection pooling"
- "Add unit tests for OrderService"
- "Update API documentation for v2 endpoints"
- "Refactor authentication to use JWT"

### Bad Examples

- "Excel stuff" (too vague)
- "Bug" (no description)
- "WIP" (not actionable)
- "JIRA-123" (use the description, link separately)

## Task Workflow

### Starting a Session

1. Load existing tasks to see what's pending:
   ```bash
   lisa tasks list --cache
   ```

2. Pick a task and mark as doing:
   ```bash
   lisa tasks update "Task name" --status doing
   ```

### During Work

- Keep only ONE task as `doing` at a time
- If blocked, update status and note the blocker
- If discovering new work, create new tasks

### Completing Work

1. Mark task as done:
   ```bash
   lisa tasks update "Task name" --status done
   ```

2. Create a milestone memory (see memory-rules.md):
   ```bash
   lisa memory add "MILESTONE: Completed <task>" --type milestone --cache
   ```

## Integration with External Trackers

### Jira Integration

When working on Jira tickets:

1. Create Lisa task referencing ticket:
   ```bash
   lisa tasks add "PROJ-123: Implement feature X" --cache
   ```

2. Update Jira status via `/jira` skill:
   ```bash
   lisa jira transition PROJ-123 --to "In Progress"
   ```

3. Keep both in sync as you work

### GitHub Issues Integration

Use `/github` skill for bidirectional sync:

```bash
# Import GitHub issues as tasks
lisa github sync --repo owner/repo --import

# Export tasks to GitHub
lisa github sync --repo owner/repo --export

# Full sync
lisa github sync --repo owner/repo
```

## Task vs Memory

| Use Tasks For | Use Memory For |
|---------------|----------------|
| Work to be done | Work completed |
| Current status | Historical record |
| Action items | Decisions made |
| Blockers | Lessons learned |

## Task Hygiene

### Daily

- Review active tasks
- Update statuses
- Close completed work

### Weekly

- Clean up stale tasks
- Archive or cancel abandoned work
- Sync with external trackers

### Session End

Before ending a session:
1. Update task statuses
2. Note any blockers
3. Create memories for completed work

## Related Skills

- `/lisa` - Natural language interface ("lisa, what tasks do we have")
- `/memory` - For completed work and learnings
- `/jira` - Jira ticket management
- `/github` - GitHub Issues sync
- `/git` - Post-commit task updates
