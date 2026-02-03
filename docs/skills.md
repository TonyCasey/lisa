# Skills

Skills are model-neutral capabilities that AI assistants can invoke. Lisa includes built-in skills for memory management, task tracking, PR workflows, and integrations.

## How Skills Work

1. **Trigger phrases** activate skills (e.g., "remember that...", "hey lisa...")
2. **SKILL.md** defines when and how to use the skill
3. **CLI commands** execute the actual logic (`lisa <skill> <action>`)
4. **Output** is returned to the AI assistant as JSON

Skills are stored in `.lisa/skills/` and work with Claude Code, OpenCode, and other compatible assistants.

## Built-in Skills

### Lisa (Router)

**Location:** `.lisa/skills/lisa/`
**Invoke:** `/lisa`

The main entry point that routes natural language to appropriate skills.

**Trigger phrases:**
- "hey lisa..."
- "lisa, ..."
- "ask lisa..."

**Examples:**
```
"hey lisa, show me recent memories"
"lisa, what do you know about the auth system?"
"lisa, what tasks are we working on?"
"lisa, do a retrospective"
```

**Routes to:**
- Memory operations -> `lisa memory load/add`
- Task operations -> `lisa tasks list/add`
- Storage operations -> `lisa storage status/switch`
- Skill compilation -> `lisa compile-skills`

### Memory

**Location:** `.lisa/skills/memory/`
**Invoke:** `/memory`

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

**Commands:**
```bash
# Load memories
lisa memory load --cache [--query <q>] [--limit 10]

# Add a memory
lisa memory add "<text>" --cache [--type milestone] [--tag foo]

# Memory lifecycle management
lisa memory expire                  # Expire old ephemeral/session facts
lisa memory cleanup                 # Remove expired and low-quality facts
lisa memory conflicts               # Detect contradictory facts
lisa memory dedupe                  # Find and remove duplicate facts
lisa memory curate                  # LLM-powered quality assessment
lisa memory consolidate             # Merge related facts
lisa memory summarize               # Generate period summaries
```

**What gets stored:**
- Design decisions and rationale
- Bug patterns and fixes
- Architecture choices
- Coding standards
- Session-captured work (automatic)

**Memory Lifecycle:**
Facts have lifecycle tiers that control retention:

| Lifecycle | TTL | Use Case |
|-----------|-----|----------|
| `permanent` | Never expires | Decisions, conventions, milestones |
| `project` | 90 days | Project-specific context |
| `session` | 7 days | Auto-captured session work |
| `ephemeral` | 24 hours | Prompt recording, temporary notes |

**Quality Tags:**
Facts include quality metadata:
- `source:` - Where the fact came from (manual, session-capture, llm-extracted)
- `confidence:` - How confident (high, medium, low)
- `taskType:` - Session type (feature, bugfix, refactor, planning)

### Tasks

**Location:** `.lisa/skills/tasks/`
**Invoke:** `/tasks`

Manages tasks and to-dos via Graphiti MCP.

**Trigger phrases:**
- "add task..."
- "list tasks"
- "what tasks..."
- "show tasks"

**Commands:**
```bash
# List tasks
lisa tasks list --cache [--limit 20] [--all] [--since today]

# Add a task
lisa tasks add "<task text>" [--status todo|doing|done] [--tag foo] --cache
```

### PR (Pull Request Workflow)

**Location:** `.lisa/skills/pr/`
**Invoke:** `/pr`

Complete PR lifecycle management - create, review, check CI, poll for comments, address feedback.

**Trigger phrases:**
- "create pr"
- "pr checks"
- "pr poll"
- "watch pr"
- "pr address"

**Commands:**
```bash
# Create a PR (auto-links issues from branch name)
lisa pr create [--issue 40] [--title "..."] [--base branch] [--draft]

# Check CI status
lisa pr checks <PR_NUMBER> [--repo owner/repo]

# View comments
lisa pr comments <PR_NUMBER> [--filter pending|addressed]

# Watch for new comments/reviews
lisa pr watch <PR_NUMBER>
lisa pr unwatch <PR_NUMBER>
lisa pr watching [--repo owner/repo]

# Poll for changes since last check
lisa pr poll <PR_NUMBER> [--no-auto-address]

# Address review comments
lisa pr address <PR_NUMBER> [--context 10]

# Link PR to issue
lisa pr link <PR_NUMBER> <ISSUE_NUMBER>

# Save PR context to memory
lisa pr remember <PR_NUMBER> "<note>"

# Check status of all watched PRs
lisa pr status [--repo owner/repo]
```

**Features:**
- Auto-detects linked issues from branch name
- Auto-generates PR body from commits
- Auto-watches PR after creation for polling
- Comments on linked issues with PR reference
- Memory integration with `type:pr` tags

### Git

**Location:** `.lisa/skills/git/`
**Invoke:** `/git`

GitHub and Git workflow helpers.

**Trigger phrases:**
- "create pr" (routes to `/pr`)
- "pr checks"
- "retrigger tests"
- "bump version"
- "push"

**Commands:**
```bash
# Bump version
lisa bump-version [patch|minor|major]

# CI management via gh CLI
gh pr checks <PR_NUMBER>
```

### Jira

**Location:** `.lisa/skills/jira/`
**Invoke:** `/jira`

Create and manage Jira issues via REST API.

**Trigger phrases:**
- "jira"
- "create ticket"
- "list issues"

**Commands:**
```bash
# Create issues
lisa jira create --project PROJ --type story --summary "..."

# List issues
lisa jira list --project PROJ [--jql "status = Open"]

# View issue
lisa jira view PROJ-123

# Assign
lisa jira assign PROJ-123 --to me

# Transition
lisa jira transition PROJ-123 --to "In Progress"

# Change type
lisa jira change-type PROJ-123 --to story
```

**Issue types:** epic, story, task, subtask, bug

### GitHub (Issues & Projects)

**Location:** `.lisa/skills/github/`

GitHub Issues and Projects v2 management via `gh` CLI.

**Trigger phrases:**
- "github"
- "create issue"
- "list issues"
- "sync tasks"

**Commands:**
```bash
# Issues
lisa issue create --title "..." [--label bug]
lisa issue labels [--repo owner/repo]

# Sync between Lisa tasks and GitHub Issues
lisa github sync --repo owner/repo --import
lisa github sync --repo owner/repo --export
lisa github sync --repo owner/repo              # Bidirectional
lisa github sync --repo owner/repo --dry-run
```

**Status mapping:**

| Lisa Status | GitHub State |
|-------------|--------------|
| `ready`/`todo` | open |
| `in-progress` | open + `in-progress` label |
| `blocked` | open + `blocked` label |
| `done` | closed |

### Init Review

**Location:** `.lisa/skills/init-review/`

Automatically analyzes a codebase when Lisa is first installed, creating a foundational memory of the project structure.

**Trigger phrases:**
- "run init review"
- "analyze this codebase"
- "scan the project"

**Commands:**
```bash
lisa init-review run [--force]    # Run codebase analysis
lisa init-review show             # Show existing review
lisa init-review status           # Check if review exists
```

**Output:** Structured analysis including language detection, frameworks, build tools, entry points, dependencies, and architecture patterns.

### Prompt

**Location:** `.lisa/skills/prompt/`

Captures user prompts to memory for context building. Runs automatically via the prompt submit hook - you don't typically invoke it directly.

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

## Skill Structure

Each skill has this structure:

```
.lisa/skills/<skill-name>/
└── SKILL.md           # Definition and instructions
```

Skill implementations are part of the `lisa` CLI. Commands are organized in `src/lib/commands/`:

```
src/lib/commands/
├── knowledge.ts       # lisa memory *, lisa tasks *, lisa pref *
├── pr.ts              # lisa pr *
├── issue.ts           # lisa issue *
├── hooks.ts           # lisa hook *
├── skills.ts          # lisa compile-skills, lisa scan, lisa init-review
└── index.ts           # Top-level registration
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
LOG_LEVEL=debug
```

Note: The group ID is automatically derived from the project folder path and does not need to be configured manually.

## Plan Mode Recursion

When in **plan mode**, Lisa automatically searches memory for relevant context before you start planning. This surfaces:

- **Previous decisions** - What was decided and why
- **Learnings** - Insights from retrospectives
- **Related tasks** - What's been done or is in progress

This helps ensure your plans are informed by historical context.

## LLM-Powered Features

Lisa has its own LLM integration (separate from the host AI assistant) for:

- **Memory curation** - `lisa memory curate` uses LLM to assess fact quality
- **Conflict detection** - `lisa memory conflicts` uses LLM to find contradictions
- **Consolidation** - `lisa memory consolidate` merges related facts via LLM
- **Transcript enrichment** - Session stop can extract structured facts from transcripts

Configure via environment variables:
```env
LISA_LLM_PROVIDER=anthropic    # or openai, openrouter
LISA_LLM_MODEL=claude-sonnet-4-20250514
LISA_LLM_API_KEY=sk-...
```

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

## Creating Custom Skills

### Quick Overview

1. Create directory: `src/project/.lisa/skills/<name>/`
2. Add `SKILL.md` with triggers and instructions
3. Add skill implementation in `src/lib/commands/<name>.ts`
4. Register subcommand in `src/lib/commands/index.ts`
5. Run `npm run build` to compile and deploy
6. Test with your AI assistant

See [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-skill) for detailed instructions.
