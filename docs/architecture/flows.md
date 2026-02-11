# Lisa Architecture Flows

This document describes the key data flows in the Lisa memory system.

## Table of Contents

- [Session Start Flow](#session-start-flow)
- [Session Stop Flow](#session-stop-flow)
- [Memory Skill Flow](#memory-skill-flow)
- [Tasks Skill Flow](#tasks-skill-flow)
- [DI Container Bootstrap](#di-container-bootstrap)
- [Memory Storage](#memory-storage)

---

## Session Start Flow

The session-start hook runs when Claude Code starts, resumes, compacts, or clears a session. It loads memory context to provide continuity across sessions.

### Sequence Diagram

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant Hook as session-start.ts
    participant DI as DI Container
    participant Med as Mediator
    participant SSH as SessionStartHandler
    participant MCL as MemoryContextLoader
    participant GTS as GitTriageService
    participant GMS as GitMemMemoryService
    participant GM as git-mem
    participant GN as Git Notes

    CC->>Hook: stdin: {trigger: "startup"|"resume"|"compact"|"clear"}
    Hook->>DI: bootstrapContainer()
    DI-->>Hook: container, dispose()

    Hook->>Med: send(SessionStartRequest)
    Med->>SSH: handle(request)

    par Load Memory & Git Triage
        SSH->>MCL: loadMemory(groupIds, aliases, branch, dateOptions)
        MCL->>GMS: searchFacts(groupIds, "init-review")
        GMS->>GM: recall(query)
        GM->>GN: git notes --ref=mem list
        GN-->>GM: notes data
        GM-->>GMS: memories[]
        GMS-->>MCL: init-review fact

        MCL->>GMS: loadFactsDateOrdered(groupIds, limit, dateOptions)
        GMS->>GM: recall(undefined, {limit})
        GM->>GN: git notes --ref=mem list
        GN-->>GM: notes data
        GM-->>GMS: memories[]
        GMS-->>MCL: facts[]

        MCL-->>SSH: {facts, tasks, initReview, timedOut}
    and
        SSH->>GTS: triage({since, cwd})
        GTS-->>SSH: {totalCommits, highInterest[], hotspots[]}
    end

    SSH->>SSH: processTasks(memories.tasks)
    SSH->>SSH: formatContextContent()
    SSH-->>Med: ISessionStartResult
    Med-->>Hook: result

    Hook->>CC: stdout: contextContent (system-reminder)
    Hook->>CC: stderr: [Memory loaded: N memories, M tasks]
```

### Trigger Types

| Trigger | When | Date Range |
|---------|------|------------|
| `startup` | Initial session start | Since midnight today |
| `resume` | Resuming paused session | Last 24 hours |
| `compact` | After auto-compaction | Last 24 hours |
| `clear` | After /clear command | Last 24 hours |

### What Gets Loaded

1. **Init Review** - Project overview from first session
2. **Facts** - Memories filtered by group and date range
3. **Tasks** - Active tasks with status
4. **Git Triage** - Recent commit analysis with interest scoring
5. **Hotspots** - Frequently modified files

### Key Files

| File | Role |
|------|------|
| `infrastructure/adapters/claude/session-start.ts` | Entry point (Claude hook) |
| `application/handlers/SessionStartHandler.ts` | Orchestrates loading |
| `application/services/MemoryContextLoader.ts` | Memory + task loading |
| `application/services/GitTriageService.ts` | Commit analysis |
| `application/services/SessionContextFormatter.ts` | Output formatting |
| `infrastructure/services/GitMemMemoryService.ts` | git-mem adapter |

---

## Session Stop Flow

The session-stop hook runs when Claude stops responding. It analyzes the session transcript and captures significant work as memories.

### Sequence Diagram

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant Hook as session-stop.ts
    participant DI as DI Container
    participant Med as Mediator
    participant SSH as SessionStopHandler
    participant SCS as SessionCaptureService
    participant FS as File System
    participant GMS as GitMemMemoryService
    participant GM as git-mem
    participant GN as Git Notes

    CC->>Hook: (Claude stops responding)
    Hook->>DI: bootstrapContainer()
    DI-->>Hook: container, dispose()

    Hook->>Med: send(SessionStopRequest)
    Med->>SSH: handle(request)

    SSH->>SCS: captureSessionWork(sessionId, transcriptPath)

    SCS->>SCS: findTranscript()
    Note over SCS: ~/.claude/projects/<project>/<uuid>.jsonl

    SCS->>FS: readFileSync(transcriptPath)
    FS-->>SCS: JSONL content

    SCS->>SCS: parseTranscript()
    Note over SCS: Extract: prompts, responses,<br/>tool calls, files changed

    SCS->>SCS: detectDecisions()
    Note over SCS: User confirms after<br/>assistant presents options

    SCS->>SCS: detectErrors()
    Note over SCS: Stack traces, tool failures,<br/>retry patterns

    SCS->>SCS: correlateFilePrompts()
    Note over SCS: Link file changes to<br/>triggering user prompts

    SCS->>SCS: hasSignificantWork()
    SCS->>SCS: buildFacts()
    SCS-->>SSH: {facts[], complexity, summary, work}

    loop For each captured fact
        SSH->>GMS: addFactWithLifecycle(groupId, fact, options)
        GMS->>GM: remember(fact, {tags, lifecycle, confidence})
        GM->>GN: git notes --ref=mem add -m <JSON>
        GN-->>GM: note added
        GM-->>GMS: success
    end

    SSH-->>Med: ISessionStopResult
    Med-->>Hook: result

    Hook->>CC: stderr: [Session captured: N facts]
```

### What Gets Captured

| Detection | Method | Example |
|-----------|--------|---------|
| **Session stats** | Message counting | "5 prompts, 8 responses, 12 tool calls" |
| **File changes** | Summary parsing | "Created: foo.ts. Modified: index.ts" |
| **Decisions** | Confirmation pattern matching | "DECISION: Use PostgreSQL for JSON support" |
| **Errors** | Stack trace / error type detection | "ERROR: TypeError: Cannot read 'x' of undefined" |
| **File correlations** | User prompt to file change mapping | "FILE-CONTEXT: auth.ts - triggered by: add validation" |

### Detection Patterns

**Decisions**: User message matches confirmation pattern (`yes`, `ok`, `sounds good`, etc.) preceded by assistant presenting options.

**Errors**:
- Stack traces (`at <function>`)
- Error types (`TypeError:`, `ReferenceError:`, etc.)
- Tool failures (`is_error: true`)
- Retry patterns (same tool called 3+ times consecutively)

### Significance Threshold

A session is captured if:
- At least 3 messages
- At least 1 user prompt and 1 assistant response
- AND one of:
  - Files created or modified
  - More than 2 tool calls
  - More than 5 total messages

### Tags Applied

```
type:session-capture
source:session-capture
confidence:medium
lifecycle:session
taskType:<detected-type>  (if detected)
```

### Key Files

| File | Role |
|------|------|
| `infrastructure/adapters/claude/session-stop.ts` | Entry point (Claude hook) |
| `application/handlers/SessionStopHandler.ts` | Orchestrates capture + save |
| `infrastructure/services/SessionCaptureService.ts` | Transcript parsing + fact extraction |
| `infrastructure/services/GitMemMemoryService.ts` | git-mem adapter |

---

## Memory Skill Flow

The `/memory` skill provides CLI access to add and load memories. Used by Claude Code via skill invocation.

### Sequence Diagram

```mermaid
sequenceDiagram
    participant User as User/Claude
    participant CLI as memory.ts
    participant Svc as MemoryCliService
    participant MS as MemoryService
    participant GM as git-mem
    participant GN as Git Notes

    User->>CLI: lisa memory add "fact" --tag decision
    CLI->>CLI: parseArgs()
    CLI->>CLI: createGitMem()
    CLI->>Svc: run({command: "add", payload, tag, ...})

    alt add command
        Svc->>Svc: resolveTag(payload, explicitTag)
        Svc->>MS: addFact(groupId, text, tags)
        MS->>GM: remember(text, {tags})
        GM->>GN: git notes --ref=mem add -m <JSON>
        GN-->>GM: note added
        GM-->>MS: success
        MS-->>Svc: void
        Svc-->>CLI: {status: "ok", action: "add", text, tag, group}
    else load command
        Svc->>MS: loadFacts(groupId, limit, dateOptions)
        MS->>GM: recall(query, {limit})
        GM->>GN: git notes --ref=mem list
        GN-->>GM: notes data
        GM-->>MS: memories[]
        MS-->>Svc: facts[]
        Svc-->>CLI: {status: "ok", action: "load", facts, group}
    end

    CLI->>User: JSON output
```

### Commands

| Command | Description | Example |
|---------|-------------|---------|
| `add` | Store a new memory | `lisa memory add "DECISION: Use PostgreSQL" --tag decision` |
| `load` | Retrieve memories | `lisa memory load --limit 20 --since today` |
| `expire` | Remove a specific memory | `lisa memory expire --uuid abc123` |
| `cleanup` | Remove expired memories | `lisa memory cleanup --dry-run` |

### Auto-Tag Detection

The memory service automatically detects tags from content prefixes:

| Prefix | Auto-Tag |
|--------|----------|
| `DECISION:` | `code:decision` |
| `BUG:` | `context:bug` |
| `GOTCHA:` | `context:gotcha` |
| `CONVENTION:` | `code:convention` |
| `MILESTONE:` | `milestone` |

### Key Files

| File | Role |
|------|------|
| `skills/memory/memory.ts` | CLI entry point |
| `skills/shared/services/MemoryCliService.ts` | Command routing |
| `skills/shared/services/MemoryService.ts` | Business logic |
| `skills/shared/clients/GitMemFactory.ts` | git-mem instance factory |

---

## Tasks Skill Flow

The `/tasks` skill provides CLI access to manage tasks. Tasks are stored as memories with the `task` tag.

### Sequence Diagram

```mermaid
sequenceDiagram
    participant User as User/Claude
    participant CLI as tasks.ts
    participant Svc as TaskCliService
    participant TS as TaskService
    participant GM as git-mem
    participant GN as Git Notes

    User->>CLI: lisa tasks add "Implement feature" --status todo
    CLI->>CLI: parseArgs()
    CLI->>CLI: createGitMem()
    CLI->>Svc: run({command: "add", payload, status, ...})

    alt add command
        Svc->>TS: addTask(groupId, title, status, options)
        TS->>TS: buildTaskContent(title, status, ...)
        TS->>GM: remember(JSON.stringify(task), {tags: ["task", "group:...", "status:todo"]})
        GM->>GN: git notes --ref=mem add -m <JSON>
        GN-->>GM: note added
        GM-->>TS: success
        TS-->>Svc: task object
        Svc-->>CLI: {status: "ok", action: "add", task, group}
    else list command
        Svc->>TS: getTasks(groupIds, limit, options)
        TS->>GM: recall(undefined, {limit})
        GM->>GN: git notes --ref=mem list
        GN-->>GM: notes data
        TS->>TS: filterByTag("task")
        TS->>TS: parseTaskContent()
        TS-->>Svc: tasks[]
        Svc-->>CLI: {status: "ok", action: "list", tasks, group}
    else update command
        Svc->>TS: updateTask(groupId, title, newStatus)
        TS->>GM: recall(title)
        GM-->>TS: existing task
        TS->>GM: delete(existingId)
        TS->>GM: remember(updatedTask, {tags})
        GM-->>TS: success
        TS-->>Svc: updated task
        Svc-->>CLI: {status: "ok", action: "update", task, group}
    end

    CLI->>User: JSON output
```

### Commands

| Command | Description | Example |
|---------|-------------|---------|
| `add` | Create a new task | `lisa tasks add "Fix login bug" --status todo` |
| `list` | List tasks | `lisa tasks list --limit 10 --since 7d` |
| `update` | Update task status | `lisa tasks update "Fix login bug" --status done` |
| `link` | Link to external issue | `lisa tasks link abc123 --link github#42` |

### Task Status Flow

```
todo → doing → done
        ↓
     blocked
```

### Task Storage Format

Tasks are stored as JSON in git-mem with special tags:

```json
{
  "title": "Implement user authentication",
  "status": "doing",
  "repo": "lisa",
  "assignee": "tony",
  "created_at": "2024-01-15T10:30:00Z"
}
```

Tags: `task`, `group:<id>`, `status:<status>`, `task_id:<uuid>`

### Key Files

| File | Role |
|------|------|
| `skills/tasks/tasks.ts` | CLI entry point |
| `skills/shared/services/TaskCliService.ts` | Command routing |
| `skills/shared/services/TaskService.ts` | Business logic |
| `skills/shared/clients/GitMemFactory.ts` | git-mem instance factory |

---

## DI Container Bootstrap

The DI (Dependency Injection) container wires up all services for hooks and infrastructure code.

### Sequence Diagram

```mermaid
sequenceDiagram
    participant Hook as Hook/Adapter
    participant Boot as bootstrap.ts
    participant Cont as Container
    participant GMF as GitMemFactory
    participant GM as git-mem
    participant Svcs as Services

    Hook->>Boot: bootstrapContainer({projectRoot, ...})

    Boot->>Boot: createLisaContext(projectRoot)
    Note over Boot: Resolves groupIds, aliases,<br/>branch, project metadata

    Boot->>Cont: new Container()

    Boot->>Cont: register(TOKENS.Context, context)
    Boot->>Cont: register(TOKENS.Logger, logger)

    Boot->>GMF: createGitMem()
    GMF->>GM: new GitMem({cwd})
    GM-->>GMF: gitMem instance
    GMF-->>Boot: gitMem

    Boot->>Cont: register(TOKENS.GitMem, gitMem)

    Boot->>Svcs: new GitMemMemoryService(gitMem)
    Boot->>Cont: register(TOKENS.MemoryService, memoryService)

    Boot->>Svcs: new GitMemTaskService(gitMem)
    Boot->>Cont: register(TOKENS.TaskService, taskService)

    Boot->>Svcs: new SessionCaptureService(logger)
    Boot->>Cont: register(TOKENS.SessionCapture, captureService)

    Boot->>Svcs: new EventEmitter()
    Boot->>Cont: register(TOKENS.Events, events)

    Boot->>Boot: registerHandlers(container)
    Note over Boot: SessionStartHandler,<br/>SessionStopHandler

    Boot->>Boot: registerMediator(container)

    Boot-->>Hook: {container, dispose()}
```

### Token Registry

| Token | Service | Description |
|-------|---------|-------------|
| `TOKENS.Context` | `ILisaContext` | Project metadata, group IDs |
| `TOKENS.Logger` | `ILogger` | Logging service |
| `TOKENS.GitMem` | `GitMem` | git-mem library instance |
| `TOKENS.MemoryService` | `GitMemMemoryService` | Memory operations |
| `TOKENS.TaskService` | `GitMemTaskService` | Task operations |
| `TOKENS.SessionCapture` | `SessionCaptureService` | Transcript analysis |
| `TOKENS.Events` | `IEventEmitter` | Internal event bus |
| `TOKENS.Mediator` | `IMediator` | Request/handler dispatch |

### Dispose Pattern

The `dispose()` function returned by bootstrap cleans up resources:

```typescript
const { container, dispose } = await bootstrapContainer(options);
try {
  // Use container...
} finally {
  await dispose(); // Clean up connections
}
```

### Key Files

| File | Role |
|------|------|
| `infrastructure/di/bootstrap.ts` | Container setup |
| `infrastructure/di/tokens.ts` | DI token definitions |
| `infrastructure/di/Container.ts` | IoC container implementation |

---

## Memory Storage

All memories are stored in git notes at `refs/notes/mem`.

### Storage Format

```json
{
  "id": "uuid",
  "content": "The memory text",
  "tags": ["group:project-name", "type:decision", "confidence:high"],
  "createdAt": "2024-01-15T10:30:00Z",
  "lifecycle": "project",
  "confidence": "high"
}
```

### Tag Conventions

| Tag Pattern | Purpose | Examples |
|-------------|---------|----------|
| `group:<id>` | Isolate by project/context | `group:lisa`, `group:users-tony-repos-lisa` |
| `type:<name>` | Memory category | `type:decision`, `type:milestone`, `type:session-capture` |
| `status:<status>` | Task status | `status:todo`, `status:doing`, `status:done` |
| `lifecycle:<tier>` | Retention tier | `lifecycle:permanent`, `lifecycle:project`, `lifecycle:session` |
| `confidence:<level>` | Trust level | `confidence:verified`, `confidence:high`, `confidence:medium` |
| `source:<origin>` | How it was created | `source:user`, `source:session-capture`, `source:llm-extracted` |
| `task` | Marks task entries | `task` |

### CLI Access

```bash
# View all notes
git notes --ref=mem list

# View specific note
git notes --ref=mem show <commit-sha>

# Search via git-mem CLI
git mem recall "search query"

# Add via git-mem CLI
git mem remember "fact text" --tags "type:decision"
```

---

## See Also

- [git-mem Library](https://github.com/TonyCasey/git-mem)
- [CLAUDE.md](../../CLAUDE.md) - Project overview and development workflow
