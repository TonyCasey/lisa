# Changelog

All notable changes to Lisa will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.9.0] - 2026-01-27

### Added

#### Cross-Platform Desktop Notifications ([#37](https://github.com/TonyCasey/lisa/issues/37))

New `--notify` flag for `lisa pr poll` to send desktop notifications when PR state changes are detected.

```bash
lisa pr poll --notify             # Send desktop notifications for state changes
lisa pr poll --notify --json      # Also output JSON
```

**Supported Platforms:**
- **Windows**: PowerShell toast notifications (BurntToast if available, fallback to native)
- **macOS**: osascript notifications
- **Linux**: notify-send (libnotify)
- **Fallback**: Terminal bell + log file when desktop unavailable

**Features:**
- Notification types with emojis: checks updated, new comment, new reply, PR approved/merged/closed
- Priority-based urgency (high priority for failures, replies, approvals)
- Debouncing (5 second default) to prevent notification spam
- All notifications logged to `~/.lisa/notifications.log`

**Notification Format:**
```
PR #42: All checks passed
repo-name: checks pending -> success

PR #42: New reply
new reply from @reviewer on file.ts:10
```

### New Files

- `src/lib/domain/interfaces/INotificationService.ts` - Notification service interface
- `src/lib/infrastructure/notifications/NotificationService.ts` - Cross-platform implementation
- `tests/unit/src/lib/infrastructure/notifications/NotificationService.test.ts` - Tests

---

## [2.8.0] - 2026-01-27

### Added

#### Cron-Based PR Polling Command ([#35](https://github.com/TonyCasey/lisa/issues/35))

New `lisa pr poll` command for automated monitoring of watched PRs. Designed to be invoked by cron every 5 minutes.

```bash
lisa pr poll                      # Poll all watched PRs
lisa pr poll --no-auto-unwatch    # Don't auto-unwatch merged/closed PRs
lisa pr poll --no-log             # Don't write to log file
lisa pr poll -c 3                 # Limit to 3 concurrent API calls
lisa pr poll --json               # Output as JSON
```

**Features:**
- User-scoped polling: polls ALL watched PRs across all repos in a single invocation
- Detects state changes:
  - Check status changes (pending → success/failure)
  - New review comments
  - Replies to your comment responses
  - PR merged or closed
- Auto-unwatches merged/closed PRs (configurable)
- Writes timestamped logs to `~/.lisa/pr-poll.log`
- Handles GitHub API rate limits gracefully
- Controlled concurrency to avoid rate limiting (default: 5 parallel requests)
- Updates Neo4j with new state and `lastPolled` timestamp
- Exit code 1 on errors (suitable for cron monitoring)

**Output format (terminal):**
```
Polled 3 PR(s), 2 change(s) detected

  📢 owner/repo#50: checks pending → success ✅
  📢 owner/repo#50: new comment from @reviewer on src/file.ts:42
  ✓ owner/repo#51: no changes
  📢 acme/project#42: PR merged
     (unwatched)

Log: ~/.lisa/pr-poll.log
```

**Log format:**
```
[2026-01-27T10:05:00Z] Polling 3 watched PR(s)...
[2026-01-27T10:05:01Z] owner/repo#50: checks pending → success ✅
[2026-01-27T10:05:01Z] owner/repo#50: new comment from @reviewer on src/file.ts:42
[2026-01-27T10:05:02Z] owner/repo#51: no changes
[2026-01-27T10:05:02Z] acme/project#42: PR merged, unwatching
[2026-01-27T10:05:02Z] Poll complete. 2 notification(s).
```

### New Files

- `src/lib/application/handlers/pr/PrPollHandler.ts` - Poll handler
- `tests/unit/src/lib/application/handlers/pr/PrPollHandler.test.ts` - Tests

---

## [2.7.0] - 2026-01-27

### Added

#### Local AI Code Review Command ([#41](https://github.com/TonyCasey/lisa/issues/41))

New `lisa pr review` command for running local AI code review before creating a PR.

```bash
lisa pr review                    # Review current branch vs main
lisa pr review --base dev         # Review against different base
lisa pr review --block            # Exit non-zero if critical issues found
lisa pr review --json             # Output as JSON
```

**Features:**
- Analyzes git diff between current branch and base (main/master by default)
- Categorizes issues by severity: Critical, Warning, Suggestion
- Uses Claude CLI for AI review when available
- Falls back to heuristic-based review (pattern matching) when AI not available
- Supports `--block` flag for CI integration (exits non-zero on critical issues)
- Detects common issues: console.log, TODO comments, hardcoded secrets, `any` types

**Output format:**
```
Reviewing changes: main...HEAD (5 files changed)

## Review Summary

### 🔴 Critical (must fix) - 1
- src/utils.ts:42 - Potential null pointer dereference

### 🟡 Warnings (should fix) - 1
- src/handler.ts:15 - Missing error handling

### ✅ Passed
- No security vulnerabilities detected

────────────────────────────────────────────────────────────
Result: 1 critical, 1 warning, 0 suggestion
```

### New Files

- `src/lib/application/handlers/pr/PrReviewHandler.ts` - Review handler
- `tests/unit/src/lib/application/handlers/pr/PrReviewHandler.test.ts` - Tests

---

## [2.6.2] - 2026-01-27

### Fixed

#### Task Writes Now Go Directly to Neo4j ([#48](https://github.com/TonyCasey/lisa/issues/48))

Task operations now write directly to Neo4j instead of going through MCP's async queue, ensuring tasks appear immediately in `lisa tasks list`.

**Problem**: Tasks added via `lisa tasks add` were queued through MCP/Graphiti but never appeared in Neo4j due to silent processing failures.

**Solution**: Changed `TaskService` to write directly to Neo4j:
- `add()` - Creates Episodic node directly in Neo4j (was already fixed)
- `update()` - Now creates Episodic node directly instead of using MCP
- `link()` - Now creates Episodic node directly instead of using MCP  
- `unlink()` - Now creates Episodic node directly instead of using MCP

**Impact**: 
- Tasks appear immediately after creation
- Task updates are reflected instantly
- External link changes persist immediately
- Consistent read/write path (both use Neo4j)

### Changed

- `ITaskLinkResult.mode` now includes `'neo4j'` as a valid value

---

## [2.6.1] - 2026-01-27

### Added

#### Date-Aware Memory and Task Querying ([#53](https://github.com/TonyCasey/lisa/issues/53))

When loading memories or asking "what were we working on?", Lisa now defaults to querying from today backwards, ensuring you see the most relevant recent activity instead of stale data.

- **CLI date filtering** - New `--since` and `--until` options for `lisa memory load` and `lisa tasks list`
  - Supports relative dates: `today`, `yesterday`, `7d`, `1w`, `1m`, `24h`
  - Supports ISO dates: `2026-01-27`, `2026-01-27T10:00:00Z`
  - Example: `lisa memory load --since today` or `lisa tasks list --since 7d`

- **Date parser utility** - New `src/lib/utils/dateParser.ts` module
  - `parseDate(str)` - Parse relative or ISO date strings
  - `getStartOfDay(date)` - Get midnight for a date
  - `getStartOfToday()` - Get midnight today
  - `hoursAgo(n)` - Get date N hours ago
  - `formatDateForDisplay(date)` - Format for CLI output
  - `formatDateRange(since, until)` - Format date range

- **Session start date-aware loading** - `SessionStartHandler` now uses date-based queries
  - On `startup`: queries from start of today for focused context
  - On `resume`/`compact`/`clear`: queries last 24 hours
  - Shows "Context range: today" or "Context range: last 24h" in output

- **Git commit context** - Session start now includes recent git commits
  - Shows up to 10 commits since the query date
  - Provides immediate visibility into recent code changes
  - Example output: "Recent commits (5): abc1234 feat: add X..."

### Changed

- **IMemoryService interface** - `loadFactsDateOrdered()` now accepts optional `IMemoryDateOptions`
- **Skill services** - `MemoryService` and `TaskService` now support date filtering in Neo4j queries
- **MemoryCliService/TaskCliService** - Parse and pass date filters from CLI args

### Testing

- 22 new unit tests for dateParser utility
- All 497 unit tests passing

### New Files

- `src/lib/utils/dateParser.ts` - Date parsing and formatting utilities
- `src/lib/utils/index.ts` - Utils module exports
- `tests/unit/src/lib/utils/dateParser.test.ts` - Date parser tests

---

## [2.6.0] - 2026-01-26

### Added

#### PR Entity Types and Neo4j Repository ([#32](https://github.com/TonyCasey/lisa/issues/32))
- **Domain types for PR tracking** - New interfaces in `src/lib/domain/interfaces/types/IPullRequest.ts`
  - `IPullRequest` - PR entity with watching, checksStatus, unresolvedComments tracking
  - `IGitHubIssue` - Issue linked to PRs with optional PR reference
  - `IPrCheck` - CI check status (pending, success, failure, cancelled)
  - `IPrComment` - Review comment with resolved/unresolved status tracking
  - Factory functions: `createPullRequest()`, `createGitHubIssue()` with sensible defaults

- **Repository interface for PR operations** - New interfaces in `src/lib/domain/interfaces/dal/IPullRequestRepository.ts`
  - `IPullRequestRepositoryReader` - findPr, findWatchedPrs, findIssuesByPr, findChecksByPr, findCommentsByPr, getPrWithRelations
  - `IPullRequestRepositoryWriter` - upsertPr, upsertIssue, upsertCheck, upsertComment, linkPrToIssues, setWatching, updateLastPolled, deletePr
  - `IPullRequestRepositoryCapabilities` - supportsWrite() returns true (direct write, not MCP queue)

- **Neo4j repository implementation** - `src/lib/infrastructure/dal/repositories/neo4j/Neo4jPullRequestRepository.ts`
  - Direct read/write to Neo4j (bypasses MCP async queue for immediate persistence)
  - User-scoped storage: `group_id: "user:<git-config-name>"` format
  - UUID pattern: `pr-{owner}-{repo}-{number}`
  - Name pattern: `PR:{owner}/{repo}#{number}`
  - Relationship model: `PR -[:CLOSES]-> Issue`, `PR -[:HAS_CHECK]-> Check`, `PR -[:HAS_COMMENT]-> Comment`

#### GitHub CLI Wrapper ([#33](https://github.com/TonyCasey/lisa/issues/33))
- **GithubClient class** - Wraps `gh` CLI for GitHub API operations
  - `getPr(repo, prNumber)` - Fetch PR details with closing issues
  - `getPrChecks(repo, prNumber)` - Fetch CI check statuses
  - `getPrReviews(repo, prNumber)` - Fetch PR reviews
  - `getPrComments(repo, prNumber)` - Fetch inline review comments
  - `getPrDiff(repo, prNumber)` - Fetch PR diff
  - `getIssue(repo, issueNumber)` - Fetch issue details
  - `replyToComment(repo, commentId, body)` - Reply to review comment
  - `addReaction(repo, commentId, reaction)` - Add emoji reaction
  - `getCurrentUser()` - Get authenticated user (cached)
  - `getUserId()` - Get user ID in Lisa format (`user:<username>`)
  - `getCurrentRepo()` - Detect repo from git remote
  - `createPr(options)` - Create new PR
  - `isAvailable()` - Check if gh CLI is installed/authenticated

- **Error handling** - `GithubClientError` with typed error codes
  - `NOT_INSTALLED` - gh CLI not installed
  - `NOT_AUTHENTICATED` - gh CLI not logged in
  - `RATE_LIMITED` - GitHub API rate limit exceeded
  - `NOT_FOUND` - Resource not found
  - `API_ERROR` - Generic API error

- **Retry logic** - Configurable retries for transient failures
  - Default: 3 retries with exponential backoff
  - Automatic retry on rate limits

### Testing
- 8 new unit tests for IPullRequest types and factory functions
- 26 new unit tests for Neo4jPullRequestRepository
- 20 new unit tests for GithubClient
- Total unit tests: 424 (up from 404)

### New Files
- `src/lib/domain/interfaces/types/IPullRequest.ts` - PR domain types
- `src/lib/domain/interfaces/dal/IPullRequestRepository.ts` - Repository interfaces
- `src/lib/infrastructure/dal/repositories/neo4j/Neo4jPullRequestRepository.ts` - Neo4j implementation
- `tests/unit/src/lib/domain/interfaces/types/IPullRequest.test.ts` - Type tests
- `tests/unit/src/lib/infrastructure/dal/repositories/neo4j/Neo4jPullRequestRepository.test.ts` - Repository tests
- `src/lib/infrastructure/github/GithubClient.ts` - GitHub CLI wrapper
- `src/lib/infrastructure/github/types.ts` - GitHub API response types
- `tests/unit/src/lib/infrastructure/github/GithubClient.test.ts` - GithubClient tests

---

## [2.5.5] - 2026-01-26

### Changed

#### CLI Modularization ([#18](https://github.com/TonyCasey/lisa/issues/18), [#45](https://github.com/TonyCasey/lisa/pull/45))
- **Extracted init command** - `src/lib/commands/init.ts` now contains all initialization logic
  - 571 lines extracted from cli.ts into dedicated module
  - Cleaner separation of concerns
  - Easier to maintain and test

- **Extracted docker command** - `src/lib/commands/docker.ts` for Docker-related operations
  - Container management functions isolated
  - Reusable across commands

- **Shared constants module** - `src/lib/commands/shared/constants.ts`
  - Centralized configuration values
  - Reduces magic strings across codebase

- **CLI reduced from 800+ to ~100 lines** - Main cli.ts now focuses on command registration
  - Delegates to dedicated command modules
  - Improved code organization

#### Architecture Documentation ([#19](https://github.com/TonyCasey/lisa/issues/19))
- **New `docs/architecture/` directory** with detailed documentation:
  - `README.md` - Architecture overview and navigation
  - `dal-routing.md` - DAL routing strategy and fallback behavior
  - `events.md` - Event-driven architecture and hook lifecycle
  - `mcp-sessions.md` - MCP session management and implicit sessions
  - `timeouts.md` - Timeout and cancellation with AbortController
  - `transcripts.md` - Transcript resolution algorithm

### Fixed
- **CodeRabbit review comments** - Addressed PR #45 review feedback

### New Files
- `src/lib/commands/init.ts` - Init command implementation
- `src/lib/commands/docker.ts` - Docker command implementation
- `src/lib/commands/shared/constants.ts` - Shared constants
- `src/lib/commands/shared/index.ts` - Module exports
- `docs/architecture/README.md` - Architecture documentation index
- `docs/architecture/dal-routing.md` - DAL routing documentation
- `docs/architecture/events.md` - Events documentation
- `docs/architecture/mcp-sessions.md` - MCP sessions documentation
- `docs/architecture/timeouts.md` - Timeouts documentation
- `docs/architecture/transcripts.md` - Transcripts documentation

---

## [2.5.4] - 2026-01-23

### Added

#### Auto-label Issues ([#21](https://github.com/TonyCasey/lisa/issues/21))
- **`lisa issue create`** - Create GitHub issues with automatic label inference
  - Analyzes title and body to suggest appropriate labels
  - Supports conventional commit prefixes (`fix:`, `feat:`, `docs:`, `refactor:`, `test:`)
  - Detects keywords in body content for type, priority, and phase labels
  - Shows inferred labels with reasons before creation
  - Interactive confirmation (skippable with `--yes`)

- **`lisa issue labels`** - Preview label inference without creating an issue
  - Useful for testing what labels would be inferred
  - Supports `--json` output for scripting

- **Label inference rules**:
  | Pattern | Label |
  |---------|-------|
  | `fix:`, `bug:` prefix or "bug", "broken", "error" in body | `bug` |
  | `feat:`, `feature:` prefix or "add", "implement" in body | `enhancement` |
  | `docs:` prefix or "document", "readme" in body | `documentation` |
  | `refactor:` prefix or "refactor", "clean up" in body | `refactor` |
  | `test:` prefix or "test", "coverage" in body | `testing` |
  | "critical", "urgent", "blocking" in body | `priority:high` |
  | "reliability", "timeout", "race condition" in body | `phase:1` |
  | "unit test", "test coverage" in body | `phase:2` |
  | "observability", "logging", "diagnostic" in body | `phase:3` |
  | "maintainability", "modular", "architecture" in body | `phase:4` |

- **CLI options**:
  - `--title`, `--body` - Issue content
  - `--label` - Explicit labels (bypass auto-inference for type)
  - `--no-auto-label` - Disable automatic inference
  - `--yes` - Skip confirmation prompt
  - `--dry-run` - Preview without creating

- **Confidence scoring**:
  - Prefix matches: 95% confidence
  - Title matches: 80% confidence
  - Body-only matches: 60% confidence

### New Files
- `src/lib/domain/interfaces/ILabelInference.ts` - Label inference interfaces
- `src/lib/infrastructure/services/LabelInferenceService.ts` - Implementation
- `tests/unit/src/lib/infrastructure/services/LabelInferenceService.test.ts` - 37 tests

### Testing
- 37 new unit tests for label inference
- Total unit tests: 338 (up from 301)

---

## [2.5.3] - 2026-01-23

### Added

#### Comprehensive Doctor Command ([#17](https://github.com/TonyCasey/lisa/issues/17))
- **`lisa doctor --verbose`** - Detailed diagnostic output including:
  - System information (Lisa version, project root, timestamp)
  - Full configuration details (mode, group, endpoint, env file status)
  - Health check timing for each component
  - Transcript discovery paths and candidates
  - Summary with pass/warning/error counts

- **`lisa doctor --json`** - Machine-readable JSON output for scripting and CI integration
  - Complete diagnostic data in structured format
  - Includes all check results with timing
  - Transcript candidate metadata

- **Enhanced health checks**:
  - Lisa directory structure validation (.lisa/skills, .lisa/rules)
  - Claude Code hooks configuration check
  - Neo4j direct connectivity test (local mode)
  - Zep Cloud API reachability test (zep-cloud mode)
  - Compose file existence verification

- **Exit codes for scripting**:
  - `0` = All checks passed
  - `1` = Warnings detected (non-blocking issues)
  - `2` = Errors detected (blocking issues)

- **New module architecture**:
  - `src/lib/commands/doctor.ts` - Standalone command module
  - Clean separation of health checks, formatting, and CLI integration
  - Comprehensive test suite (30 tests)

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

### Changed
- Refactored doctor command from inline function to modular command pattern
- Improved doctor command description: "Validate Lisa configuration and backend connectivity"

### New Files
- `src/lib/commands/doctor.ts` - Doctor command implementation
- `src/lib/commands/index.ts` - Commands module exports
- `tests/unit/src/lib/commands/doctor.test.ts` - Doctor command tests (30 tests)

### Testing
- 30 new unit tests for doctor command
- 16 new unit tests for structured logging
- Total unit tests: 331 (up from 298)

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
