---
name: tasks
description: "Create, load, or summarize tasks via Graphiti MCP; triggers on 'tasks', 'list tasks', 'add task', usable by any model (Codex, Claude, Gemini)."
---

## Purpose
Model-neutral helper to add/list tasks in Graphiti MCP so any agent can keep a shared task board.

## Triggers
Use when the user says: "add a task", "list tasks", "load tasks", "task status".

## How to use
1) List: `scripts/tasks.js list --cache [--group <id>] [--limit 20]`
2) Add: `scripts/tasks.js add "<task text>" [--status todo|doing|done] [--tag foo] [--group <id>] --cache`
3) Defaults: reads ${GRAPHITI_ENDPOINT} / ${GRAPHITI_GROUP_ID} from `.agents/skills/.env` (written by init); see root `AGENTS.md` for canonical defaults.
4) Cache fallback: writes/reads `cache/tasks.log` when `--cache` is passed, returning last cached result on MCP failure.
5) Keep prompts model-neutral; models only orchestrate script calls and summarize JSON output.

## I/O contract (examples)
- List: `{ status: "ok", action: "list", tasks: [...] }`
- Add: `{ status: "ok", action: "add", task: { text, status, group } }`
- Fallback: `{ status: "fallback", error, fallback: <cached object> }`

## Worked Examples

### Example 1: List All Tasks

**User request:**
> "Show me all tasks for this project"

**Command:**
```bash
node .agents/skills/tasks/scripts/tasks.js list --cache --group my-project --limit 20
```

**Output:**
```json
{
  "status": "ok",
  "action": "list",
  "group": "my-project",
  "tasks": [
    {
      "id": "task-001",
      "text": "Implement user authentication API",
      "status": "doing",
      "tags": ["backend", "api"],
      "created_at": "2026-01-07T10:00:00Z"
    },
    {
      "id": "task-002",
      "text": "Write tests for login endpoint",
      "status": "todo",
      "tags": ["backend", "testing"],
      "created_at": "2026-01-07T11:30:00Z"
    },
    {
      "id": "task-003",
      "text": "Design database schema for users",
      "status": "done",
      "tags": ["database", "design"],
      "created_at": "2026-01-06T14:00:00Z"
    }
  ]
}
```

**AI Response to User:**
> "Here are the 3 tasks for my-project:
>
> **In Progress (doing):**
> - [task-001] Implement user authentication API (tags: backend, api)
>
> **To Do (todo):**
> - [task-002] Write tests for login endpoint (tags: backend, testing)
>
> **Done:**
> - [task-003] Design database schema for users (tags: database, design)"

---

### Example 2: Add a New Task

**User request:**
> "Add a task: Deploy to production server"

**Command:**
```bash
node .agents/skills/tasks/scripts/tasks.js add "Deploy to production server" --status todo --tag deployment --tag devops --group my-project --cache
```

**Output:**
```json
{
  "status": "ok",
  "action": "add",
  "task": {
    "id": "task-004",
    "text": "Deploy to production server",
    "status": "todo",
    "tags": ["deployment", "devops"],
    "group": "my-project",
    "created_at": "2026-01-08T18:00:00Z"
  }
}
```

**AI Response to User:**
> "✅ Task added: [task-004] Deploy to production server
> - Status: todo
> - Tags: deployment, devops
> - Group: my-project"

---

### Example 3: Add Task with "doing" Status

**User request:**
> "I'm starting work on refactoring the payment service"

**Command:**
```bash
node .agents/skills/tasks/scripts/tasks.js add "Refactor payment service for better error handling" --status doing --tag refactor --tag backend --group my-project --cache
```

**Output:**
```json
{
  "status": "ok",
  "action": "add",
  "task": {
    "id": "task-005",
    "text": "Refactor payment service for better error handling",
    "status": "doing",
    "tags": ["refactor", "backend"],
    "group": "my-project"
  }
}
```

**AI Response to User:**
> "✅ Task created and marked as IN PROGRESS:
> [task-005] Refactor payment service for better error handling"

---

### Example 4: List Tasks by Status

**User request:**
> "What tasks are currently in progress?"

**Command (filter in AI logic after receiving all tasks):**
```bash
node .agents/skills/tasks/scripts/tasks.js list --cache --group my-project
```

**Output:**
```json
{
  "status": "ok",
  "action": "list",
  "tasks": [
    {
      "id": "task-001",
      "text": "Implement user authentication API",
      "status": "doing"
    },
    {
      "id": "task-005",
      "text": "Refactor payment service for better error handling",
      "status": "doing"
    },
    {
      "id": "task-002",
      "text": "Write tests for login endpoint",
      "status": "todo"
    }
  ]
}
```

**AI filters and responds:**
> "Currently in progress (doing):
> 1. [task-001] Implement user authentication API
> 2. [task-005] Refactor payment service for better error handling"

---

### Example 5: Fallback When MCP is Down

**User request:**
> "List all tasks"

**Command:**
```bash
node .agents/skills/tasks/scripts/tasks.js list --cache --group my-project
```

**Output (when Graphiti MCP is offline):**
```json
{
  "status": "fallback",
  "error": "fetch failed",
  "fallback": {
    "ts": "2026-01-08T17:30:00.000Z",
    "status": "ok",
    "action": "list",
    "tasks": [
      {
        "id": "task-001",
        "text": "Implement user authentication API",
        "status": "doing"
      },
      {
        "id": "task-002",
        "text": "Write tests for login endpoint",
        "status": "todo"
      }
    ]
  }
}
```

**AI Response to User:**
> "⚠️ Using cached tasks (Graphiti MCP is offline). Last updated: 2026-01-08 5:30 PM
>
> Cached tasks:
> - [task-001] Implement user authentication API (doing)
> - [task-002] Write tests for login endpoint (todo)"

---

### Example 6: Multi-Group Task Management

**User request:**
> "Add a task for the frontend team to update the dashboard"

**Command:**
```bash
node .agents/skills/tasks/scripts/tasks.js add "Update dashboard with new charts" --status todo --tag frontend --tag ui --group frontend-team --cache
```

**Output:**
```json
{
  "status": "ok",
  "action": "add",
  "task": {
    "id": "task-frontend-001",
    "text": "Update dashboard with new charts",
    "status": "todo",
    "tags": ["frontend", "ui"],
    "group": "frontend-team"
  }
}
```

**AI Response to User:**
> "✅ Task added to frontend-team:
> [task-frontend-001] Update dashboard with new charts (todo)"

---

### Example 7: Mark Task as Done

**User request:**
> "Mark the authentication API task as completed"

**Command:**
```bash
node .agents/skills/tasks/scripts/tasks.js add "Implement user authentication API - COMPLETED" --status done --tag backend --tag api --group my-project --cache
```

**Note:** This creates a new task entry. For updating existing tasks, you would need to implement an `update` command or use Graphiti MCP's update functionality directly.

**Output:**
```json
{
  "status": "ok",
  "action": "add",
  "task": {
    "text": "Implement user authentication API - COMPLETED",
    "status": "done",
    "group": "my-project"
  }
}
```

**AI Response to User:**
> "✅ Marked as done: Implement user authentication API"

---

## Cross-model checklist
- Codex: ensure trigger phrases hit; adjust description if not auto-loaded.
- Claude: concise instructions; avoid role tokens; keep outputs small.
- Gemini: explicit commands and minimal formatting.

## Notes
- Node.js script expects fetch (Node ≥18). Use `node --experimental-fetch` on older runtimes.
- Tasks are stored via Graphiti MCP `add_task`/`list_tasks` (tool names referenced in script). Adjust if server differs.
- Folder `.agents/skills/tasks/` keeps this decoupled from `.codex/`.
