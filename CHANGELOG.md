# Changelog

All notable changes to Lisa will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.5.3] - 2026-01-23

### Added

#### Structured Log Enrichment ([#16](https://github.com/TonyCasey/lisa/issues/16))
- **IStructuredLog interface** - Standardized structured log entry format
  - Event-based logging with standardized event names
  - Context fields for correlation (sessionId, groupId, projectRoot, correlationId)
  - Duration tracking for performance monitoring
  - Error field for error context

- **LogEvents constants** - Standardized event names for log aggregation
  - Memory operations: `memory:load:start/complete/error/timeout`, `memory:save:*`, `memory:search:*`
  - Task operations: `task:load:*`, `task:sync:*`
  - Session operations: `session:start/stop`, `session:capture:*`
  - DAL operations: `dal:connect:*`, `dal:fallback`
  - Handler operations: `handler:start/complete/error`

- **IStructuredLogger interface** - Extended logger with structured event support
  - `logEvent()`, `logEventDebug()`, `logEventWarn()`, `logEventError()` methods
  - `withContext()` for binding context to child loggers
  - `startOperation()` for automatic duration tracking

- **Logger class updated** to implement IStructuredLogger
- **NullLogger class updated** to implement IStructuredLogger
- **MemoryService updated** with structured logging
  - All operations now emit standardized events
  - Duration tracking on load/save/search operations
  - Fallback events logged with source/target backends

- **Utility functions** for event derivation
  - `generateCorrelationId()` - Create unique correlation IDs
  - `deriveCompleteEvent()` - Convert start event to complete event
  - `deriveErrorEvent()` - Convert start event to error event

### Testing
- 16 new unit tests for structured logging
- Tests cover event constants, derivation helpers, and logger implementation
- Total unit tests: 301 (up from 298)

---

## [2.5.2] - 2026-01-23

### Added

#### DAL Routing Fallback Tests ([#15](https://github.com/TonyCasey/lisa/issues/15))
- **RepositoryRouter tests** (26 tests) - Comprehensive coverage for routing fallback behavior
  - Preferred backend selection for all operation types (list, search, write, aggregate)
  - Fallback behavior when preferred backend is unavailable
  - Any-available backend selection when both preferred and fallback unavailable
  - Error handling when no backends are registered
  - Task repository routing with fallback
  - Custom routing rules support
  - Runtime rule updates
  - Backend availability checks
  - Logging verification during fallback scenarios

- **RepositoryFactory tests** (12 tests) - Coverage for factory initialization and error handling
  - Selective backend configuration (enable/disable individual backends)
  - Error message quality verification
  - Connection manager cleanup with mock objects
  - Debug/warning logging during initialization
  - Fast tests that avoid real network calls

#### Timeout and Cancellation Tests ([#14](https://github.com/TonyCasey/lisa/issues/14))
- **MemoryService timeout tests** (14 tests) - Comprehensive timeout/cancellation coverage
  - Verify `timedOut` flag is set correctly on timeout
  - Verify `timedOut` is false when operation completes normally
  - Verify external abort signals cancel operations immediately
  - Verify mid-operation abort stops processing early
  - Verify no state mutations occur after timeout
  - Verify cleanup callbacks are invoked on timeout/abort
  - Verify default timeout of 5000ms
  - Verify concurrent calls cancel independently

- **SessionStartHandler timeout tests** (11 tests) - Handler-level timeout integration
  - Verify `timedOut` propagates from memory service to handler result
  - Verify timeout message is included in output
  - Verify partial facts are included despite timeout
  - Verify partial tasks are processed despite timeout
  - Verify timeout behavior across all triggers (startup, resume, compact)
  - Verify init-review is included if loaded before timeout
  - Verify result structure consistency on timeout

### Changed
- Total unit tests: 298 (up from 222)
- New test files:
  - `tests/unit/src/lib/infrastructure/dal/routing/RepositoryRouter.fallback.test.ts`
  - `tests/unit/src/lib/infrastructure/dal/RepositoryFactory.fallback.test.ts`
  - `tests/unit/src/lib/infrastructure/services/MemoryService.timeout.test.ts`
  - `tests/unit/src/lib/application/handlers/SessionStartHandler.timeout.test.ts`

---

## [2.5.1] - 2026-01-23

### Added

#### Handler Unit Tests ([#13](https://github.com/TonyCasey/lisa/issues/13))
- **SessionStartHandler tests** (16 tests) - Comprehensive coverage for session start handling
  - Trigger type handling (startup, resume, compact, clear)
  - Memory loading with various result sizes
  - Timeout behavior
  - Task processing and deduplication
  - Output formatting

- **SessionStopHandler tests** (13 tests) - Coverage for session stop handling
  - Transcript path passing to capture service
  - Fact capture and memory save
  - Event emission
  - GitHub sync suggestions for unlinked/linked tasks
  - Error handling for capture and memory failures

- **PromptSubmitHandler tests** (20 tests) - Coverage for prompt submission handling
  - Constructor variants (ILisaServices vs individual injection)
  - Basic prompt handling and blocking
  - Memory storage with truncation
  - Plan mode recursion with context
  - Hierarchical group ID passing
  - Error handling for recursion and memory failures

### Changed
- Handler tests now use consistent mock factory patterns across all handlers
- Total handler tests: 49 (up from 9)

---

## [2.5.0] - 2026-01-23

### Added

#### Timeout Cancellation with AbortController ([#10](https://github.com/TonyCasey/lisa/issues/10))
- **AbortController-based cancellation** - Memory loading and session start operations now use proper cancellation instead of `Promise.race`
  - New `withCancellation()` utility for cancellable async workflows
  - `checkCancellation()` helper to check abort signal at checkpoints
  - `CancellationError` class for typed cancellation handling
  - `createDeferred()` helper for external promise control

- **No mutations after timeout** - Cancellation checks before every state mutation ensure clean timeout behavior
  - Memory results are not modified after timeout occurs
  - Resources are properly cleaned up on cancellation
  - External abort signals can be combined with internal timeouts

- **Affected files**:
  - `src/lib/domain/utils/cancellation.ts` - New cancellation utilities (moved to domain layer)
  - `src/lib/infrastructure/services/MemoryService.ts` - Updated `loadMemory()` with cancellation
  - `src/lib/application/handlers/SessionStartHandler.ts` - Updated `loadMemoryWithDAL()` with cancellation

### Fixed

#### MCP Session ID Handling ([#11](https://github.com/TonyCasey/lisa/issues/11))
- **Implicit session management** - MCP client now manages sessions internally
  - Callers no longer need to track or pass session IDs
  - Session ID parameter in `call()` is deprecated and ignored
  - Client automatically initializes session on first call
  - Session ID from response headers updates internal state

- **Session expiry handling** - Automatic re-initialization on 401/403 errors
  - On session expiry, client re-initializes and retries once
  - Prevents failures due to stale session IDs

- **Concurrent initialization protection** - Multiple concurrent calls share single init
  - Uses promise caching to prevent duplicate initialization requests
  - All concurrent calls wait for the same initialization to complete

- **Affected files**:
  - `src/lib/domain/interfaces/IMcpClient.ts` - Updated interface docs
  - `src/lib/infrastructure/mcp/McpClient.ts` - Internal session management
  - `src/lib/infrastructure/services/MemoryService.ts` - Removed manual session tracking
  - `src/lib/skills/shared/clients/McpClient.ts` - Session expiry handling

#### Deterministic Transcript Resolution ([#12](https://github.com/TonyCasey/lisa/issues/12))
- **Explicit path preference** - When `transcript_path` is provided, it is always used directly
  - No fallback to search when explicit path is provided but not found
  - Clear error logging when explicit path doesn't exist

- **Newest transcript selection** - When searching, selects newest transcript by modification time
  - Collects all matching transcript candidates
  - Sorts by mtime descending and returns newest
  - Makes resolution deterministic and predictable

- **Warning for multiple candidates** - Logs warning when multiple transcript files found
  - Lists all candidates with paths and timestamps
  - Helps debugging transcript resolution issues

- **Documented resolution algorithm** - Clear code comments explaining:
  1. Explicit path is always preferred
  2. Standard locations are searched
  3. All candidates collected
  4. Newest selected by mtime
  5. Warning logged for multiple matches

- **Affected files**:
  - `src/lib/infrastructure/services/SessionCaptureService.ts` - Deterministic resolution

### Testing
- 21 new unit tests for cancellation utilities
- 8 new unit tests for MCP session handling
- 17 new unit tests for transcript resolution

---

## [2.4.2] - 2026-01-23

### Added

#### GitHub Issues Sync
- **Automatic GitHub sync on session start** - GitHub Issues are now automatically synced to Lisa's task memory when a new session starts
  - Detects GitHub repo from git remote (`git@github.com:` or `https://github.com/`)
  - Imports new issues as tasks with `externalLink` metadata
  - Updates task status from closed/reopened issues
  - Runs only on `startup` trigger (not resume/compact)
  - Non-blocking: session continues even if sync fails

- **`IGitHubSyncService` in DI container** - New service for programmatic GitHub sync
  - Registered in `bootstrapContainer()` when `gh` CLI is available
  - Injected into `SessionStartHandler` for automatic sync
  - Can be disabled via `enableGitHubSync: false` config option

### Fixed

- **Neo4jTaskRepository schema mismatch** - Fixed repository to query correct node type
  - Was querying `Entity` nodes with `Task:` prefix
  - Now queries `Episodic` nodes with `TASK:` prefix (matching how skills store tasks)
  - Parses JSON `content` field to extract task status and metadata
  - Tasks now properly appear in session-start context output

---

## [2.4.1] - 2026-01-23

### Fixed
- **Claude Code skills symlink structure** - Fixed incorrect symlink that caused "Unknown skill" errors ([#20](https://github.com/TonyCasey/lisa/issues/20))
  - Before: `.claude/skills/lisa -> ../../.lisa/skills` (SKILL.md at wrong path)
  - After: `.claude/skills/<skill> -> ../../.lisa/skills/<skill>` (individual symlinks per skill)
  - Now matches the working OpenCode pattern

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
