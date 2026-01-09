# Plan: "Lisa" Keyword Trigger System

## Goal
Enable natural conversation with "lisa" to interact with memory and tasks.
- "hey lisa, show me recent memories"
- "lisa, what tasks are we working on"
- "lisa, what do you know about [topic]"

## Approach
Create a **"lisa" meta-skill** that acts as an intelligent router to existing memory/tasks skills.

## Files to Create

### 1. `.agents/skills/lisa/SKILL.md`
```markdown
---
name: lisa
description: "Lisa - intelligent assistant for memory and tasks. Triggers on 'lisa', 'hey lisa', or addressing lisa directly."
---

## Purpose
Primary interface for project memory, tasks, and knowledge. Routes natural language to appropriate capabilities.

## Triggers
- "hey lisa, ..."
- "lisa, ..."
- "ask lisa ..."

## Capabilities

### Memory
- "lisa, show me recent memories" → `memory.js load --cache`
- "lisa, what do you know about X" → `memory.js load --cache --query "X"`
- "lisa, remember that X" → `memory.js add "X" --cache`

### Tasks
- "lisa, what tasks are we working on" → `tasks.js list --cache`
- "lisa, add task X" → `tasks.js add "X" --cache`

## How to use
1) Parse user intent from "lisa" request
2) Route to: `node .agents/skills/memory/scripts/memory.js` or `node .agents/skills/tasks/scripts/tasks.js`
3) Summarize results conversationally

## Intent Mapping
| Pattern | Action |
|---------|--------|
| "show memories", "recent memories" | memory load |
| "what do you know about X", "recall X" | memory load --query X |
| "remember X", "save X", "note that X" | memory add X |
| "tasks", "working on", "todo" | tasks list |
| "add task X", "new task X" | tasks add X |

## Cross-model checklist
- Keep model-neutral, no role tokens
- JSON I/O from underlying scripts
- Conversational summary of results
```

### 2. `.agents/skills/lisa/cache/.gitkeep`
Empty file for cache directory.

## Files to Update

### 3. `AGENTS.md`
Add at top:
```markdown
## Lisa - Your Project Assistant

Address Lisa directly for memory and tasks:
- "hey lisa, show me recent memories"
- "lisa, what do you know about X"
- "lisa, what tasks are we working on"

Lisa routes to appropriate skills automatically.
```

Update skills list:
```markdown
## Local skills (model-neutral)
- `lisa` skill at `.agents/skills/lisa`: intelligent routing to memory/tasks
- `memory` skill at `.agents/skills/memory`: ...
- `tasks` skill at `.agents/skills/tasks`: ...
```

### 4. `.claude/settings.local.json`
Add `"Skill(lisa)"` to permissions allow list.

## Implementation Order
1. Create `.agents/skills/lisa/SKILL.md`
2. Create `.agents/skills/lisa/cache/.gitkeep`
3. Update `AGENTS.md`
4. Update `.claude/settings.local.json`

## Verification
1. Start new Claude Code session
2. Test: "hey lisa, show me recent memories"
3. Test: "lisa, what do you know about authentication"
4. Test: "lisa, what tasks are we working on"
5. Test: "lisa, remember that we decided to use the meta-skill approach"
6. Verify each routes to correct underlying skill

## Optional Enhancement
Create `.agents/skills/lisa/scripts/lisa.js` router script for programmatic intent detection (can add later if needed).
