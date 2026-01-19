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

## Skill Structure

Each skill has this structure:

```
.lisa/skills/<skill-name>/
├── SKILL.md           # Definition and instructions
└── scripts/
    └── <skill-name>.js  # Implementation
```

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
1. Run script: `node scripts/my-skill.js <args>`
2. Process JSON output
3. Summarize results to user

## I/O contract
- Input: command line arguments
- Output: JSON to stdout
- Fallback: JSON with fallback data if MCP unavailable
```

## Cache Fallback

Skills support offline operation via `--cache` flag:

```bash
node scripts/memory.js load --cache
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
3. Add `scripts/<name>.ts` with implementation
4. Run `npm run build` to compile and deploy
5. Test with your AI assistant

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
