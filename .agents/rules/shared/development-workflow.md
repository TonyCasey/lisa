# Development Workflow

This document describes the process for developing new skills, hooks, and rules in this repository.

## Core Principle

**Always create source files in `src/templates/` first.**

The build process compiles TypeScript and deploys files to their runtime locations:

```
src/templates/  →  build  →  dist/  →  deploy  →  .agents/, .claude/, .codex/
    (source)                              (runtime locations)
```

Never edit files directly in `.agents/`, `.claude/`, or `.codex/` - they will be overwritten on build.

## Directory Structure

| Type | Source Location | Deployed To |
|------|-----------------|-------------|
| Skills | `src/templates/agents/skills/` | `.agents/skills/` |
| Claude Hooks | `src/templates/claude/hooks/` | `.claude/hooks/` |
| Codex Hooks | `src/templates/codex/hooks/` | `.codex/hooks/` |
| Rules | `src/templates/rules/` | `.agents/rules/` |

## Creating a New Skill

### 1. Create the skill directory

```
src/templates/agents/skills/<skill-name>/
├── SKILL.md           # Skill definition
└── scripts/
    └── <skill-name>.ts  # Implementation script
```

### 2. Write the SKILL.md

```yaml
---
name: my-skill
description: "Short description for model trigger matching"
---

## Purpose
What this skill does and when to use it.

## Triggers
When the model should invoke this skill:
- "user says X"
- "user asks about Y"

## How to use
1) Run script: `node scripts/my-skill.js <args>`
2) Process JSON output
3) Summarize results to user

## I/O contract
- Input: command line arguments
- Output: `{ status: "ok", action: "...", ... }`
- Fallback: `{ status: "fallback", error: "...", fallback: {...} }`

## Cross-model checklist
- Codex: Verify trigger phrases; use explicit script paths
- Claude: Keep instructions concise; conversational output
- Gemini: Explicit commands; avoid model-specific tokens
```

### 3. Implement the script

Scripts should:
- Be executable with Node.js (`#!/usr/bin/env node`)
- Output JSON to stdout
- Support `--cache` flag for fallback behavior
- Read config from `.agents/skills/.env`

### 4. Build and test

```bash
npm run build        # Compile and deploy
# Test the skill manually or via the model
```

## Creating a New Hook

### 1. Create the hook file

**For Claude Code:**
```
src/templates/claude/hooks/<hook-name>.ts
```

**For Codex:**
```
src/templates/codex/hooks/<hook-name>.ts
```

### 2. Common utilities

Shared code goes in the `common/` directory:
```
src/templates/claude/hooks/common/
src/templates/codex/hooks/common/
```

### 3. Hook types

**Claude Code hooks:**
- `session-start.ts` - Runs when Claude Code starts
- `session-stop.ts` - Runs when session ends
- `user-prompt-submit.ts` - Runs before each user message

**Codex hooks:**
- `session_start.ts` - Session initialization
- `session_end.ts` - Session cleanup
- `per_prompt.ts` - Per-message processing

### 4. Build deploys to runtime

```bash
npm run build
# Hooks are now in .claude/hooks/ or .codex/hooks/
```

## Creating a New Rule

### 1. Choose the location

**Language-agnostic rules:**
```
src/templates/rules/shared/<rule-name>.md
```

**Language-specific rules:**
```
src/templates/rules/typescript/<rule-name>.md
src/templates/rules/python/<rule-name>.md
```

### 2. Write the rule

Rules are markdown files that provide guidance to AI models. They should:
- Be clear and actionable
- Include examples (good and bad)
- Use tables for quick reference
- Include checklists where appropriate

### 3. Build deploys to .agents/rules/

```bash
npm run build
# Rules are now in .agents/rules/ and auto-loaded by Claude Code
```

## Testing

### Unit tests

Add tests alongside source files:
```
src/templates/claude/hooks/common/__tests__/<module>.test.ts
```

Run tests:
```bash
npm test
```

### Manual testing

After building, test skills and hooks manually:
```bash
# Test a skill script directly
node .agents/skills/memory/scripts/memory.js load --cache

# Test hooks by running Claude Code
claude
```

## Build Commands

```bash
npm run build       # Full build: compile TS + deploy templates
npm run build:local # Build for local development (DEPLOY_AGENTS_LOCAL=1)
npm test            # Run tests
npm run lint        # Lint code
```

## Checklist for New Components

- [ ] Source files created in `src/templates/`
- [ ] TypeScript compiles without errors
- [ ] Tests added for non-trivial logic
- [ ] SKILL.md includes all required sections (for skills)
- [ ] Cross-model compatibility considered
- [ ] Build succeeds and deploys correctly
- [ ] Manual testing completed
