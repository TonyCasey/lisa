## Memory Skill (cross-model)

- Draft SKILL.md for `load-memory` with model-neutral triggers/behaviors (no model-specific tokens).
- Move Graphiti MCP calls/formatting into scripts so models only orchestrate.
- Define I/O contract: commands like `load`/`remember` with JSON or text payload examples in SKILL.md.
- Add fallback when MCP is unavailable (e.g., read cached file, emit "memory unavailable" notice).
- Create a cross-model test checklist (Codex, Claude, Gemini) to validate triggering and adjust description wording if needed.
