# Deployment Guide

This document explains how `agent-memory` is deployed and how the different workflows operate.

---

## Overview

The `agent-memory` package has two distinct deployment contexts:

1. **Developer Workflow** - Building and testing the package locally
2. **npm Consumer Workflow** - End users installing from npm

---

## Developer Workflow

### Build Process

When you run `npm run build`:

```bash
npm run build
```

**What happens:**

1. **TypeScript Compilation** (`tsc -p tsconfig.json`)
   - Compiles `src/**/*.ts` → `dist/**/*.js`
   - Generates type definitions (`.d.ts`)

2. **Template Copying** (`postbuild-copy-templates.js`)
   - Copies `src/templates/` → `dist/templates/`
   - Ensures templates are available in build output

3. **Package Preparation** (`prepare-dist-package.js`)
   - Modifies `package.json` for distribution
   - Updates paths for npm consumers

4. **Local Deployment** (`deploy-agents.js`)
   - Deploys `dist/templates/agents/` → `.agents/`
   - Deploys `dist/templates/claude/` → `.claude/`
   - Deploys `dist/templates/rules/` → `.agents/rules/`
   - Creates symlinks:
     - `.claude/rules` → `../.agents/rules`
     - `.claude/skills` → `../.agents/skills`

### Directory Structure (After Build)

```
agent-memory/
├── src/                     ← SOURCE CODE (edit here)
│   ├── cli.ts
│   ├── lib/
│   └── templates/           ← SOURCE OF TRUTH for all templates
│       ├── agents/skills/
│       ├── claude/hooks/
│       ├── codex/hooks/
│       ├── docker/
│       └── rules/
│
├── dist/                    ← COMPILED OUTPUT (generated)
│   ├── cli.js
│   ├── lib/
│   └── templates/           ← Copied from src/templates/
│
├── .agents/                 ← DEPLOYED (local developer copy)
│   ├── skills/
│   │   ├── memory/
│   │   ├── tasks/
│   │   └── prompt/
│   └── rules/
│       ├── shared/
│       └── typescript/
│
└── .claude/                 ← DEPLOYED (local developer copy)
    ├── hooks/
    ├── rules → ../.agents/rules     (symlink)
    └── skills → ../.agents/skills   (symlink)
```

### Important Notes for Developers

⚠️ **NEVER edit files in `.agents/` or `.claude/` directly!**

- These directories are **regenerated** on every build
- All changes will be lost
- Always edit source files in `src/templates/`

✅ **Edit workflow:**

1. Edit files in `src/templates/`
2. Run `npm run build`
3. Changes automatically deployed to `.agents/` and `.claude/`

---

## npm Consumer Workflow

When a user installs `agent-memory` from npm:

```bash
npm install -g agent-memory
```

**What happens:**

1. **Package Installation**
   - Downloads from npm registry
   - Installs to global `node_modules/`
   - `dist/` contents become the package root

2. **Postinstall Hook** (`postinstall.js`)
   - Runs automatically after install
   - Sets up CLI binary (`agent-memory` command)

### User Commands

Users then run commands in **their project directory**:

```bash
# Initialize memory system (no Docker)
agent-memory setup

# Initialize with Docker stack (Neo4j + Graphiti)
agent-memory init

# Start Docker stack
agent-memory up

# Stop Docker stack
agent-memory down

# Check system health
agent-memory doctor
```

### What Gets Scaffolded (User's Project)

When users run `agent-memory setup` or `agent-memory init`:

```
user-project/
├── .agents/
│   ├── skills/
│   │   ├── memory/
│   │   ├── tasks/
│   │   └── prompt/
│   └── rules/
│       ├── shared/
│       └── typescript/
│
├── .claude/
│   ├── hooks/
│   ├── config.js
│   └── settings.json
│
├── .codex/
│   ├── hooks/
│   ├── config.js
│   └── README.md
│
└── docker-compose.graphiti.yml  (if using --with-docker)
```

---

## Symlink Strategy

### Developer Environment

In the **developer's** `agent-memory` repository:

- `.claude/rules` → `../.agents/rules` (symlink)
- `.claude/skills` → `../.agents/skills` (symlink)

**Why?** Reduces duplication; rules and skills shared between Claude and agents.

### User Environment

In **user's project** (after `agent-memory setup`):

- No symlinks created by default
- `.agents/` and `.claude/` are independent copies
- Users can customize each independently

---

## Configuration Files

### mcp_server/config/

**Purpose:** Contains Graphiti MCP server configuration for Docker.

**File:** `config-docker-neo4j.yaml`

**Contents:**
- LLM provider settings (OpenAI, Anthropic, Gemini, etc.)
- Neo4j connection settings (`bolt://neo4j:7687`)
- **Entity Classification Schema v1.0** - Defines entity types:
  - Decision, Pattern, Dependency, TechDebt
  - BugPattern, Rationale, FailedApproach
  - UserFeedback, Incident, ApiContract
  - Contributor, Blocker, Milestone, etc.

**Used by:** Docker Compose stack when users run `agent-memory up`

**Deployed to:** User's project as part of Docker templates

---

## Source of Truth

### Templates

**Location:** `src/templates/`

**Contains:**
- `agents/skills/` - Memory, Tasks, Prompt skills
- `claude/hooks/` - Claude Code session hooks (TypeScript)
- `codex/hooks/` - Codex session hooks (TypeScript)
- `docker/` - Docker Compose templates
- `rules/` - Coding standards and architecture guidelines

**All template edits happen here.**

### Rules

**Current rules in `src/templates/rules/shared/`:**
- `clean-architecture.md`
- `code-quality-rules.md`
- `testing-principles.md`

**Language-specific:** `rules/typescript/`

### Skills

**Available skills:**
- **memory** - Load/remember project context via Graphiti MCP
- **tasks** - Create, load, summarize tasks
- **prompt** - Capture prompts to Graphiti memory

---

## Testing Deployment

### Test Local Build

```bash
npm run build
```

**Verify:**
- `dist/` contains compiled JavaScript
- `.agents/` updated with latest templates
- `.claude/` updated with latest templates
- Symlinks created correctly

### Test npm Package

```bash
# Create tarball
npm pack

# Install in test directory
mkdir test-install && cd test-install
npm install -g ../agent-memory-0.5.0.tgz

# Test commands
agent-memory doctor
agent-memory setup
```

**Verify:**
- `agent-memory` command available
- `setup` creates `.agents/`, `.claude/`, `.codex/`
- Templates deployed correctly

### Clean Up Test

```bash
npm uninstall -g agent-memory
cd .. && rm -rf test-install
```

---

## Publishing to npm

### Prerequisites

1. npm account with publish access
2. Logged in: `npm login`
3. Version bumped in `package.json`
4. CHANGELOG.md updated

### Publish Steps

```bash
# 1. Build
npm run build

# 2. Test locally
npm pack
# Test the .tgz file in clean environment

# 3. Publish
npm publish

# 4. Verify
npm info agent-memory
```

### Version Strategy

- **0.x.x** - Pre-release, breaking changes allowed
- **1.0.0** - First stable release
- **1.x.x** - Stable, semantic versioning

**Current:** `0.5.0` (significant features, pre-production)

---

## Troubleshooting

### Build Fails

**Issue:** TypeScript compilation errors

**Fix:**
- Check `tsconfig.json`
- Run `npm run type-check`
- Fix errors in `src/`

### Templates Not Deployed

**Issue:** Changes in `src/templates/` not showing in `.agents/`

**Fix:**
- Run `npm run build` (triggers postbuild deployment)
- Check `scripts/deploy-agents.js` for errors

### Symlinks Broken

**Issue:** `.claude/rules` or `.claude/skills` not working

**Fix:**
- Delete symlinks: `rm .claude/rules .claude/skills`
- Rebuild: `npm run build`
- Verify: `ls -la .claude/`

### Postinstall Fails for Users

**Issue:** Users report `postinstall.js` errors

**Fix:**
- Test in clean environment
- Check paths in `scripts/postinstall.js`
- Ensure `dist/templates/` exists in package

---

## Development Best Practices

### Before Committing

```bash
# Type check
npm run type-check

# Lint
npm run lint

# Build
npm run build

# Test
npm test
```

### Adding New Templates

1. Add to `src/templates/`
2. Update `scripts/postbuild-copy-templates.js` if needed
3. Run `npm run build` to test deployment
4. Commit both `src/templates/` and update scripts

### Adding New Rules

1. Create markdown file in `src/templates/rules/shared/`
2. Follow existing format (Clean Architecture, Code Quality, etc.)
3. Run `npm run build`
4. Verify deployed to `.agents/rules/shared/`

### Adding New Skills

1. Create directory: `src/templates/agents/skills/new-skill/`
2. Add `SKILL.md`, `scripts/`, structure
3. Update CLI to register skill (if needed)
4. Run `npm run build`
5. Test skill execution

---

## Summary

**For Developers:**
- Edit `src/templates/` (source of truth)
- Run `npm run build` to deploy locally
- Test in `.agents/` and `.claude/`
- Never edit deployed files directly

**For npm Consumers:**
- Install: `npm install -g agent-memory`
- Run: `agent-memory setup` or `agent-memory init`
- Templates scaffold into their project
- Customize as needed (no symlinks)

**Key Principle:** `src/templates/` is the single source of truth for all scaffolded content.