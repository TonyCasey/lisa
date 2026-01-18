# Hooks Refactoring Plan

**STATUS: COMPLETED** (Jan 2026)

## Final Results

### Hook Size Reduction

| File | Before | After | Reduction |
|------|--------|-------|-----------|
| `session-start.ts` | 626 lines | 167 lines | **73%** |
| `user-prompt-submit.ts` | 556 lines | 206 lines | **63%** |
| `session-stop-worker.ts` | 576 lines | 318 lines | **45%** |
| `session-stop.ts` | 153 lines | 153 lines | (unchanged, properly small) |
| **Total Hooks** | **1,911 lines** | **844 lines** | **56%** |

### New Modules Created

```
src/project/.claude/hooks/
├── core/                         # Core domain logic
│   ├── types.ts                  # Shared interfaces
│   ├── task-loader.ts            # Task processing
│   ├── memory-loader.ts          # Memory loading from MCP
│   ├── rules-loader.ts           # Project rules loading
│   └── index.ts
├── io/                           # I/O operations
│   ├── stdin-reader.ts           # Read JSON from stdin
│   ├── output-formatter.ts       # Format output
│   ├── graphiti-writer.ts        # Write to Graphiti
│   └── index.ts
├── session/                      # Session-specific logic
│   ├── trigger-handler.ts        # Handle trigger types
│   ├── plan-mode.ts              # Plan mode state
│   └── index.ts
└── capture/                      # Work capture (session-stop)
    ├── transcript-finder.ts      # Find transcript files
    ├── retrospective-builder.ts  # Build retrospectives
    ├── local-logger.ts           # Local logging
    ├── summary-builder.ts        # Graphiti summaries
    └── index.ts
```

### Test Coverage

- **143 unit tests** for extracted modules
- All tests passing

---

## Original State Analysis

### File Sizes (Lines of Code)

| File | Lines | Responsibility |
|------|-------|----------------|
| `session-start.ts` | 626 | Memory loading, task loading, formatting, I/O |
| `session-stop-worker.ts` | 576 | Transcript parsing, complexity rating, Graphiti storage, local logs, retrospectives |
| `user-prompt-submit.ts` | 556 | Plan mode, rules loading, memory loading, validation, enhancement, Graphiti storage |
| `session-stop.ts` | 153 | Spawns worker (properly small) |
| **Total Hooks** | **1,911** | |

### Common Modules (Already Extracted)

| File | Lines | Purpose |
|------|-------|---------|
| `complexity-rater.ts` | 371 | Rate work complexity (1-5) |
| `transcript-parser.ts` | 334 | Parse Claude transcripts |
| `context.ts` | 311 | Repo/branch/user detection |
| `zep-client.ts` | 281 | Zep Cloud API client |
| `group-id.ts` | 226 | Folder metadata, hierarchical groups |
| `mcp-client.ts` | 162 | RPC calls to Graphiti |
| **Total Common** | **1,685** | |

**Grand Total: ~3,600 lines** in hooks system

---

## Problems with Current Structure

### 1. Monolithic Files
- `session-start.ts` (626 lines) handles: stdin reading, memory loading, task loading, formatting, output
- `user-prompt-submit.ts` (556 lines) handles: plan mode state, rules loading, memory loading, validation, enhancement, Graphiti storage
- `session-stop-worker.ts` (576 lines) handles: transcript finding, parsing, complexity rating, Graphiti storage, local logs, retrospectives, pattern analysis

### 2. Mixed Concerns
- I/O (stdin/stdout) mixed with business logic
- Formatting mixed with data fetching
- Multiple storage backends handled inline

### 3. Duplicated Patterns
- Memory loading appears in both `session-start.ts` and `user-prompt-submit.ts`
- Graphiti storage appears in both `session-stop-worker.ts` and `user-prompt-submit.ts`
- Similar timeout/error handling patterns repeated

### 4. Hard to Test
- No clear boundaries for unit testing
- Side effects (I/O, spawning processes) embedded in logic

---

## Proposed Architecture

### Directory Structure

```
src/project/.claude/hooks/
├── index.ts                      # Re-exports for external use
├── session-start.ts              # ~50 lines - orchestration only
├── session-stop.ts               # ~50 lines - spawns worker (keep as-is)
├── session-stop-worker.ts        # ~80 lines - orchestration only
├── user-prompt-submit.ts         # ~60 lines - orchestration only
│
├── core/                         # Core domain logic
│   ├── index.ts
│   ├── types.ts                  # Shared interfaces (IMemoryItem, ITask, etc.)
│   ├── memory-loader.ts          # Load memories from MCP/Zep
│   ├── task-loader.ts            # Load and process tasks
│   ├── init-review-loader.ts     # Load codebase summary
│   └── rules-loader.ts           # Load project rules
│
├── io/                           # I/O operations
│   ├── index.ts
│   ├── stdin-reader.ts           # Read JSON from stdin
│   ├── output-formatter.ts       # Format output for Claude/user
│   └── graphiti-writer.ts        # Write to Graphiti (sync/async)
│
├── session/                      # Session-specific logic
│   ├── index.ts
│   ├── session-context.ts        # Build session context (repo, branch, user)
│   ├── trigger-handler.ts        # Handle different trigger types
│   └── plan-mode.ts              # Plan mode state management
│
├── capture/                      # Work capture (session-stop)
│   ├── index.ts
│   ├── transcript-finder.ts      # Find transcript files
│   ├── work-analyzer.ts          # Analyze work done
│   ├── retrospective-builder.ts  # Build retrospective learnings
│   └── storage-router.ts         # Route to Graphiti vs local logs
│
├── validation/                   # Prompt validation (user-prompt-submit)
│   ├── index.ts
│   ├── prompt-validator.ts       # Validate prompts
│   └── prompt-enhancer.ts        # Suggest enhancements
│
└── common/                       # Keep existing (already well-factored)
    ├── mcp-client.ts
    ├── context.ts
    ├── group-id.ts
    ├── zep-client.ts
    ├── transcript-parser.ts
    └── complexity-rater.ts
```

### Module Responsibilities

#### `core/` - Pure Domain Logic

**memory-loader.ts** (~80 lines)
```typescript
export interface IMemoryLoadOptions {
  aliases: string[];
  hierarchicalGroups: string[];
  branch: string | null;
  timeoutMs?: number;
}

export interface IMemoryLoadResult {
  facts: IMemoryItem[];
  nodes: IMemoryItem[];
  tasks: IMemoryItem[];
  initReview: string | null;
  timedOut: boolean;
}

export async function loadMemory(options: IMemoryLoadOptions): Promise<IMemoryLoadResult>;
export async function loadRecentFacts(groupIds: string[], limit?: number): Promise<IMemoryItem[]>;
export async function loadTasks(aliases: string[], groupIds: string[]): Promise<IMemoryItem[]>;
```

**task-loader.ts** (~60 lines)
```typescript
export interface ITask {
  key: string;
  status: string;
  title: string;
  blocked: string[];
  created_at?: string;
}

export interface ITaskSummary {
  tasks: ITask[];
  counts: ITaskCounts;
  active: ITask[];
  ready: ITask[];
}

export function processTasks(taskNodes: IMemoryItem[]): ITaskSummary;
```

#### `io/` - I/O Isolation

**stdin-reader.ts** (~30 lines)
```typescript
export interface IStdinOptions {
  timeoutMs?: number;
}

export async function readJsonStdin<T>(options?: IStdinOptions): Promise<T>;
```

**output-formatter.ts** (~100 lines)
```typescript
export interface ISessionStartOutput {
  trigger: SessionTrigger;
  user: string;
  folder: string;
  folderType: string;
  repo: string;
  branch: string | null;
  initReview: string | null;
  recentMemories: string[];
  taskSummary: ITaskSummary;
  timedOut: boolean;
}

export function formatSessionStartOutput(data: ISessionStartOutput): string;
export function formatUserMessage(data: ISessionStartOutput): string;
```

**graphiti-writer.ts** (~50 lines)
```typescript
export interface IGraphitiWriteOptions {
  fact: string;
  group: string;
  tags: string[];
  source: string;
  async?: boolean;  // Fire-and-forget mode
}

export async function writeToGraphiti(options: IGraphitiWriteOptions): Promise<void>;
export function writeToGraphitiAsync(options: IGraphitiWriteOptions): void;
```

#### `session/` - Session Logic

**trigger-handler.ts** (~40 lines)
```typescript
export type SessionTrigger = 'startup' | 'resume' | 'compact' | 'clear';

export function getTriggerMessage(trigger: SessionTrigger): string;
export function getTriggerReminders(trigger: SessionTrigger): string[];
```

**plan-mode.ts** (~50 lines) - Extract from user-prompt-submit
```typescript
export function shouldLoadPlanContext(isPlanMode: boolean): boolean;
export function markPlanModeLoaded(): void;
export function clearPlanModeState(): void;
```

#### `capture/` - Work Capture

**work-analyzer.ts** (~80 lines)
```typescript
export interface IWorkAnalysis {
  filesModified: Set<string>;
  filesCreated: Set<string>;
  commandsRun: string[];
  toolsUsed: Map<string, number>;
  summary: string;
  durationMs: number;
}

export function analyzeWork(transcript: ITranscript): IWorkAnalysis;
export function hasSignificantWork(analysis: IWorkAnalysis): boolean;
```

**storage-router.ts** (~60 lines)
```typescript
export type StorageTarget = 'graphiti' | 'local';

export function determineStorageTarget(complexity: number): StorageTarget;
export async function routeToStorage(work: IWorkAnalysis, rating: IComplexityRating): Promise<void>;
```

---

## Refactored Hook Examples

### session-start.ts (After: ~50 lines)

```typescript
#!/usr/bin/env node
import { readJsonStdin } from './io/stdin-reader';
import { loadMemory } from './core/memory-loader';
import { processTasks } from './core/task-loader';
import { buildSessionContext } from './session/session-context';
import { getTriggerMessage, getTriggerReminders } from './session/trigger-handler';
import { formatSessionStartOutput, formatUserMessage } from './io/output-formatter';

interface HookInput {
  trigger?: SessionTrigger;
  session_type?: SessionTrigger;
}

async function main(): Promise<void> {
  // 1. Read input
  const input = await readJsonStdin<HookInput>({ timeoutMs: 100 });
  const trigger = input.trigger || input.session_type || 'startup';

  // 2. Build context
  const context = buildSessionContext();

  // 3. Load memory
  const memory = await loadMemory({
    aliases: context.aliases,
    hierarchicalGroups: context.hierarchicalGroups,
    branch: context.branch,
    timeoutMs: 5000,
  });

  // 4. Process tasks
  const taskSummary = processTasks(memory.tasks);

  // 5. Format and output
  const output = formatSessionStartOutput({
    trigger,
    ...context,
    initReview: memory.initReview,
    recentMemories: memory.facts,
    taskSummary,
    timedOut: memory.timedOut,
  });

  console.log(output);
  console.error(formatUserMessage({ trigger, itemCount: memory.facts.length, taskCount: taskSummary.tasks.length }));
  process.exit(0);
}

main().catch((err) => {
  console.log(`Memory load skipped: ${err.message}`);
  process.exit(0);
});
```

### user-prompt-submit.ts (After: ~60 lines)

```typescript
#!/usr/bin/env node
import { readJsonStdin } from './io/stdin-reader';
import { shouldLoadPlanContext } from './session/plan-mode';
import { loadRulesSummary } from './core/rules-loader';
import { loadRecentFacts } from './core/memory-loader';
import { validatePrompt } from './validation/prompt-validator';
import { enhancePrompt } from './validation/prompt-enhancer';
import { writeToGraphitiAsync } from './io/graphiti-writer';
import { logPrompt } from './io/prompt-logger';

interface HookInput {
  prompt?: string;
  permission_mode?: string;
}

async function main(): Promise<void> {
  const input = await readJsonStdin<HookInput>();
  const prompt = input.prompt || '';
  if (!prompt) {
    process.exit(0);
  }

  // Plan mode context loading
  const isPlanMode = input.permission_mode === 'plan';
  if (shouldLoadPlanContext(isPlanMode)) {
    const [rules, memory, retrospectives] = await Promise.all([
      loadRulesSummary(),
      loadRecentFacts(15),
      loadRetrospectiveMemory(5),
    ]);
    // Output context...
  }

  // Validate and enhance
  validatePrompt(prompt).forEach(w => console.log(w));
  enhancePrompt(prompt).forEach(s => console.log(s));

  // Log and store (fire-and-forget)
  logPrompt(prompt);
  writeToGraphitiAsync({ fact: prompt, source: 'user-prompt' });

  process.exit(0);
}

main().catch(() => process.exit(0));
```

---

## Migration Strategy

### Phase 1: Extract Pure Functions (Low Risk)
1. Create `core/types.ts` with shared interfaces
2. Extract `core/task-loader.ts` (pure function, no I/O)
3. Extract `session/trigger-handler.ts` (pure function)
4. Add unit tests for extracted modules

### Phase 2: Extract I/O Modules (Medium Risk)
1. Extract `io/stdin-reader.ts`
2. Extract `io/graphiti-writer.ts`
3. Extract `io/output-formatter.ts`
4. Update hooks to use new modules

### Phase 3: Extract Domain Logic (Medium Risk)
1. Extract `core/memory-loader.ts`
2. Extract `core/rules-loader.ts`
3. Extract `session/plan-mode.ts`
4. Update hooks to use new modules

### Phase 4: Extract Capture Logic (Low Risk)
1. Extract `capture/work-analyzer.ts`
2. Extract `capture/storage-router.ts`
3. Extract `capture/retrospective-builder.ts`
4. Update session-stop-worker to use new modules

### Phase 5: Cleanup
1. Reduce main hooks to orchestration only
2. Remove dead code
3. Update AGENTS.md documentation
4. Full test coverage

---

## Expected Outcomes

### Before
- 4 monolithic hook files (~1,900 lines)
- 6 common modules (~1,700 lines)
- Hard to test, hard to understand

### After
- 4 thin orchestration hooks (~200 lines total)
- ~15 focused modules (~2,400 lines total)
- Each module has single responsibility
- Easy to test in isolation
- Clear boundaries for future changes

### Benefits
1. **Testability**: Each module can be unit tested independently
2. **Readability**: Smaller files, clearer purpose
3. **Reusability**: Modules can be shared across hooks
4. **Maintainability**: Changes isolated to specific modules
5. **Onboarding**: New developers can understand pieces incrementally

---

## Open Questions

1. **Backward Compatibility**: Should we maintain the old structure as deprecated?
2. **Build Process**: Does the build copy nested directories correctly?
3. **Common Modules**: Should `common/` be merged into `core/` and `io/`?
4. **Testing Strategy**: Integration tests for hooks, unit tests for modules?
