# Skills

Skills are model-neutral capabilities that AI assistants can invoke. Lisa includes built-in skills for memory and task management.

## How Skills Work

1. **Trigger phrases** activate skills (e.g., "remember that...", "hey lisa...")
2. **SKILL.md** defines when and how to use the skill
3. **Scripts** execute the actual logic (JavaScript)
4. **Output** is returned to the AI assistant

Skills are stored in `.lisa/skills/` and work with Claude Code, OpenCode, and other compatible assistants.

## Built-in Skills

### Lisa (Router)

**Location:** `.lisa/skills/lisa/`

The main entry point that routes natural language to appropriate skills.

**Trigger phrases:**
- "hey lisa..."
- "lisa, ..."
- Addressing Lisa directly

**Examples:**
```
"hey lisa, show me recent memories"
"lisa, what do you know about the auth system?"
"lisa, what tasks are we working on?"
```

### Memory

**Location:** `.lisa/skills/memory/`

Stores and retrieves project context via Graphiti MCP.

**Trigger phrases:**
- "remember that..."
- "recall..."
- "load memory"
- "what do you know about..."

**Examples:**
```
"remember that we decided to use PostgreSQL"
"recall the authentication flow"
"what do you know about the API design?"
```

**What gets stored:**
- Design decisions and rationale
- Bug patterns and fixes
- Architecture choices
- Coding standards
- Project context

### Tasks

**Location:** `.lisa/skills/tasks/`

Manages tasks and to-dos via Graphiti MCP.

**Trigger phrases:**
- "add task..."
- "list tasks"
- "what tasks..."
- "show tasks"

**Examples:**
```
"add task: implement user authentication"
"list tasks for this sprint"
"what tasks are blocked?"
```

### Prompt

**Location:** `.lisa/skills/prompt/`

Captures prompts to memory for context building. This skill runs automatically via hooks - you don't typically invoke it directly.

### Git

**Location:** `.lisa/skills/git/`

GitHub and Git workflow helpers.

**Trigger phrases:**
- "create pr"
- "pr checks"
- "retrigger tests"
- "bump version"

### Jira

**Location:** `.lisa/skills/jira/`

Create and manage Jira issues.

**Trigger phrases:**
- "jira"
- "create ticket"
- "list issues"

### GitHub

**Location:** `.lisa/skills/github/`

GitHub issues and projects management.

**Trigger phrases:**
- "github"
- "create issue"
- "list issues"
- "sync tasks"

**Features:**
- Create, view, close, and reopen issues
- Manage labels and assignees
- Projects v2 integration (list, view, add items, set fields)
- **Bidirectional sync** between GitHub Issues and Lisa tasks

## GitHub Issues Sync

Lisa automatically syncs GitHub Issues to tasks on every new session start:

1. **On session startup:** Detects GitHub repo from git remote
2. **Imports new issues:** Creates Lisa tasks with `externalLink` metadata
3. **Updates status:** Reflects closed/reopened issues in task status
4. **Non-blocking:** Session continues even if sync fails

**Manual sync:**
```bash
# Import GitHub issues to Lisa tasks
lisa github sync --repo owner/repo --import

# Export Lisa tasks to GitHub issues
lisa github sync --repo owner/repo --export

# Bidirectional sync
lisa github sync --repo owner/repo

# Dry run (preview changes)
lisa github sync --repo owner/repo --dry-run
```

**Status mapping:**
| Lisa Status | GitHub State |
|-------------|--------------|
| `ready`/`todo` | open |
| `in-progress` | open + `in-progress` label |
| `blocked` | open + `blocked` label |
| `done` | closed |

## Skill Structure

Each skill has this structure:

```
.lisa/skills/<skill-name>/
└── SKILL.md           # Definition and instructions
```

Skill implementations are part of the `lisa` CLI and invoked via subcommands:

```bash
lisa memory load      # Load memories
lisa memory add       # Add a memory
lisa tasks list       # List tasks
lisa tasks add        # Add a task
```

The `SKILL.md` file tells the AI assistant when to invoke these commands and how to interpret the output.

### SKILL.md Format

```markdown
---
name: my-skill
description: "Short description for trigger matching"
---

## Purpose
What this skill does and when to use it.

## Triggers
When to invoke this skill:
- "user says X"
- "user asks about Y"

## How to use
1. Run CLI command: `lisa <skill> <action> [args]`
2. Process JSON output
3. Summarize results to user

## I/O contract
- Input: command line arguments
- Output: JSON to stdout
- Fallback: JSON with fallback data if backend unavailable
```

## Cache Fallback

Skills support offline operation via `--cache` flag:

```bash
lisa memory load --cache
```

If the MCP server is unavailable, skills return cached data from the last successful operation.
You can override the cache location with `LISA_SKILL_CACHE_DIR` (or `LISA_CACHE_DIR`) to ensure a writable path, e.g. `.lisa/skills/<skill>/cache` in the current repo.

## Environment Variables

Skills read configuration from `.lisa/.env`:

```env
GRAPHITI_ENDPOINT=http://localhost:8010/mcp/
GRAPHITI_GROUP_ID=my-project
LOG_LEVEL=debug
```

## Creating Custom Skills

### Quick Overview

1. Create directory: `src/project/.lisa/skills/<name>/`
2. Add `SKILL.md` with triggers and instructions
3. Add skill implementation in `src/lib/skills/<name>/<name>.ts`
4. Add CLI subcommand in `src/lib/cli.ts`
5. Run `npm run build` to compile and deploy
6. Test with your AI assistant

See [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-skill) for detailed instructions.

## Plan Mode Recursion

When in **plan mode**, Lisa automatically searches memory for relevant context before you start planning. This surfaces:

- **Previous decisions** - What was decided and why
- **Learnings** - Insights from retrospectives
- **Related tasks** - What's been done or is in progress

This helps ensure your plans are informed by historical context.

## Entity Classification

Lisa uses **Entity Classification Schema v1.0** to organize memories:

| Category | Types |
|----------|-------|
| Code & Architecture | Decision, Pattern, Dependency, TechDebt |
| Context & History | BugPattern, Rationale, FailedApproach, EnvironmentQuirk |
| External | UserFeedback, Incident, ApiContract |
| People & Process | Contributor, Blocker, Estimate |
| Project Scope | ScopeIn, ScopeOut, Milestone |
| Standard | Preference, Requirement, Procedure |

These classifications help with semantic search and retrieval.
