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

## Cross-model checklist
- Codex: verify triggers phrase match and script path works; adjust description if not autoloading.
- Claude: confirm concise trigger phrasing; keep under system limits; avoid markdown-heavy instructions.
- Gemini: ensure commands are explicit; avoid model-specific tokens; keep JSON small.

## Notes
- Script is Node.js; relies on global `fetch` (Node ≥18). If older runtime, `node --experimental-fetch`.
- Facts query defaults to `*` with `max_facts=10`; tune via `--limit` and `--query`.
- Safe to relocate: skill lives in `.agents/skills/memory` to remain decoupled from `.codex` model bindings.
