# Intelligent Work Capture System - Implementation Plan

## Overview

Design and implement an automatic work capture system that:
1. **Captures AI work outcomes** after Claude completes responses
2. **Rates work complexity** on a 1-5 scale
3. **Routes intelligently**:
   - Complexity 3-5 → Graphiti MCP (significant work)
   - Complexity 1-2 → Local .logs/ directory (minor changes)
4. **Completely automatic** - no user intervention required
5. **Non-blocking async design** - stops session instantly, processes in background
6. **Uses Stop hook** + detached worker + memory skill for implementation

## Architecture

### Components

```
┌─────────────────────────────────────────────────┐
│         Claude Code Session                      │
│  1. User: "implement feature X"                  │
│  2. Claude: creates files, edits, runs tests     │
│  3. Claude: outputs summary                      │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
        ┌──────────────────────┐
        │   Stop Hook Fires     │  ← FAST (< 50ms)
        │  (session-stop.js)    │
        └─────────┬─────────────┘
                  │
                  ├─→ Spawn detached background worker
                  │
                  └─→ Exit immediately ✅
                      (User's session stops - NO DELAY)


    ┌───────────────────────────────┐
    │  Background Worker (ASYNC)     │  ← SLOW (1-7 seconds)
    │  (session-stop-worker.js)      │
    └────────┬──────────────────────┘
             │
             ▼
   ┌─────────────────────────┐
   │  Transcript Analyzer     │
   │  - Parse JSONL           │
   │  - Extract tool uses     │
   │  - Count files modified  │
   │  - Detect patterns       │
   └────────┬─────────────────┘
            │
            ▼
   ┌──────────────────────┐
   │  Complexity Rater     │
   │  Algorithm: 1-5 scale │
   └─────────┬─────────────┘
             │
   ┌─────────┴──────────┐
   │                    │
   ▼                    ▼
┌─────────────┐   ┌──────────────┐
│ Rating 1-2  │   │ Rating 3-5   │
│ Local Logs  │   │  Graphiti    │
│  .logs/     │   │  via MCP     │
└─────────────┘   └──────────────┘
```

### File Structure

```
.claude/
├── hooks/
│   ├── session-stop.js            ← NEW: Stop hook (fast, < 50ms)
│   ├── session-stop-worker.js     ← NEW: Background worker (async)
│   ├── common/
│   │   ├── mcp-client.js          ← Existing: MCP RPC calls
│   │   ├── context.js             ← Existing: Repo/branch detection
│   │   ├── transcript-parser.js   ← NEW: Parse transcript JSONL
│   │   └── complexity-rater.js    ← NEW: Complexity algorithm
│   └── README.md
├── settings.json                   ← Update: Add Stop hook registration
└── config.js                       ← Existing: Shared constants

.logs/                              ← NEW: Local work logs
├── work-sessions.jsonl             ← All sessions (complexity 1-2)
├── stop-hook-errors.log            ← Worker error log
└── archive/                        ← Optional: Old sessions

src/templates/claude/hooks/
├── session-stop.ts                 ← NEW: Main hook (spawns worker, exits fast)
├── session-stop-worker.ts          ← NEW: Background worker (does actual work)
├── common/
│   ├── transcript-parser.ts        ← NEW: Transcript analysis
│   └── complexity-rater.ts         ← NEW: Complexity algorithm
└── ...
```

---

## Phase 1: Transcript Parser (NEW)

**File:** `src/templates/claude/hooks/common/transcript-parser.ts`

### Purpose
Parse Claude Code JSONL transcripts to extract work performed.

### Key Functions

```typescript
interface ITranscriptEntry {
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    content?: string;
    command?: string;
  };
  tool_response?: any;
  message?: {
    role: 'user' | 'assistant';
    content: Array<{ type: 'text'; text: string }>;
  };
  timestamp?: string;
  parentUuid?: string;
  isSidechain?: boolean;
}

interface IWorkSummary {
  filesModified: Set<string>;
  filesCreated: Set<string>;
  commandsRun: string[];
  toolsUsed: Map<string, number>;  // tool name → count
  assistantSummary: string;        // Claude's final output
  timestamp: string;
  durationMs: number;
}

export function parseTranscript(transcriptPath: string): IWorkSummary
export function getFilesModified(entries: ITranscriptEntry[]): Set<string>
export function getToolDistribution(entries: ITranscriptEntry[]): Map<string, number>
export function extractAssistantSummary(entries: ITranscriptEntry[]): string
```

### Implementation Details

1. **Read JSONL file** line by line
2. **Filter side chains** (isSidechain === true → exclude)
3. **Categorize tool uses**:
   - Write → filesCreated
   - Edit → filesModified
   - Bash → commandsRun
4. **Extract last assistant message** as summary
5. **Calculate duration** (first timestamp → last timestamp)

### Edge Cases

- **Transcript path bug**: If transcript file doesn't exist or is stale, find most recently modified `.jsonl` in session directory
- **Empty transcript**: Return empty WorkSummary (complexity will be 1)
- **Malformed JSONL**: Skip invalid lines, continue parsing

---

## Phase 2: Complexity Rater (NEW)

**File:** `src/templates/claude/hooks/common/complexity-rater.ts`

### Purpose
Rate work complexity on a 1-5 scale based on signals extracted from transcript.

### Algorithm

```typescript
interface IComplexitySignals {
  filesModified: number;
  filesCreated: number;
  versionBump: boolean;
  docsCreated: number;
  testsCreated: number;
  configFiles: number;
  structuralChanges: number;
  toolDiversity: number;
}

interface IComplexityRating {
  rating: 1 | 2 | 3 | 4 | 5;
  rawScore: number;
  signals: string[];
  summary: string;
}

export function rateComplexity(work: IWorkSummary): IComplexityRating
```

### Scoring Formula

**Base Points:**
```
Files Created (Write):     3 points each
Files Edited (Edit):       2 points each
Commands (Bash):           2 points each (weighted by type)
Documentation (*.md):      2 points each
Tests (*.test.*):          1.5 points each
Config files:              1 point each
```

**Bonuses:**
```
Version Bump (package.json):  +2 points
Structural Change (mkdir):    +2 points per directory
Multi-service/Directory:      +3 points
CI/CD Setup:                  +3 points
```

**Multipliers:**
```
Tool Diversity (5+ types):    ×1.2
Tool Diversity (8+ types):    ×1.3
```

**Normalization to 1-5:**
```
Raw Score  →  Rating
0-2        →  1 (Trivial: typo fix, single read)
2-5        →  2 (Simple: 1-3 file edits)
5-10       →  3 (Moderate: feature with tests)
10-20      →  4 (Complex: multi-file refactor)
20+        →  5 (Very Complex: version release, major milestone)
```

### Detection Patterns

**Version Bump Detection:**
```typescript
function hasVersionBump(filesModified: Set<string>): boolean {
  const versionFiles = ['package.json', 'pyproject.toml', 'Cargo.toml', 'setup.py'];
  return Array.from(filesModified).some(path =>
    versionFiles.some(vf => path.endsWith(vf))
  );
}
```

**Documentation Detection:**
```typescript
function countDocs(filesCreated: Set<string>): number {
  return Array.from(filesCreated).filter(path =>
    path.endsWith('.md') ||
    path.includes('/docs/') ||
    path.includes('README')
  ).length;
}
```

**Test File Detection:**
```typescript
function countTests(filesModified: Set<string>): number {
  return Array.from(filesModified).filter(path =>
    path.match(/\.(test|spec)\.(ts|js|py|rs)$/) ||
    path.includes('/tests/') ||
    path.includes('/__tests__/')
  ).length;
}
```

**Config File Detection:**
```typescript
const configFiles = [
  'tsconfig.json', 'jest.config', '.eslintrc', '.prettierrc',
  'webpack.config', 'vite.config', 'rollup.config',
  '.gitignore', '.dockerignore', 'Dockerfile'
];

function countConfigFiles(filesModified: Set<string>): number {
  return Array.from(filesModified).filter(path =>
    configFiles.some(cf => path.includes(cf))
  ).length;
}
```

### Output Examples

**Complexity 1 (Trivial):**
```json
{
  "rating": 1,
  "rawScore": 1.5,
  "signals": ["Single file edited"],
  "summary": "Minor change: edited utils/helpers.ts"
}
```

**Complexity 3 (Moderate):**
```json
{
  "rating": 3,
  "rawScore": 8.2,
  "signals": [
    "4 files modified",
    "2 test files added",
    "1 documentation file created"
  ],
  "summary": "Feature implementation with tests and docs"
}
```

**Complexity 5 (Very Complex):**
```json
{
  "rating": 5,
  "rawScore": 25.6,
  "signals": [
    "Version bump: 0.1.0 → 0.5.0",
    "12 files modified",
    "3 documentation files created",
    "DEPLOYMENT.md, CHANGELOG.md added",
    "Multi-directory structural changes"
  ],
  "summary": "Major release: v0.5.0 documentation and cleanup"
}
```

---

## Phase 3: Stop Hook Implementation (ASYNC - NON-BLOCKING)

### Overview

The Stop hook uses a **2-process architecture** for instant session termination:

1. **Main Hook** (`session-stop.ts`) - Exits within < 50ms
2. **Background Worker** (`session-stop-worker.ts`) - Does the heavy lifting asynchronously

### Part A: Main Hook (Fast Exit)

**File:** `src/templates/claude/hooks/session-stop.ts`

**Purpose:** Spawn background worker and exit immediately - NEVER block the CLI.

**Flow:**

```typescript
#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

interface StopHookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  stop_hook_active: boolean;
}

async function main() {
  // 1. Read input from stdin (JSON)
  const input: StopHookInput = await readStdin();

  // 2. Safety: prevent infinite loops
  if (input.stop_hook_active) {
    console.log(JSON.stringify({ continue: false }));
    process.exit(0);
  }

  // 3. Spawn detached background worker
  const workerPath = path.join(__dirname, 'session-stop-worker.js');
  const worker = spawn('node', [
    workerPath,
    JSON.stringify(input)  // Pass input as CLI argument
  ], {
    detached: true,        // ← Detach from parent process
    stdio: 'ignore',       // ← Don't wait for I/O
    cwd: input.cwd         // ← Worker runs in project directory
  });

  // 4. Unref to allow parent to exit independently
  worker.unref();

  // 5. Exit immediately (< 50ms total)
  console.log(JSON.stringify({
    continue: false,
    stopReason: 'Work capture queued in background'
  }));

  process.exit(0);
}

async function readStdin(): Promise<StopHookInput> {
  return new Promise((resolve) => {
    let input = '';
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => {
      resolve(JSON.parse(input));
    });
  });
}

main().catch(err => {
  // Never block - exit cleanly even on error
  console.error(`Stop hook error: ${err.message}`);
  console.log(JSON.stringify({ continue: false }));
  process.exit(0);
});
```

**Key Features:**
- ✅ **Detached spawn** - Worker runs independently
- ✅ **stdio: 'ignore'** - No I/O blocking
- ✅ **worker.unref()** - Parent can exit without waiting
- ✅ **Exits in < 50ms** - User sees instant session stop

---

### Part B: Background Worker (Async Heavy Lifting)

**File:** `src/templates/claude/hooks/session-stop-worker.ts`

**Purpose:** Parse transcript, rate complexity, save to Graphiti/logs (runs asynchronously in background).

**Flow:**

```typescript
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { parseTranscript } = require('./common/transcript-parser');
const { rateComplexity } = require('./common/complexity-rater');

interface StopHookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
}

async function main() {
  try {
    // 1. Parse input from CLI argument
    const input: StopHookInput = JSON.parse(process.argv[2] || '{}');

    // 2. Validate transcript exists
    const transcriptPath = findTranscript(input.transcript_path);
    if (!transcriptPath) {
      logError('Transcript not found', input.transcript_path);
      process.exit(0);
    }

    // 3. Parse transcript (SLOW - 500ms-2s)
    const work = parseTranscript(transcriptPath);

    // 4. Rate complexity (FAST - ~10ms)
    const rating = rateComplexity(work);

    // 5. Route based on complexity (SLOW - 500ms-5s)
    if (rating.rating >= 3) {
      await saveToGraphiti(work, rating, input);
    } else {
      await saveToLocalLogs(work, rating, input);
    }

    // 6. Exit when done
    process.exit(0);

  } catch (err) {
    logError('Worker error', err.message);
    process.exit(1);
  }
}

function findTranscript(providedPath: string): string | null {
  // Handle known bug: transcript_path may be stale
  // Find most recently modified .jsonl in session directory
  if (fs.existsSync(providedPath)) {
    return providedPath;
  }

  const dir = path.dirname(providedPath);
  if (!fs.existsSync(dir)) {
    return null;
  }

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({ path: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);

  return files.length > 0 ? files[0].path : null;
}

function logError(message: string, details?: string) {
  const logFile = path.join(process.cwd(), '.logs', 'stop-hook-errors.log');
  const logDir = path.dirname(logFile);

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const timestamp = new Date().toISOString();
  const entry = `${timestamp}: ${message} ${details || ''}\n`;
  fs.appendFileSync(logFile, entry);
}

// Error handler for uncaught exceptions
process.on('uncaughtException', (err) => {
  logError('Uncaught exception', err.stack);
  process.exit(1);
});

// Run main
main();
```

**Key Features:**
- ✅ **Runs asynchronously** - No impact on CLI performance
- ✅ **Error logging** - Failures written to `.logs/stop-hook-errors.log`
- ✅ **Graceful degradation** - Continues even if Graphiti is down
- ✅ **Transcript path workaround** - Handles known bug by finding most recent file

---

### Input/Output

**Main Hook Input (stdin JSON):**
```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/Users/tony/project",
  "stop_hook_active": false
}
```

**Main Hook Output (stdout JSON - FAST):**
```json
{
  "continue": false,
  "stopReason": "Work capture queued in background"
}
```

**Worker Input (CLI argument):**
```bash
node session-stop-worker.js '{"session_id":"abc123","transcript_path":"...",...}'
```

**Worker Output:**
- None to stdout (detached process)
- Writes to `.logs/work-sessions.jsonl` or calls Graphiti MCP
- Errors logged to `.logs/stop-hook-errors.log`

---

### Functions

**Main Hook:**
```typescript
async function readStdin(): Promise<StopHookInput>
```

**Background Worker:**
```typescript
async function saveToGraphiti(work: WorkSummary, rating: ComplexityRating, input: StopHookInput): Promise<void>
async function saveToLocalLogs(work: WorkSummary, rating: ComplexityRating, input: StopHookInput): Promise<void>
function findTranscript(providedPath: string): string | null
function logError(message: string, details?: string): void
```

---

## Phase 4: Graphiti Storage (Integration)

### Use Memory Skill

**Approach:** Spawn child process to call memory.js (Pattern B from research)

**Called from:** Background worker (`session-stop-worker.ts`)

```typescript
async function saveToGraphiti(
  work: WorkSummary,
  rating: ComplexityRating,
  input: StopHookInput
): Promise<void> {
  const { detectRepo, detectBranch } = require('./common/context');
  const { spawn } = require('child_process');
  const path = require('path');

  const repo = detectRepo();
  const branch = detectBranch();

  // Build summary text
  const summary = buildGraphitiSummary(work, rating, repo, branch);

  // Call memory skill
  const memoryScript = path.join(
    input.cwd,
    '.agents/skills/memory/scripts/memory.js'
  );

  const child = spawn('node', [
    memoryScript,
    'add',
    summary,
    '--group', repo || 'agent-memories',
    '--tag', 'automated',
    '--tag', `complexity:${rating.rating}`,
    '--tag', 'milestone',
    '--source', 'session-stop',
    '--cache'
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
    cwd: input.cwd  // Run in project directory
  });

  return new Promise((resolve) => {
    child.on('close', () => resolve());
    child.on('error', () => resolve());  // Non-blocking
  });
}
```

### Summary Format

```
MILESTONE [complexity:3]: Feature implementation with tests

Session: abc123
Duration: 12m 34s
Files modified: 4
Files created: 2
Tests added: 3

Key changes:
- Created src/services/AuthService.ts
- Added tests/services/AuthService.test.ts
- Updated README.md with authentication docs
- Modified package.json dependencies

Tools used: Write (3x), Edit (4x), Bash (2x), TodoWrite (1x)

Summary: Implemented user authentication service with JWT support,
including comprehensive test coverage and updated documentation.
```

### Tags Applied

- `automated` - Indicates automatic capture
- `complexity:N` - Complexity rating (1-5)
- `milestone` - For ratings 3+
- `session:id` - Session identifier
- `repo:name` - Repository name
- `branch:name` - Git branch

---

## Phase 5: Local Logging (NEW)

### File Format

**Location:** `.logs/work-sessions.jsonl`

**Format:** JSONL (one JSON object per line)

```json
{
  "timestamp": "2026-01-08T18:30:45Z",
  "sessionId": "abc123",
  "complexity": 2,
  "rawScore": 4.5,
  "signals": ["2 files edited", "Single feature"],
  "repo": "agent-memories",
  "branch": "main",
  "duration": "3m 22s",
  "filesModified": ["src/utils/helpers.ts", "src/config.ts"],
  "filesCreated": [],
  "toolsUsed": {"Edit": 2, "Read": 3},
  "summary": "Minor refactor of utility functions"
}
```

### Implementation

**Called from:** Background worker (`session-stop-worker.ts`)

```typescript
async function saveToLocalLogs(
  work: WorkSummary,
  rating: ComplexityRating,
  input: StopHookInput
): Promise<void> {
  const fs = require('fs');
  const path = require('path');
  const { detectRepo, detectBranch } = require('./common/context');

  const logsDir = path.join(input.cwd, '.logs');
  const logsFile = path.join(logsDir, 'work-sessions.jsonl');

  // Ensure directory exists
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // Build log entry
  const entry = {
    timestamp: new Date().toISOString(),
    sessionId: input.session_id || 'unknown',
    complexity: rating.rating,
    rawScore: rating.rawScore,
    signals: rating.signals,
    repo: detectRepo(),
    branch: detectBranch(),
    duration: formatDuration(work.durationMs),
    filesModified: Array.from(work.filesModified),
    filesCreated: Array.from(work.filesCreated),
    toolsUsed: Object.fromEntries(work.toolsUsed),
    summary: work.assistantSummary.substring(0, 200)  // Truncate
  };

  // Append to JSONL
  fs.appendFileSync(logsFile, JSON.stringify(entry) + '\n');
}
```

### Log Rotation (Optional)

For large projects with many sessions:

```typescript
function rotateLogsIfNeeded(logsFile: string) {
  const MAX_SIZE = 10 * 1024 * 1024;  // 10 MB
  const stats = fs.statSync(logsFile);

  if (stats.size > MAX_SIZE) {
    const archiveDir = path.join(path.dirname(logsFile), 'archive');
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir);
    }

    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const archivePath = path.join(archiveDir, `work-sessions-${timestamp}.jsonl`);
    fs.renameSync(logsFile, archivePath);
  }
}
```

---

## Phase 6: Configuration & Registration

### Update `.claude/settings.json`

Add Stop hook registration:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/session-start.js"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/user-prompt-submit.js"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node .claude/hooks/session-stop.js"
          }
        ]
      }
    ]
  }
}
```

### Update `.gitignore`

Add local logs directory:

```gitignore
# Work session logs (local only, not for Graphiti)
.logs/
.logs/*.jsonl
.logs/*.log
.logs/archive/
```

### Update `src/templates/` Build

Ensure Stop hook is deployed:

```javascript
// scripts/deploy-agents.js
// Already handles .claude/hooks/ deployment
// No changes needed - new files will be copied automatically
```

---

## Phase 7: Error Handling & Safety

### Main Hook (Fast Exit)

**Critical:** Main hook must NEVER block session stop - exit in < 50ms.

```typescript
// Main hook error handling (session-stop.ts)
main().catch(err => {
  // Never block - exit cleanly even on error
  console.error(`Stop hook error: ${err.message}`);
  console.log(JSON.stringify({ continue: false }));
  process.exit(0);  // Always exit 0
});
```

**No timeout needed** - Main hook just spawns worker and exits immediately.

### Background Worker (Async Processing)

**Can take time** - Worker runs detached, doesn't block CLI.

**Error Logging:**
```typescript
// Background worker error handling (session-stop-worker.ts)
function logError(message: string, details?: string): void {
  const fs = require('fs');
  const path = require('path');

  const errorLog = path.join(process.cwd(), '.logs/stop-hook-errors.log');
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${message}\n${details || ''}\n\n`;

  fs.appendFileSync(errorLog, entry);
}

// Uncaught exception handler
process.on('uncaughtException', (err) => {
  logError('Uncaught exception', err.stack);
  process.exit(1);
});
```

### Graceful Degradation

```typescript
// Background worker fallback (session-stop-worker.ts)
async function saveToGraphiti(work, rating, input) {
  try {
    await spawnMemorySkill(work, rating, input);
  } catch (err) {
    // Fallback to local logs on Graphiti failure
    logError('Graphiti unavailable, saving locally', err.message);
    await saveToLocalLogs(work, rating, input);
  }
}
```

### Loop Prevention

```typescript
// Main hook only (session-stop.ts)
if (input.stop_hook_active) {
  // Already in a stop hook continuation - skip to prevent infinite loop
  console.log(JSON.stringify({ continue: false }));
  process.exit(0);
}
```

---

## Implementation Order

1. ✅ **Transcript Parser** (transcript-parser.ts)
   - Parse JSONL
   - Extract work summary
   - Test with sample transcripts

2. ✅ **Complexity Rater** (complexity-rater.ts)
   - Implement scoring algorithm
   - Test with various work patterns
   - Tune thresholds

3. ✅ **Background Worker - Local Logging** (session-stop-worker.ts partial)
   - Implement saveToLocalLogs()
   - Create .logs/ directory structure
   - Test JSONL append

4. ✅ **Background Worker - Graphiti Integration** (session-stop-worker.ts partial)
   - Implement saveToGraphiti()
   - Test memory skill spawning
   - Verify tags and metadata

5. ✅ **Background Worker Complete** (session-stop-worker.ts)
   - Wire all components together
   - Add error logging
   - Test parsing and routing

6. ✅ **Main Hook** (session-stop.ts)
   - Spawn background worker
   - Detached process handling
   - Fast exit (< 50ms)

7. ✅ **Configuration** (settings.json, .gitignore)
   - Register Stop hook
   - Update ignore patterns
   - Deploy to .claude/hooks/

8. ✅ **Testing & Validation**
   - Test with various session types
   - Verify routing logic (3+ vs 1-2)
   - Check Graphiti storage
   - Verify local logs
   - Verify async/non-blocking behavior

---

## Critical Files to Modify

### New Files

1. `src/templates/claude/hooks/session-stop.ts` - Main Stop hook (spawns worker, exits fast)
2. `src/templates/claude/hooks/session-stop-worker.ts` - Background worker (async processing)
3. `src/templates/claude/hooks/common/transcript-parser.ts` - Transcript analysis
4. `src/templates/claude/hooks/common/complexity-rater.ts` - Complexity algorithm
5. `.logs/` - Directory for local session logs (auto-created)

### Modified Files

1. `.claude/settings.json` - Add Stop hook registration
2. `.gitignore` - Add .logs/ directory
3. `DEPLOYMENT.md` - Document Stop hook (optional)

### Existing Files (No Changes)

1. `.claude/hooks/common/mcp-client.js` - Reused as-is
2. `.claude/hooks/common/context.js` - Reused as-is
3. `.agents/skills/memory/scripts/memory.js` - Called via spawn

---

## Verification & Testing

### Manual Testing

**Test Case 1: Trivial Change (Rating 1)**
```bash
# Make small edit
echo "// comment" >> src/test.ts

# Complete session
# Expected: Logs to .logs/work-sessions.jsonl
# Expected: NOT saved to Graphiti
```

**Test Case 2: Moderate Change (Rating 3)**
```bash
# Create multiple files
# Add tests
# Update docs

# Complete session
# Expected: Saved to Graphiti with tags
# Expected: NOT in local logs
```

**Test Case 3: Major Release (Rating 5)**
```bash
# Bump version
# Create CHANGELOG.md
# Update multiple files

# Complete session
# Expected: Saved to Graphiti as milestone
# Expected: complexity:5 tag applied
```

### Automated Testing

```typescript
// tests/hooks/complexity-rater.test.ts
describe('Complexity Rater', () => {
  it('should rate single file edit as 1', () => {
    const work = { filesModified: new Set(['file.ts']), ... };
    const rating = rateComplexity(work);
    expect(rating.rating).toBe(1);
  });

  it('should rate version bump as 5', () => {
    const work = {
      filesModified: new Set(['package.json', ...10 other files]),
      versionBump: true,
      docsCreated: 2
    };
    const rating = rateComplexity(work);
    expect(rating.rating).toBe(5);
  });
});
```

### Validation Queries

```bash
# Check local logs
cat .logs/work-sessions.jsonl | jq '.complexity'

# Check Graphiti storage
node .agents/skills/memory/scripts/memory.js load --cache --query "milestone" | \
  jq '.facts[] | select(.fact | contains("complexity:5"))'

# Verify tagging
node .agents/skills/memory/scripts/memory.js load --cache | \
  jq '.facts[] | select(.episodes[] | contains("automated"))'
```

---

## Future Enhancements (Post-v1)

1. **User Feedback Loop**
   - Allow users to adjust complexity ratings
   - Learn from corrections

2. **Custom Complexity Weights**
   - Per-project configuration for scoring
   - Team-specific preferences

3. **Session Summaries**
   - Daily/weekly rollups
   - Productivity insights

4. **Graphiti Query Dashboard**
   - Visualize work patterns
   - Milestone timelines

5. **Integration with Tasks Skill**
   - Auto-mark tasks complete based on file changes
   - Link sessions to task IDs

---

## Summary

This plan delivers:

✅ **Automatic work capture** - No user action required
✅ **Intelligent routing** - Complexity-based storage decision
✅ **Non-blocking design** - Never interrupts workflow
✅ **Dual storage** - Graphiti for important work, local logs for minor changes
✅ **Comprehensive signals** - 7 categories of complexity detection
✅ **Reusable components** - Modular design for future enhancements
✅ **Production-ready** - Error handling, timeout protection, loop prevention

**Estimated Implementation:** 4-6 hours
**Lines of Code:** ~600-800 (TypeScript)
**Dependencies:** Reuses existing MCP client, context helpers, memory skill

Ready to implement!
