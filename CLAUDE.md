# Lisa - Claude Code Memory System

Long-term memory for Claude Code. Automatic context persistence, task tracking, and knowledge capture across coding sessions.

## Quick Reference

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript and deploy to .claude/, .lisa/ |
| `npm test` | Run all unit tests |
| `npm run lint` | Run ESLint |

## Project Structure

```
lisa/
├── src/
│   ├── lib/                      # Core library code
│   │   ├── cli.ts                # Main CLI entry point
│   │   ├── services.ts           # Service factory
│   │   ├── domain/               # Domain types and contracts
│   │   ├── infrastructure/       # DAL, adapters
│   │   └── application/          # Use cases
│   └── project/                  # Templates (mirrors deployment)
│       ├── .lisa/
│       │   ├── skills/           # Memory, tasks, lisa, jira, git
│       │   │   ├── common/       # Shared group-id, type maps
│       │   │   └── shared/utils/ # DI-based utilities
│       │   ├── rules/            # Coding standards
│       │   └── docker/           # docker-compose.graphiti.yml
│       ├── .claude/
│       │   ├── hooks/            # session-start, session-stop, etc.
│       │   │   └── utils/        # Hook utilities (common, core, io, session)
│       │   └── config.ts
│       └── .opencode/
│           └── plugin/           # OpenCode plugin source
├── .claude/                      # Deployed hooks (compiled output)
│   ├── hooks/                    # Compiled JS hooks
│   ├── skills -> ../.lisa/skills
│   └── rules -> ../.lisa/rules
├── .lisa/                        # Deployed skills and rules (shared)
│   ├── skills/
│   ├── rules/
│   └── docker/
├── .opencode/                    # Deployed OpenCode plugin
│   ├── plugin/
│   └── skill -> ../.lisa/skills
├── tests/
│   └── unit/                     # Unit tests (mirror src/ structure)
└── dist/                         # Compiled library output
```

## Development Workflow: "Reverse Engineering"

When developing hooks or skills, follow this workflow:

### 1. Prototype in Compiled Output

Edit the compiled JS files directly in `.claude/hooks/` or `.lisa/skills/` to quickly iterate:

```bash
# Edit directly for fast iteration
code .claude/hooks/session-start.js

# Test manually
echo '{"trigger":"compact"}' | node .claude/hooks/session-start.js
```

### 2. Port Back to TypeScript Source

Once working, reverse engineer your changes into the TypeScript source:

```
.claude/hooks/session-start.js  ->  src/project/.claude/hooks/session-start.ts
.lisa/skills/memory/            ->  src/project/.lisa/skills/memory/
```

### 3. Build and Verify

```bash
# Compile and deploy
npm run build

# Verify compiled output has your changes
grep "yourFunction" .claude/hooks/session-start.js

# Run tests
npm test
```

### 4. Add Tests

Create tests in `tests/unit/` mirroring the source structure:

```
src/project/.claude/hooks/session-start.ts
tests/unit/src/project/claude/hooks/session-start.test.ts
```

### Why This Workflow?

- **Fast iteration**: JS edits take effect immediately without compilation
- **Type safety**: TypeScript source ensures correctness and maintainability
- **Deployability**: `npm run build` deploys to target directories
- **Testability**: TypeScript source can be properly unit tested

## Available Skills

Skills are invoked with `/skill-name` in Claude Code:

| Skill | Description | Trigger |
|-------|-------------|---------|
| `/memory` | Load or remember project memory | "load memory", "recall", "remember" |
| `/tasks` | Create, load, or summarize tasks | "tasks", "list tasks", "add task" |
| `/lisa` | Intelligent assistant for memory and tasks | "lisa", "hey lisa" |
| `/jira` | Create and manage Jira issues | "jira", "create ticket" |
| `/git` | GitHub and Git workflow helpers | "create pr", "pr checks" |
| `/init-review` | Initial codebase review and summary | First session in a repo |

Skills source: `src/project/.lisa/skills/`
Skills deployed to: `.lisa/skills/`

## Coding Rules

Rules are automatically loaded as context. See `.lisa/rules/`:

### Shared Rules (All Languages)
- `clean-architecture.md` - Layer structure, dependency rules, SOLID principles
- `code-quality-rules.md` - TypeScript/ESLint configuration, error prevention
- `git-rules.md` - Commit workflow, PR creation, memory milestones
- `testing-principles.md` - Testing pyramid, mocking strategies

### TypeScript Rules
- `coding-standards.md` - Naming conventions, type safety, async patterns
- `testing.md` - Jest patterns, fixtures, mocking
- `typescript-config-guide.md` - tsconfig settings, strict mode guidance

## Hooks

Hooks run at specific Claude Code lifecycle events:

| Hook | Trigger | Purpose |
|------|---------|---------|
| `session-start.js` | Session start/resume/compact/clear | Load memory context |
| `session-stop.js` | Claude stops responding | Capture work to memory |
| `user-prompt-submit.js` | User submits prompt | Validate and enhance prompts |

Hooks source: `src/project/.claude/hooks/`
Hooks deployed to: `.claude/hooks/`

### SessionStart Trigger Types

The session-start hook handles different triggers with appropriate messaging:

| Trigger | When | Message |
|---------|------|---------|
| `startup` | Initial session | "Memory loaded for session start" |
| `resume` | Resuming session | "Memory loaded for session resume" |
| `compact` | After auto-compact | "Memory reloaded after context compaction" + skills reminder |
| `clear` | After /clear | "Memory loaded after context clear" + fresh start reminder |

## Common Development Tasks

### Adding a New Hook Feature

```bash
# 1. Prototype in compiled output
code .claude/hooks/session-start.js

# 2. Test manually
echo '{"trigger":"compact"}' | node .claude/hooks/session-start.js

# 3. Port to TypeScript
code src/project/.claude/hooks/session-start.ts

# 4. Build and verify
npm run build

# 5. Add tests
code tests/unit/src/project/claude/hooks/session-start.test.ts

# 6. Run tests
npm test
```

### Adding a New Skill

```bash
# 1. Create skill directory
mkdir -p src/project/.lisa/skills/my-skill/scripts

# 2. Add skill manifest (skill.yaml) and scripts
code src/project/.lisa/skills/my-skill/skill.yaml
code src/project/.lisa/skills/my-skill/scripts/my-skill.ts

# 3. Build to deploy
npm run build

# 4. Test via Claude Code
# Type: /my-skill
```

### Running Tests

```bash
# All unit tests
npm test

# Specific test file
npx tsx --test tests/unit/src/project/claude/hooks/session-start.test.ts

# Integration tests (requires Docker)
npm run test:integration
```

## Build Process

`npm run build` does:

1. **Compile**: `tsc -p tsconfig.json` - Compiles TypeScript to `dist/`
2. **Prepare Package**: `prepare-dist-package.js` - Prepares for npm publish
3. **Bundle Hooks**: `bundle-hooks.js` - Bundles hooks with dependencies
4. **Deploy Locally**: `deploy-lisa.js` - Deploys to `.claude/`, `.lisa/`, `.opencode/`

## Memory System

Lisa uses Graphiti (knowledge graph) for persistent memory:

- **Facts**: Discrete pieces of information about the project
- **Nodes**: Entities in the knowledge graph
- **Tasks**: Tracked work items with status

Memory is stored per-repo and accessed via MCP (Model Context Protocol).

## Git Workflow

After committing, save a milestone memory:

```bash
node .lisa/skills/memory/scripts/memory.js add "FEATURE: Description of what was done" --cache --type milestone
```

This ensures work is captured for future sessions.

## Environment Setup

```bash
# Install dependencies
npm install

# Build and deploy
npm run build

# Start Graphiti (for memory persistence)
docker compose -f .lisa/docker-compose.graphiti.yml up -d
```

## Troubleshooting

### Hook not running after changes
Ensure you ran `npm run build` to deploy the compiled hooks.

### Memory not loading
Check that Graphiti is running: `docker ps | grep graphiti`

### TypeScript errors
Run `npm run lint` to see issues. The project uses relaxed settings during development.
