# Changelog

All notable changes to Lisa will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.3.0] - 2026-01-22

### Added

#### Zero-Impact Installation
- **Subdirectory symlinks** - Lisa now installs into subdirectories instead of replacing entire folders
  - `.claude/skills/lisa/` symlinks to `../../.lisa/skills` (preserves user's `.claude/skills/`)
  - `.claude/rules/lisa/` symlinks to `../../.lisa/rules` (preserves user's `.claude/rules/`)
  - OpenCode uses individual skill symlinks (`.opencode/skills/memory/`, etc.)

#### CLI Hook Commands
- **`lisa hook` command group** - Hooks now invoked via CLI commands instead of bundled JS files
  - `lisa hook session-start` - Load memory context at session start
  - `lisa hook session-stop` - Capture work when session stops
  - `lisa hook user-prompt-submit` - Process user prompts
  - Registered in `.claude/settings.json` as command hooks

#### Hook Handlers
- **Application-layer handlers** - New handler classes in `src/lib/application/handlers/hooks/`
  - `SessionStartHookHandler` - Loads memory, tasks, and project context
  - `SessionStopHookHandler` - Spawns background worker to capture work
  - `UserPromptSubmitHookHandler` - Validates and logs prompts
  - Shared utilities in `hooks/utils.ts` and `hooks/types.ts`

#### Testing
- **78 unit tests** - Comprehensive test coverage for new hook handlers
  - Tests for `parseTrigger()`, stdin/stdout utilities, config loading
  - Tests for all three hook handlers with various input scenarios
  - Fixed glob pattern in `npm run test:unit` to find all test files

### Changed

#### Architecture
- **Hooks via CLI** - Hooks no longer bundled as JS files in `.claude/hooks/`
  - Hook logic moved from `src/project/.claude/hooks/` to `src/lib/application/handlers/hooks/`
  - Removes need for `bundle-hooks.js` script
  - Version consistency - hook logic matches installed `lisa` version

- **Settings.json configuration** - Hook registration in `.claude/settings.json`
  - Replaces direct file deployment to `.claude/hooks/`
  - Merges Lisa hooks with any existing user hooks
  - Preserves user's `settings.json` configuration

#### Files Removed
- `src/project/.claude/hooks/session-start.ts` - Logic moved to `SessionStartHookHandler`
- `src/project/.claude/hooks/session-stop.ts` - Logic moved to `SessionStopHookHandler`
- `src/project/.claude/hooks/session-stop-worker.ts` - Logic moved to handler
- `src/project/.claude/hooks/user-prompt-submit.ts` - Logic moved to `UserPromptSubmitHookHandler`
- `src/project/.claude/config.ts` - No longer needed (env vars read directly)
- `scripts/bundle-hooks.js` - No longer needed

### Fixed
- **Memory integration tests** - Updated to use `lisa` CLI instead of standalone scripts
- **Test discovery** - Fixed glob pattern to find tests in nested directories

### Documentation
- Updated `docs/getting-started.md` with new directory structure
- Updated `docs/commands.md` with `lisa hook` commands
- Updated `docs/configuration.md` to replace `config.js` with `settings.json`
- Updated `.dev/features/symlink-plan.md` with implementation status

---

## [2.2.0] - 2026-01-21

### Changed

#### Build & Deployment
- **Renamed deploy script** - `deploy-agents.js` renamed to `deploy-lisa.js` for clarity
- **Hooks use CLI** - Hooks now invoke `lisa` CLI subcommands instead of deprecated script paths
- **Bundle optimization** - Excluded `neo4j-driver` from bundled hooks/plugins to reduce size

#### CLI Improvements
- **Verbose flag** - Added `--verbose` flag support for detailed output
- **Test coverage** - Enhanced CLI tests for new verbose flag behavior

### Fixed
- Lisa response prefix formatting in SKILL.md (spacing consistency)
- Docker healthcheck in e2e tests (uses Python instead of curl for reliability)
- Import paths in test-dal-manual.ts
- Bump-version test moved to correct path with type error fixes
- Removed duplicate OpenCode plugin source files
- Removed empty hooks/utils folder from deployment

### Documentation
- Updated README to clarify global installation and usage steps
- Disabled markdownlint in code-quality-rules.md to prevent IDE noise
- Added tsconfig.json for tests to fix IDE warnings

---

## [2.1.0] - 2026-01-19

### Added

#### CLI Subcommands
- **Skill subcommands** - Direct CLI access to skill functionality
  - `lisa memory load|add` - Memory operations via CLI
  - `lisa tasks list|add|update` - Task management via CLI
  - `lisa storage status|switch` - Storage mode management
  - `lisa jira` - Jira operations passthrough
  - `lisa prompt` - Prompt operations passthrough
  - `lisa bump-version` - Version bump utility
  - `lisa init-review` - Initial codebase review
  - `lisa compile-skills` - Skill extension compilation

#### Package Exports
- **Skill module exports** - Skills available as npm package exports
  - `@tonycasey/lisa/skills/memory`
  - `@tonycasey/lisa/skills/tasks`
  - `@tonycasey/lisa/skills/jira`
  - And more for programmatic usage

#### Configuration
  - JSON config takes precedence over `.env` file
  - Cleaner configuration format for projects

### Changed

#### Architecture Refactoring
- **Skills as library code** - Skills moved from `src/project/.lisa/skills/` to `src/lib/skills/`
  - Skill scripts are now part of the compiled library
  - Only SKILL.md files deployed to project directories
  - Better bundling and tree-shaking support

- **Init command** - Skills deployment simplified
  - Uses `fs.copy` for skill SKILL.md files
  - Scripts accessed via `lisa` subcommands instead of direct paths
  - Filters out shared/common/scripts from deployment

#### Doctor Command
- **Skip mode support** - Handles unconfigured storage gracefully
  - Shows helpful message when storage not configured
  - Guides user to run `lisa init` to configure

### Fixed
- ESLint errors in jira.ts (switch case block scoping)
- TypeScript type safety in Neo4jClient.ts (removed `any` types)
- Unused variable warnings across codebase
- Test assertions updated for new skill deployment model

---

## [2.0.0] - 2026-01-19

### Added

#### Multi-CLI Architecture
- **OpenCode support** - Lisa now supports OpenCode alongside Claude Code
  - Unified event-driven architecture with shared resources
  - OpenCode plugin adapter with lifecycle event mapping
  - CLI-specific directories: `.claude/` (hooks), `.opencode/` (plugin)
  - Symlinks from CLI dirs to shared `.lisa/` resources

- **CLI selection during init** - Choose which CLIs to support
  - Interactive mode prompts for selection
  - `--claude-only` and `--opencode-only` flags for non-interactive setup

#### Data Access Layer (DAL)
- **Multi-backend support** - MCP, Neo4j direct, and Zep Cloud backends
  - Repository router for optimal backend selection per operation type
  - Connection managers with health checks
  - Search operations route to MCP (semantic search)
  - List/aggregate operations route to Neo4j (efficient ordering)

#### Clean Architecture Refactoring
- **Domain layer** - Core interfaces and types
  - `IMemoryRepository`, `ITaskRepository` contracts
  - `IMemoryItem`, `ITask` domain types
  - Event interfaces for session lifecycle

- **Infrastructure layer** - Implementation details
  - MCP, Neo4j, and Zep repository implementations
  - `RepositoryFactory` and `RepositoryRouter` for backend selection
  - `ServiceFactory` for dependency injection

- **Application layer** - Use case handlers
  - `SessionStartHandler`, `SessionStopHandler`, `PromptSubmitHandler`

#### Hooks Refactoring
- **Modular hook architecture** - Extract monolithic hooks into focused modules
  - `utils/common/` - mcp-client, context, group-id, transcript-parser
  - `utils/core/` - task-loader, memory-loader, rules-loader
  - `utils/io/` - output-formatter, stdin-reader, graphiti-writer
  - `utils/session/` - trigger-handler, plan-mode
  - `utils/capture/` - retrospective-builder, summary-builder, transcript-finder
  - 56% reduction in hook code size

#### Skills Enhancement
- **Service-based architecture** - Extract skills to DI-based services
  - Shared clients: `McpClient`, `Neo4jClient`, `ZepClient`
  - Service interfaces: `IMemoryService`, `ITaskService`
  - DI-based utilities for testability

- **Configurable logging** - pino-based logging with `LOG_LEVEL` support
  - `.env` file creation on first `lisa init`
  - Log levels: debug, info, warn, error

#### Testing Improvements
- **143 unit tests** for extracted hook modules
- **Docker-based e2e tests** for multiple OS and project types
- **Integration tests** for DAL and CLI operations

### Changed

#### Project Structure
- **Source reorganization** - Move from `src/templates/` to `src/project/`
- **Deployed directory rename** - From `.agents/` to `.lisa/`
- **Shared resources** - Skills and rules in `.lisa/` shared by all CLIs

#### Build Process
- **Bundle hooks** - New `bundle-hooks.js` script for hook bundling
- **Deploy lisa** - Enhanced `deploy-lisa.js` with multi-CLI support
- **Symlink creation** - Automatic symlinks from CLI dirs to shared resources

### Fixed
- **CI workflow** - Run build before tests in workflow
- **Cross-platform support** - Improved robustness for Windows paths
- **Code review fixes** - Various improvements for robustness

### Documentation
- Updated README with multi-CLI architecture
- Updated AGENTS.md with comprehensive development guide
- Updated all docs for new directory structure

---

## [1.2.0] - 2026-01-15

### Added

#### New Skills
- **lisa** skill - Intelligent assistant for memory and tasks
  - Retrospective capability to analyze session changes and save learnings
  - `lisa, compile skills` command to merge SKILL.local.md extensions

- **jira** skill - Create and manage Jira issues via REST API
  - Create tickets with type, priority, and labels
  - List and view issues
  - Change issue types and status

- **git** skill - GitHub and Git workflow helpers
  - Version bump script (`bump-version.ts`)
  - PR creation workflow
  - CI status polling (`poll-ci.sh`)

#### Skill Extensions
- **SKILL.local.md support** - Customize skills per project
  - Create `SKILL.local.md` alongside any `SKILL.md` to extend it
  - Local extensions preserved during deployments
  - `lisa, compile skills` merges extensions into deployed skills

#### Memory Enhancements
- **Summarization for /memory** - Human-readable output instead of raw JSON
  - Automatic categorization (Project, Activity, Conventions, Config, Milestones)
  - Filters expired facts and prioritizes recent ones

#### Hook Improvements
- **session-start.ts** - Handle all trigger types (startup, resume, compact, clear)
  - Context-appropriate messaging for each trigger type
  - Skills reminder after context compaction

#### Scanner Module
- **lisa scan** command for cross-repo knowledge scanning
  - `analyzer.ts` - Code pattern analysis
  - `discovery.ts` - Repository discovery
  - `facts.ts` - Fact extraction
  - `reviewer.ts` - Code review generation

### Changed
- Memory skill now requires summarization of results (never show raw JSON)
- Session-start hook provides differentiated messages per trigger type

### Documentation
- Added `CLAUDE.md` with development workflow and project context
- Added `EXTENDING-SKILLS.md` guide for skill customization
- Updated skill documentation with usage examples

---

## [1.1.2] - 2026-01-10

Previous release. See git history for details.
