# .dev/ - Developer Workspace

This folder contains **your personal developer workspace** that's auto-loaded into AI context for every session.

## Files

### architecture.md
**Auto-generated project overview** that provides context to AI assistants about:
- Project structure
- Technologies used
- Architectural patterns
- Key principles

**Regenerated on setup/update** to stay current with your project.

### todo.md
**Your personal task list** with checkboxes:
- [ ] Pending tasks
- [x] Completed tasks

AI assistants see your current tasks and can help you work through them. Simply check off items as you complete them.

## Auto-Loading

All files in .dev/ are automatically loaded into AI context when you start a new session with:
- Claude Code
- Cursor
- Kilo Code
- Roo Code

This gives the AI immediate understanding of:
- What you're working on (todo.md)
- How the project is structured (architecture.md)

## Git

The .dev/ folder is **personal** and typically not committed:

```gitignore
# In your .gitignore:
.dev/
```

However, you can commit it if you want to share architecture notes or tasks with your team.

## Customization

Feel free to add more files:
- `notes.md` - Personal development notes
- `decisions.md` - Architectural decision records
- `research.md` - Research and exploration notes

All .md files in .dev/ will be loaded into AI context.
