# Agent Skills & Memory

## Local skills (model-neutral)
- `memory` skill at `.agents/skills/memory`: routes remember/recall/load to Graphiti MCP via `scripts/memory.js`, with cache fallback.
- `tasks` skill at `.agents/skills/tasks`: add/list tasks via Graphiti MCP using `scripts/tasks.js`, with cache fallback.

## Defaults
- Endpoint: `GRAPHITI_ENDPOINT` env or `http://localhost:8010/mcp/`
- Group: `GRAPHITI_GROUP_ID` env or `agent-memories`

## Cross-model intent
- Instructions and scripts are model-neutral (Codex, Claude, Gemini); logic lives in scripts; prompts avoid role tokens.
