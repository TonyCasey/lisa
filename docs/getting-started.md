# Getting Started with Lisa

Lisa gives your AI coding assistants persistent memory. Once installed, Claude Code and other AI assistants automatically remember your project context, decisions, and coding patterns across sessions.

## Prerequisites

- **Node.js** 18+
- **Git** repository (memories are stored in git notes)

That's it! No Docker, no external services, no API keys required.

## Quick Start

```bash
# Install Lisa globally
npm install -g @tonycasey/lisa

# Navigate to your project (must be a git repository)
cd your-project

# Initialize Lisa
lisa init
```

Lisa is now ready. Start coding with Claude Code and your context will persist across sessions.

## How It Works

Lisa uses **git-mem** to store memories directly in your git repository using git notes (`refs/notes/mem`). This means:

- **No external services** - Everything stays in your repo
- **Version controlled** - Memories travel with your code
- **Instant access** - No network latency, synchronous reads/writes
- **Private by default** - Your data never leaves your machine

### Session Hooks

When you use Claude Code, Lisa automatically:

1. **Session Start** - Loads relevant memories, tasks, and recent git history
2. **Session Stop** - Analyzes your session and captures significant work

See [Architecture Flows](./architecture/flows.md) for detailed sequence diagrams.

## CLI Commands

```bash
# Check installation status
lisa doctor

# Memory operations
lisa memory add "DECISION: Using PostgreSQL for better JSON support"
lisa memory load --limit 20

# Task management
lisa tasks add "Implement user authentication" --status todo
lisa tasks list
lisa tasks update "Implement user authentication" --status done
```

## What Gets Created

After running `lisa init`:

```
your-project/
├── .lisa/
│   ├── skills/           # Memory and task skills
│   │   ├── memory/
│   │   ├── tasks/
│   │   ├── lisa/
│   │   └── ...
│   ├── rules/            # Coding standards
│   │   ├── shared/       # Language-agnostic rules
│   │   └── typescript/   # TypeScript-specific rules
│   └── .env              # Configuration (LOG_LEVEL, etc.)
│
├── .claude/              # Claude Code integration
│   ├── settings.json     # Hook configuration
│   ├── hooks/            # Session start/stop hooks
│   ├── skills -> ../.lisa/skills
│   └── rules -> ../.lisa/rules
│
└── .gitattributes        # (updated to handle notes refs)
```

## Verify Installation

```bash
lisa doctor
```

You should see:

```
✓ Lisa Structure: .lisa directory configured
✓ Claude Code Hooks: 3 hook(s) configured
✓ Git Repository: Initialized
✓ git-mem: Available

Overall: OK
```

## Using Skills

Skills are invoked in Claude Code with `/skill-name`:

| Skill | Trigger | Description |
|-------|---------|-------------|
| `/memory` | "remember", "recall" | Store and retrieve project memories |
| `/tasks` | "tasks", "add task" | Manage work items |
| `/lisa` | "lisa", "hey lisa" | Natural language interface |
| `/github` | "create pr", "github issues" | GitHub workflow helpers |

### Memory Types

Use prefixes for automatic categorization:

```bash
lisa memory add "DECISION: Use JWT for authentication"     # → code:decision
lisa memory add "BUG: Race condition in connection pool"   # → context:bug
lisa memory add "CONVENTION: Files use kebab-case"         # → code:convention
lisa memory add "MILESTONE: Auth module complete"          # → milestone
```

### Task Workflow

```bash
# Create a task
lisa tasks add "Fix login validation" --status todo

# Start working on it
lisa tasks update "Fix login validation" --status doing

# Mark complete
lisa tasks update "Fix login validation" --status done
```

## Sharing Memories

Since memories are stored in git notes, you can share them:

```bash
# Push memories to remote
git push origin refs/notes/mem

# Fetch memories from remote
git fetch origin refs/notes/mem:refs/notes/mem
```

**Note:** By default, git doesn't push/fetch notes. Add to your `.git/config`:

```ini
[remote "origin"]
    fetch = +refs/notes/*:refs/notes/*
    push = refs/notes/*
```

## Uninstalling

To remove Lisa from a project:

```bash
# Remove Lisa directories
rm -rf .lisa .claude/hooks .claude/skills .claude/rules

# Remove git notes (optional - deletes all memories)
git notes --ref=mem prune
git update-ref -d refs/notes/mem
```

## Next Steps

- [Commands Reference](./commands.md) - Full CLI documentation
- [Configuration](./configuration.md) - Environment variables and settings
- [Using Skills](./skills.md) - How memory and tasks work
- [Architecture Flows](./architecture/flows.md) - How session hooks and skills work under the hood
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions
