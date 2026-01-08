---
name: memory
description: "Load or remember project memory via Graphiti MCP; triggers on 'load memory', 'recall', or 'remember', usable by any model (Codex, Claude, Gemini)."
---

## Purpose
Reusable memory helper that routes remember/recall requests to Graphiti MCP while staying model-neutral and providing cache fallback.

## Triggers
Use when the user says things like: "load memory", "recall notes", "remember", "pull saved context", "fetch past tasks".

## How to use
1) For recall: run `scripts/memory.js load --cache [--query <q>] [--limit 10] [--group <id>]`. Reads Graphiti facts and prints JSON. Uses cache if MCP is down.
2) For remember: run `scripts/memory.js add "<text>" --cache [--group <id>] [--tag foo] [--source <src>]` to append an episode.
3) Endpoint/group: reads ${GRAPHITI_ENDPOINT} / ${GRAPHITI_GROUP_ID} from `.agents/skills/.env` (written by init); see root `AGENTS.md` for canonical defaults.
4) Cache fallback: stored at `cache/memory.log` inside this skill. On failure, last cached result is returned with `status: "fallback"`.
5) Keep prompts model-neutral; avoid role tokens. Models just orchestrate the script and summarize results to the user.

## I/O contract (examples)
- Recall: output JSON `{ status: "ok", action: "load", group, query, facts: [...] }`.
- Remember: JSON `{ status: "ok", action: "add", group, text }`.
- Fallback: JSON `{ status: "fallback", error, fallback: <last cached object> }`.

 ## Worked Examples

### Example 1: Load All Memory

**User request:**
> "Load memory for this project"

**Command:**
```bash
node .agents/skills/memory/scripts/memory.js load --cache --group my-project
```

**Output:**
```json
{
  "status": "ok",
  "action": "load",
  "group": "my-project",
  "query": "",
  "facts": [
    {
      "uuid": "095d5d7a-8007-485b-b3e2-c504789c17f1",
      "group_id": "my-project",
      "name": "USES",
      "fact": "The agent-memory CLI utilizes a Docker stack for Neo4j and Graphiti MCP.",
      "source_node_uuid": "7cbfca3c-8f78-4add-9811-7fa00a7a1eff",
      "target_node_uuid": "59f9d0c6-2680-46a4-97bc-87e3d7636147",
      "created_at": "2026-01-07T10:42:37.309210Z"
    },
    {
      "uuid": "f7fd37b6-c531-4336-8663-f019a72c0e09",
      "group_id": "my-project",
      "name": "PART_OF",
      "fact": "The CLI (node/ts) is part of the group my-project.",
      "created_at": "2026-01-07T10:42:58.575669Z"
    }
  ]
}
```

**AI Response to User:**
> "I found 2 facts in memory for my-project:
> 1. The agent-memory CLI uses Docker with Neo4j and Graphiti MCP
> 2. The CLI (node/ts) is part of this project group"

---

### Example 2: Query Specific Memory

**User request:**
> "What do we remember about authentication?"

**Command:**
```bash
node .agents/skills/memory/scripts/memory.js load --cache --query "authentication" --limit 5 --group my-project
```

**Output:**
```json
{
  "status": "ok",
  "action": "load",
  "group": "my-project",
  "query": "authentication",
  "facts": [
    {
      "uuid": "abc-123",
      "fact": "Authentication uses JWT tokens with 1-hour expiry.",
      "name": "DECISION"
    },
    {
      "uuid": "def-456",
      "fact": "OAuth 2.0 integration completed for Google and GitHub.",
      "name": "IMPLEMENTATION"
    }
  ]
}
```

**AI Response to User:**
> "Here's what I found about authentication:
> - Decision: We're using JWT tokens with 1-hour expiry
> - Implementation: OAuth 2.0 is set up for Google and GitHub"

---

### Example 3: Remember New Information

**User request:**
> "Remember that we decided to use PostgreSQL for the production database"

**Command:**
```bash
node .agents/skills/memory/scripts/memory.js add "Decision: Using PostgreSQL for production database due to ACID compliance and better query performance" --cache --group my-project --tag decision --tag database
```

**Output:**
```json
{
  "status": "ok",
  "action": "add",
  "group": "my-project",
  "text": "Decision: Using PostgreSQL for production database due to ACID compliance and better query performance"
}
```

**AI Response to User:**
> "✅ Saved to memory: Decision to use PostgreSQL for production database (tagged: decision, database)"

---

### Example 4: Fallback When MCP is Down

**User request:**
> "Load memory"

**Command:**
```bash
node .agents/skills/memory/scripts/memory.js load --cache --group my-project
```

**Output (when Graphiti MCP is offline):**
```json
{
  "status": "fallback",
  "error": "fetch failed",
  "fallback": {
    "ts": "2026-01-07T10:54:37.553Z",
    "status": "ok",
    "action": "load",
    "facts": [
      {
        "uuid": "095d5d7a-8007-485b-b3e2-c504789c17f1",
        "fact": "The agent-memory CLI utilizes a Docker stack..."
      }
    ]
  }
}
```

**AI Response to User:**
> "⚠️ Using cached memory (Graphiti MCP is offline). Last updated: 2026-01-07 10:54 AM
>
> Found 1 cached fact:
> - The agent-memory CLI utilizes a Docker stack for Neo4j and Graphiti MCP"

---

### Example 5: Multi-Group Projects

**User request:**
> "Load memory for the frontend team"

**Command:**
```bash
node .agents/skills/memory/scripts/memory.js load --cache --group frontend-team
```

**Output:**
```json
{
  "status": "ok",
  "action": "load",
  "group": "frontend-team",
  "query": "",
  "facts": [
    {
      "fact": "React 18 migration completed",
      "name": "MILESTONE"
    },
    {
      "fact": "Using Tailwind CSS for styling",
      "name": "PATTERN"
    }
  ]
}
```

---

## Cross-model checklist
- Codex: verify triggers phrase match and script path works; adjust description if not autoloading.
- Claude: confirm concise trigger phrasing; keep under system limits; avoid markdown-heavy instructions.
- Gemini: ensure commands are explicit; avoid model-specific tokens; keep JSON small.

## Notes
- Script is Node.js; relies on global `fetch` (Node ≥18). If older runtime, `node --experimental-fetch`.
- Facts query defaults to `*` with `max_facts=10`; tune via `--limit` and `--query`.
- Safe to relocate: skill lives in `.agents/skills/memory` to remain decoupled from `.codex` model bindings.
