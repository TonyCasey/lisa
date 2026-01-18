# Skills

Skills are model-neutral capabilities that AI assistants can invoke. Lisa includes built-in skills for memory and task management.

## How Skills Work

1. **Trigger phrases** activate skills (e.g., "remember that...", "hey lisa...")
2. **SKILL.md** defines when and how to use the skill
3. **Scripts** execute the actual logic (JavaScript)
4. **Output** is returned to the AI assistant

Skills are stored in `.lisa/skills/` and work with Claude Code, Codex, and other compatible assistants.

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

Captures prompts to memory for context building.

This skill runs automatically via hooks - you don't typically invoke it directly.

## Skill Structure

Each skill has this structure:

```
.lisa/skills/<skill-name>/
├── SKILL.md           # Definition and instructions
└── scripts/
    └── <skill-name>.js  # Implementation
```

### SKILL.md Format

```yaml
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

## Environment Variables

Skills read configuration from `.lisa/.env`:

```env
GRAPHITI_ENDPOINT=http://localhost:8010/mcp/
GRAPHITI_GROUP_ID=my-project
```

## Creating Custom Skills

See [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-skill) for instructions on creating custom skills.

### Quick Overview

1. Create directory: `src/project/.lisa/skills/<name>/`
2. Add `SKILL.md` with triggers and instructions
3. Add `scripts/<name>.ts` with implementation
4. Run `npm run build` to compile and deploy
5. Test with your AI assistant

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
