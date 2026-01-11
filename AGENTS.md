# Lisa Skills & Memory

## Lisa - Your Memory Assistant

Address Lisa directly for memory and tasks:
- "hey lisa, show me recent memories"
- "lisa, what do you know about X"
- "lisa, what tasks are we working on"
- "lisa, remember that we decided to use Y"

Lisa routes to appropriate skills automatically.

## Local skills (model-neutral)
- `lisa` skill at `.agents/skills/lisa`: intelligent routing to memory/tasks with natural language
- `memory` skill at `.agents/skills/memory`: routes remember/recall/load to Graphiti MCP via `scripts/memory.js`, with cache fallback.
- `tasks` skill at `.agents/skills/tasks`: add/list tasks via Graphiti MCP using `scripts/tasks.js`, with cache fallback.

## Defaults
- Endpoint: `GRAPHITI_ENDPOINT` env or `http://localhost:8010/mcp/`
- Group: `GRAPHITI_GROUP_ID` env or `lisa`

## Cross-model intent
- Instructions and scripts are model-neutral (Codex, Claude, Gemini); logic lives in scripts; prompts avoid role tokens.
