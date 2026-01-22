# Contributing to Lisa

Thank you for your interest in contributing to Lisa! This guide covers everything you need to set up a development environment and contribute effectively.

## Prerequisites

- **Node.js** 18+
- **npm** or **pnpm**
- **Docker** (for testing the full stack locally)
- **Git**

## Development Setup

```bash
# Clone the repository
git clone https://github.com/tonycasey/lisa.git
cd lisa

# Install dependencies
npm install

# Build the project
npm run build

# Verify installation
lisa doctor
```

After building, you should see `.lisa/`, `.claude/`, and `.opencode/` folders populated with deployed files.

## Project Structure

```
lisa/
├── src/
│   ├── lib/                  # Core library code
│   │   ├── cli.ts            # Main CLI entry point
│   │   ├── services.ts       # Service factory with DI
│   │   ├── application/
│   │   │   └── handlers/
│   │   │       └── hooks/    # Hook handlers (SessionStart, SessionStop, etc.)
│   │   ├── skills/           # Skill implementations (memory, tasks, etc.)
│   │   └── scanner/          # Multi-project scanner
│   └── project/              # Source for deployed assets
│       ├── .lisa/            # Skills (SKILL.md files), rules, docker config
│       └── .opencode/        # OpenCode plugin source
│
├── dist/                     # Compiled output (generated)
│   ├── lib/                  # Compiled library (CLI, handlers, skills)
│   ├── opencode/             # Bundled OpenCode plugin
│   └── project/              # Compiled SKILL.md files and rules
│
├── .lisa/                    # Deployed skills & rules (generated)
├── .claude/                  # Claude Code config (generated)
│   ├── settings.json         # Hook commands registered here
│   ├── skills/lisa/          # Symlink to .lisa/skills
│   └── rules/lisa/           # Symlink to .lisa/rules
├── .opencode/                # Deployed OpenCode plugin (generated)
│
├── scripts/                  # Build scripts
│   ├── bundle-opencode.js    # Bundle OpenCode plugin
│   ├── deploy-lisa.js        # Deploy to .lisa/, .claude/, .opencode/
│   └── prepare-dist-package.js
│
├── tests/                    # Test files
└── docs/                     # Documentation
```

### Key Principle

**Always edit files in `src/project/`** - never edit `.lisa/`, `.claude/`, or `.opencode/` directly. These are regenerated on every build.

## Build Pipeline

When you run `npm run build`, these stages execute:

1. **TypeScript Compilation** (`tsc`)
   - Compiles `src/**/*.ts` to `dist/**/*.js`

2. **Template Copy** (`postbuild-copy-templates.js`)
   - Copies non-TypeScript files (SKILL.md, rules, docker config) to dist

3. **Package Preparation** (`prepare-dist-package.js`)
   - Creates optimized `dist/package.json` for npm publishing

4. **OpenCode Bundling** (`bundle-opencode.js`)
   - Bundles OpenCode plugin with dependencies via esbuild

5. **Local Deployment** (`deploy-lisa.js`)
   - Deploys `dist/project/` to `.lisa/`, `.claude/`, `.opencode/`
   - Creates subdirectory symlinks (e.g., `.claude/skills/lisa/` -> `../../.lisa/skills`)
   - Merges hook configuration into `.claude/settings.json`

**Note:** Claude Code hooks are now invoked via `lisa hook <event>` CLI commands, not bundled JS files. Hook logic lives in `src/lib/application/handlers/hooks/`.

## Common Tasks

### Running Tests

```bash
npm test                    # Run all tests
npm run test:watch          # Watch mode
```

### Linting

```bash
npm run lint               # Check for issues
npm run lint:fix           # Auto-fix issues
```

### Type Checking

```bash
npm run type-check         # TypeScript type check only
```

### Full Validation

```bash
npm run build && npm test && npm run lint
```

## Adding New Features

### Adding a Skill

1. Create directory: `src/project/.lisa/skills/<skill-name>/`
2. Add `SKILL.md` with trigger definitions and instructions
3. Add `scripts/<skill-name>.ts` with implementation
4. Run `npm run build` to compile and deploy
5. Test the skill with Claude Code or OpenCode

Example skill structure:
```
src/project/.lisa/skills/my-skill/
├── SKILL.md           # Skill definition
└── scripts/
    └── my-skill.ts    # Implementation
```

### Adding a Hook

Claude Code hooks are now implemented as CLI command handlers:

```
src/lib/application/handlers/hooks/<HookName>Handler.ts
```

1. Create a handler class implementing the hook logic
2. Add the command to `src/lib/cli.ts` under the `hook` command group
3. Register the hook in `.claude/settings.json` via `deploy-lisa.js`

Example handler structure:
```typescript
export class MyHookHandler {
  async execute(
    stdin: Readable,
    stdout: Writable,
    stderr: Writable
  ): Promise<void> {
    const input = await readJsonStdin(stdin);
    // Process input...
    await writeJsonStdout(output, stdout);
  }
}
```

Shared utilities go in `src/lib/application/handlers/hooks/utils.ts`.

### Adding Rules

**Language-agnostic:**
```
src/project/.lisa/rules/shared/<rule-name>.md
```

**Language-specific:**
```
src/project/.lisa/rules/typescript/<rule-name>.md
```

## Testing Changes Locally

### Test as Global Install

```bash
# Create tarball
npm pack

# Install globally from tarball
npm install -g ./lisa-0.5.x.tgz

# Test in a fresh directory
mkdir test-project && cd test-project
lisa init
lisa doctor
```

### Test Specific Commands

```bash
# Run CLI directly from source
npx tsx src/cli.ts doctor
npx tsx src/cli.ts init --help
```

## Pull Request Guidelines

### Before Submitting

- [ ] Run `npm run build` successfully
- [ ] Run `npm test` with all tests passing
- [ ] Run `npm run lint` with no errors
- [ ] Test changes manually

### PR Format

**Title:** Use conventional commit format
- `feat: add new skill for X`
- `fix: resolve issue with Y`
- `docs: update README`
- `refactor: simplify Z`

**Description:**
- What changes were made
- Why they were made
- How to test them

### Code Style

- Follow existing patterns in the codebase
- Use TypeScript strict mode
- No `any` types in production code
- Add tests for new functionality

## Troubleshooting

### Build Fails

```bash
# Clean and rebuild
rm -rf dist .lisa .claude .opencode
npm run build
```

### Deployed Files Not Updating

The deploy script only runs during build. Run `npm run build` after changing source files.

### TypeScript Errors

```bash
npm run type-check
```

Fix errors in `src/` before committing.

## Publishing (Maintainers)

See [PUBLISHING.md](./PUBLISHING.md) for npm publishing instructions.

## Questions?

- Open an issue for bugs or feature requests
- Check existing issues before creating new ones
- Join discussions in open PRs
