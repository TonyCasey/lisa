# Skill Loading Note

Codex only auto-discovers skills placed under `.codex/skills` (or `$CODEX_HOME/skills`).

This repo's model-neutral skills live in `.agents/skills/`:
- `.agents/skills/memory` (Graphiti remember/recall)
- `.agents/skills/tasks` (Graphiti task add/list)

To make them discoverable without moving code, either:
- Copy the folders into this directory, or
- Create symlinks from `.codex/skills` to the `.agents/skills/*` paths, or
- Point your client skill path to `.agents/skills` if supported.

AGENTS.md documents defaults for `GRAPHITI_ENDPOINT` and `GRAPHITI_GROUP_ID`.
