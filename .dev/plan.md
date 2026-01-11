# Agent-Memory Plan

## Goal
- Ship a reusable TypeScript CLI/npm package (`agent-memory`) that installs Graphiti memory hooks
  across repos, scaffolds `.codex/`, and (optionally) provisions required backing services
  (Neo4j, Graph, graphiti-mcp) via Docker Compose.

## Direction (language/runtime)
- Definitive: TypeScript + npm package (publishes to your registry; ships compiled JS binaries).
  - Pros: easy `npx` bootstrap, single runtime with Docker/Compose orchestration, broad dev
    adoption, npm-friendly distribution of hook scripts/templates.
  - Cons: need Node runtime on target machines; must port existing Python hook logic.
- Plan: port existing Python hooks as references, then remove Python hook files once TS hooks are
  live.

## Deliverables
- npm package `agent-memory` with bin `agent-memory` (alias `remember`).
- Generated `.codex/` folder (if missing) containing:
  - Config with MCP endpoint, group defaults.
  - Hook scripts in TypeScript (compiled to JS on publish) mirroring current Python flows
    (session_start, ticket_load, before_command, after_command, pr_feedback, session_end).
  - Shared tagging/util helpers.
- Docker assets:
  - `docker-compose.graphiti.yml` for Neo4j, Graph service, and graphiti-mcp.
  - `.env.graphiti.example` for container creds/ports/volume paths.
- CLI commands:
  - `agent-memory setup` — scaffold `.codex/` hooks/config (no Docker assets).
  - `agent-memory init` — scaffold hooks + Docker assets.
  - `agent-memory up` / `down` — manage Docker stack.
  - `agent-memory doctor` — validate config/connectivity to MCP and Neo4j.
- Slash command: `/prompts:remember` in Codex shell to trigger memory recall/capture flows.
- Defaults: group falls back to `GRAPHITI_GROUP_ID` or `sample-group`.
- Documentation: README + quickstart; publish instructions for npm registry.

## Work Plan
1) Analyze existing Python hook behavior and data contracts; map to TS equivalents.
2) Define package structure (TS source, bin entry, template assets, compile/publish flow).
3) Implement CLI (init/up/down/doctor) using `commander` + DI-friendly services (template copier, Docker, MCP).
4) Port hook logic to TS templates; ensure HTTP client for MCP (fetch/axios) with session headers.
5) Add templated `.codex/config` and hook files; inject group_id, endpoint, repo/project detection.
6) Implement per-prompt message hook that inspects every user/assistant turn for new directions/
   decisions/requirements and auto-writes `add_memory` (with dedupe and User/repo linking) so
   context isn’t missed across tabs/sessions.
7) Author `docker-compose.graphiti.yml` + `.env.graphiti.example` for Neo4j/Graph/graphiti-mcp
   with sensible defaults and volume mounts.
8) Add tests: unit (CLI options using mocked services), smoke (init scaffold in tmp dir), and optional integration for
   doctor against local stack.
9) Remove legacy Python hooks after TS replacement is verified.
10) Document usage and npm publish steps; versioning and upgrade notes.

## Beads-inspired Enhancements
1) Task graph schema + “ready tasks” query: model `type:task` nodes with `blocks:` / `blocked_by:` / `related:` tags and surface an unblocked/ready list for the current repo.
2) Stable task IDs: generate hash-based IDs for tasks to survive branch merges and dedupe across captures.
3) Compaction/decay: summarize closed tasks after N days into archival summary nodes with backlinks.
4) Graph insights command: run centrality/critical-path metrics and emit JSON for agents to rank work.
5) Offline capture mode: queue memories locally when Neo4j/MCP is unreachable and replay on reconnect.

### Status
- Task capture + lifecycle slash commands: done (`tasks_create`, `tasks_start`, `tasks_done`, `tasks_ready`, `tasks_overview`).

## Open Questions
- Exact container images/tags for Graph and graphiti-mcp; volumes/ports.
- Should hooks stay language-agnostic or emit per-language rule loading?
- Do we ship default rules with the package or rely on existing `.dev/rules`?

---

## Claude Hook TypeScript Template

### Summary
Create a TypeScript source template for Claude Code `UserPromptSubmit` hook that reads prompts from stdin and stores them to Graphiti MCP.

### Key Finding
Claude Code hooks **cannot run TypeScript directly** - they must be compiled to JavaScript first. The project build pipeline (`tsc` + postbuild scripts) handles this.

### Files to Create/Modify

| File | Action |
|------|--------|
| `src/templates/claude/hooks/user-prompt-submit.ts` | Create - TypeScript source template |
| `scripts/deploy-agents.js` | Modify - Add Claude template deployment |

### Build Flow
```
src/templates/claude/hooks/user-prompt-submit.ts
    ↓ (npm run build → tsc)
dist/templates/claude/hooks/user-prompt-submit.js
    ↓ (deploy-agents.js)
.claude/hooks/user-prompt-submit.js
```

### Implementation Steps
1. Create directory `src/templates/claude/hooks/`
2. Create `src/templates/claude/hooks/user-prompt-submit.ts` based on working `.claude/hooks/user-prompt-submit.js`
3. Update `scripts/deploy-agents.js` to copy Claude templates
4. Run `npm run build` to compile and deploy
5. Verify compiled `.js` matches current working hook

### Notes
- TypeScript template becomes "source of truth"
- Future edits go to `.ts` file, then rebuild
- Existing `.claude/hooks/user-prompt-submit.js` will be overwritten by build
