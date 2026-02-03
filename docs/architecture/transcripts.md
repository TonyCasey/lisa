# Transcript Resolution

Lisa captures session work by parsing Claude Code transcripts. This document describes how transcripts are discovered, parsed, and used for memory capture.

## Transcript Discovery

### Search Algorithm

Transcript discovery uses a **deterministic resolution algorithm**:

1. **Explicit Path** - If provided and exists, use directly
2. **Project-Scoped UUID Files** - Search for UUID-named `.jsonl` session files
3. **Legacy Fallback** - Check for `transcript.jsonl` (older Claude Code versions)
4. **Selection** - Choose newest candidate by modification time

```typescript
findTranscript(providedPath?: string): string | null {
  // 1. Explicit path takes priority
  if (providedPath && fs.existsSync(providedPath)) {
    return providedPath;
  }

  // 2. Collect candidates from standard locations
  const candidates = this.findTranscriptCandidates();

  // 3. Sort by mtime descending, return newest
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.path || null;
}
```

### Search Locations

Claude Code stores session transcripts as UUID-named JSONL files in project-scoped directories:

```text
~/.claude/projects/<project-folder>/<session-uuid>.jsonl  (primary)
```

The project folder is derived from the working directory path with path separators replaced by dashes:
- Unix: `/home/user/projects/my-app` -> `home-user-projects-my-app`
- Windows: `C:\dev\lisa` -> `C--dev-lisa`

**UUID pattern:** Files must match `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$`

Non-UUID files and subagent directories are ignored.

### Fallback Strategy

1. **Exact project folder** - Derived from CWD
2. **Scan all projects** - If derived folder doesn't exist, scan all subdirectories
3. **Legacy transcript.jsonl** - Check `~/.claude/projects/<project>/transcript.jsonl` and `~/.claude/transcript.jsonl`

### Multiple Candidates

When multiple transcripts are found, a warning is logged and the newest is selected:

```typescript
if (candidates.length > 1) {
  this.logger.warn('Multiple transcript candidates found', {
    count: candidates.length,
    selected: candidates[0].path,
  });
}
```

## Transcript Format

Transcripts use **JSONL (JSON Lines)** format - one JSON object per line.

### Message Structure

```typescript
interface ITranscriptMessage {
  type: string;                     // "user", "assistant", "tool_use", "tool_result"
  message?: {
    role?: string;                  // "user" or "assistant"
    content?: string | Array<{
      type: string;
      text?: string;
      name?: string;               // Tool name (for tool_use)
      is_error?: boolean;          // Error flag (for tool_result)
    }>;
  };
  summary?: string;                 // File operation summaries
}
```

### Example Transcript Lines

```json
{"type":"user","message":{"role":"user","content":"Fix the login bug"}}
{"type":"assistant","message":{"role":"assistant","content":"I'll look into that..."}}
{"type":"tool_use","message":{"content":[{"type":"tool_use","name":"read_file"}]}}
{"type":"tool_result","message":{"content":[{"type":"tool_result","text":"...","is_error":false}]}}
{"summary":"Modified: src/auth.ts"}
```

## Transcript Parsing

### Parsed Output

```typescript
interface IWorkSummary {
  messageCount: number;
  userPrompts: number;
  assistantResponses: number;
  toolCalls: number;
  filesCreated: string[];
  filesModified: string[];
  duration: number;
  summary: string;
  // Heuristic detections (added in v2.25)
  detectedDecisions?: IDetectedDecision[];
  detectedErrors?: IDetectedError[];
  filePromptCorrelations?: IFilePromptCorrelation[];
  detectedTaskType?: TaskType;
}
```

### Heuristic Detectors

The `parseTranscript()` method runs four heuristic detectors on the parsed messages:

1. **Decision Detection** - Scans for user confirmation patterns (yes, ok, sounds good, etc.) preceded by assistant messages presenting options or recommendations
2. **Error Detection** - Identifies stack traces, Error: patterns, tool failures (`is_error: true`), and retry patterns (same tool called >2 times consecutively)
3. **File-Prompt Correlation** - Links changed files to triggering user prompts within a 3-message window
4. **Task Type Detection** - Scores user prompts against keyword signals to classify session type (planning, bugfix, feature, refactor, etc.)

### LLM Enrichment (Optional)

When an `ITranscriptEnricher` is injected, `captureSessionWork()` additionally:

1. Sends a transcript snippet to the LLM for structured fact extraction
2. Extracts typed facts (`decision`, `learning`, `blocker`, `task`, `preference`, `convention`, `gotcha`)
3. Uses LLM-generated session summary when available (falls back to pattern-extracted summary)
4. Tags LLM-extracted facts with `source:llm-extracted`

## Session Capture Flow

```text
Claude Code Stop Hook
        |
        v
+---------------------+
|  ISessionStopInput  |
|  - session_id       |
|  - transcript_path  |  (optional explicit path)
|  - cwd              |
+---------------------+
        |
        v
+---------------------+
|  SessionStopHandler |
|  - Resolves request |
|  - Calls capture    |
|  - Adds quality tags|
+---------------------+
        |
        v
+-----------------------------+
|  SessionCaptureService      |
|  1. findTranscript()        |
|  2. parseTranscript()       |
|     - message counting      |
|     - file operation extract |
|     - heuristic detectors   |
|  3. hasSignificantWork()    |
|  4. buildFacts()            |
|     - session summary fact  |
|     - DECISION: facts       |
|     - ERROR: facts          |
|     - FILE-CONTEXT: facts   |
|  5. rateComplexity()        |
|  6. (optional) LLM enrich  |
+-----------------------------+
        |
        v
+---------------------+
|  ICapturedWork      |
|  - facts: string[]  |
|  - complexity       |
|  - summary          |
|  - work: IWorkSummary (heuristic metadata)
+---------------------+
        |
        v
    Memory Storage
    (with quality tags: source:session-capture,
     confidence:medium, taskType:<type>)
```

## Filtering and Thresholds

### Minimum Work Threshold

```typescript
const MIN_MESSAGES_FOR_CAPTURE = 3;

hasSignificantWork(work: IWorkSummary): boolean {
  if (work.messageCount < MIN_MESSAGES_FOR_CAPTURE) return false;
  if (work.userPrompts < 1 || work.assistantResponses < 1) return false;
  if (work.filesCreated.length > 0 || work.filesModified.length > 0) return true;
  if (work.toolCalls > 2) return true;
  return work.messageCount >= 5;
}
```

### Complexity Rating

```typescript
rateComplexity(work: IWorkSummary): 'low' | 'medium' | 'high' {
  const totalFiles = work.filesCreated.length + work.filesModified.length;
  if (totalFiles > 5 || work.toolCalls > 20 || work.messageCount > 50) return 'high';
  if (totalFiles > 0 || work.toolCalls > 5 || work.messageCount > 15) return 'medium';
  return 'low';
}
```

## Key Files

| File Path | Purpose |
|-----------|---------|
| `src/lib/infrastructure/services/SessionCaptureService.ts` | Transcript discovery, parsing, heuristic detectors |
| `src/lib/domain/interfaces/ISessionCaptureService.ts` | Service interface |
| `src/lib/domain/interfaces/IWorkSummary.ts` | IWorkSummary, IDetectedDecision, IDetectedError, IFilePromptCorrelation |
| `src/lib/domain/interfaces/types/ICapturedWork.ts` | Output types (includes `work` field) |
| `src/lib/domain/interfaces/ITranscriptEnricher.ts` | LLM enrichment interface |
| `src/lib/application/handlers/SessionStopHandler.ts` | Orchestrates capture with quality tags |
| `src/lib/commands/hooks.ts` | CLI hook command registration |
| `src/lib/commands/doctor.ts` | Transcript discovery display |

## Best Practices

1. **Let Claude Code provide transcript path** - More reliable than searching
2. **Handle missing transcripts gracefully** - Don't fail the hook
3. **Filter insignificant sessions** - Avoid cluttering memory with trivial interactions
4. **Deduplicate file lists** - Same file may appear multiple times in transcript
5. **Truncate long summaries** - Keep facts concise (200 char limit)
6. **Quality tags** - All session-captured facts include `source:session-capture` and `confidence:medium` tags
