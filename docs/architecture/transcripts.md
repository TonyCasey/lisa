# Transcript Resolution

Lisa captures session work by parsing Claude Code transcripts. This document describes how transcripts are discovered, parsed, and used for memory capture.

## Transcript Discovery

### Search Algorithm

Transcript discovery uses a **deterministic resolution algorithm**:

1. **Explicit Path** - If provided and exists, use directly
2. **Standard Locations** - Search Claude Code transcript directories
3. **Selection** - Choose newest candidate by modification time

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

```text
~/.claude/projects/<project>/transcript.jsonl  (primary)
~/.claude/transcript.jsonl                     (fallback)
```

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
    content?: string | Array<{ type: string; text?: string }>;
  };
  summary?: string;                 // File operation summaries
}
```

### Example Transcript Lines

```json
{"type":"user","message":{"role":"user","content":"Fix the login bug"}}
{"type":"assistant","message":{"role":"assistant","content":"I'll look into that..."}}
{"type":"tool_use","tool":"read_file","input":{"path":"auth.ts"}}
{"type":"tool_result","content":"...file contents...","summary":"Read auth.ts"}
{"type":"tool_use","tool":"write_file","summary":"Modified auth.ts"}
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
}
```

### Parsing Logic

```typescript
parseTranscript(transcriptPath: string): IWorkSummary {
  const lines = content.trim().split('\n').filter(line => line.trim());
  
  for (const line of lines) {
    const msg: ITranscriptMessage = JSON.parse(line);
    
    // Count message types
    if (msg.type === 'user' || msg.message?.role === 'user') {
      userPrompts++;
    } else if (msg.type === 'assistant' || msg.message?.role === 'assistant') {
      assistantResponses++;
    } else if (msg.type === 'tool_use' || msg.type === 'tool_result') {
      toolCalls++;
    }
    
    // Extract file operations from summary field
    if (msg.summary) {
      // Patterns: "Created", "Wrote", "Modified", "Edited"
    }
  }
  
  return { messageCount, userPrompts, assistantResponses, toolCalls, ... };
}
```

## Session Capture Flow

```text
Claude Code Stop Hook
        │
        ▼
┌─────────────────────┐
│  ISessionStopInput  │
│  - session_id       │
│  - transcript_path  │  (optional explicit path)
│  - cwd              │
└─────────────────────┘
        │
        ▼
┌─────────────────────┐
│  SessionStopHandler │
│  - Resolves request │
│  - Calls capture    │
└─────────────────────┘
        │
        ▼
┌─────────────────────────────┐
│  SessionCaptureService      │
│  1. findTranscript()        │
│  2. parseTranscript()       │
│  3. hasSignificantWork()    │
│  4. buildFacts()            │
│  5. rateComplexity()        │
└─────────────────────────────┘
        │
        ▼
┌─────────────────────┐
│  ICapturedWork      │
│  - facts: string[]  │
│  - complexity       │
│  - summary          │
└─────────────────────┘
        │
        ▼
    Memory Storage
```

## Filtering and Thresholds

### Minimum Work Threshold

```typescript
const MIN_MESSAGES_FOR_CAPTURE = 3;

hasSignificantWork(work: IWorkSummary): boolean {
  // Need minimum messages
  if (work.messageCount < MIN_MESSAGES_FOR_CAPTURE) {
    return false;
  }
  
  // Need actual interaction
  if (work.userPrompts < 1 || work.assistantResponses < 1) {
    return false;
  }
  
  // File changes indicate real work
  if (work.filesCreated.length > 0 || work.filesModified.length > 0) {
    return true;
  }
  
  // Tool usage indicates real work
  if (work.toolCalls > 2) {
    return true;
  }
  
  // Basic threshold
  return work.messageCount >= 5;
}
```

### Complexity Rating

```typescript
rateComplexity(work: IWorkSummary): 'low' | 'medium' | 'high' {
  const totalFiles = work.filesCreated.length + work.filesModified.length;
  
  // High: many files or extensive activity
  if (totalFiles > 5 || work.toolCalls > 20 || work.messageCount > 50) {
    return 'high';
  }
  
  // Medium: some file changes or moderate activity
  if (totalFiles > 0 || work.toolCalls > 5 || work.messageCount > 15) {
    return 'medium';
  }
  
  return 'low';
}
```

## Doctor Command - Transcript Discovery Display

The `lisa doctor --verbose` command shows transcript discovery details:

```text
Transcript Discovery
  Search Paths:
    ✓ ~/.claude/projects
    - ~/.claude
    
  Found 2 transcript(s):
    → /home/user/.claude/projects/myproject/transcript.jsonl
      Modified: 2026-01-23 10:30:45, Size: 125KB
      /home/user/.claude/transcript.jsonl
      Modified: 2026-01-22 15:20:00, Size: 89KB
```

## Key Files

| File Path | Purpose |
|-----------|---------|
| `src/lib/infrastructure/services/SessionCaptureService.ts` | Main transcript parsing |
| `src/lib/domain/interfaces/ISessionCaptureService.ts` | Service interface |
| `src/lib/domain/interfaces/types/ICapturedWork.ts` | Output types |
| `src/lib/application/handlers/SessionStopHandler.ts` | Orchestrates capture |
| `src/lib/application/mediator/requests/SessionStopRequest.ts` | Request with transcript path |
| `src/lib/infrastructure/cli/io.ts` | Input interfaces |
| `src/lib/commands/doctor.ts` | Transcript discovery display |

## Best Practices

1. **Let Claude Code provide transcript path** - More reliable than searching
2. **Handle missing transcripts gracefully** - Don't fail the hook
3. **Filter insignificant sessions** - Avoid cluttering memory with trivial interactions
4. **Deduplicate file lists** - Same file may appear multiple times in transcript
5. **Truncate long summaries** - Keep facts concise (200 char limit)
