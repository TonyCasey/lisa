p# Claude Code Hooks

This directory contains hook scripts that run automatically during Claude Code sessions.

## Available Hooks

### user-prompt-submit.js
**Triggers:** Before user prompt is submitted (optional)
**Purpose:** Validate, enhance, or log user prompts
**Configuration:** `.claude/settings.json` → `hooks.userPromptSubmit`

**What it does:**
- Validates prompts for destructive operations
- Suggests relevant project files to reference
- Logs prompts for analytics
- Can cancel prompt submission by exiting with non-zero status

**Note:** This hook is optional and must be explicitly configured.

## Configuration

Hooks are configured in `.claude/settings.json`:

```json
{
  "sessionHooks": {
    "start": ".claude/hooks/session-start.js",
    "end": ".claude/hooks/session-end.js"
  },
  "hooks": {
    "userPromptSubmit": ".claude/hooks/user-prompt-submit.js"
  }
}
```

## Customization

### Disabling Hooks

To disable a hook, remove its entry from `settings.json` or comment it out:

```json
{
  "sessionHooks": {
    "start": ".claude/hooks/session-start.js"
    // "end": ".claude/hooks/session-end.js"  // Disabled
  }
}
```

### Modifying Hooks

You can modify these hook files to customize behavior for your project:

1. **Edit the hook file** in `.claude/hooks/`
2. **Test the hook** by running it directly: `node .claude/hooks/session-start.js`
3. **Restart Claude Code** to apply changes

### Creating Custom Hooks

You can create additional hooks for Claude Code:

1. **Create a new `.js` file** in `.claude/hooks/`
2. **Make it executable** (Unix): `chmod +x .claude/hooks/your-hook.js`
3. **Add configuration** to `.claude/settings.json`
4. **Test thoroughly** to ensure it doesn't block Claude Code operation

## Hook Exit Codes

- **Exit 0:** Hook succeeded, continue normal operation
- **Exit 1:** Hook failed, may cancel operation (depends on hook type)

## Debugging Hooks

If a hook isn't working:

1. **Run it manually:** `node .claude/hooks/session-start.js`
2. **Check console output** for errors
3. **Verify paths** in the hook script are correct
4. **Check permissions** (Unix/Mac: hooks should be executable)
5. **Review Claude Code logs** for hook execution errors

## Session State Files

Hooks create temporary state files in `.dev/`:

- `.session-state.json` - Current session state (deleted at session end)
- `.session-stats.json` - Cumulative session statistics
- `.prompt-log.jsonl` - Prompt log (if user-prompt-submit hook is enabled)

These files are typically ignored by git (see `.gitignore`).

## Best Practices

1. **Keep hooks fast** - They run on every session start/end
2. **Handle errors gracefully** - Don't block Claude Code if something fails
3. **Log important events** - Help users understand what hooks are doing
4. **Test thoroughly** - Broken hooks can disrupt your workflow
5. **Version control** - Commit hooks if they're project-specific

## Example Use Cases

### Custom Session Start
Load environment-specific configuration:
```javascript
// In session-start.js
const env = process.env.NODE_ENV || 'development';
console.log(`🌍 Environment: ${env}`);
```

### Custom Session End
Run code quality checks:
```javascript
// In session-end.js
const { execSync } = require('child_process');
try {
  execSync('npm run lint', { stdio: 'ignore' });
  console.log('✅ Linting passed');
} catch (error) {
  console.log('⚠️  Linting failed - consider fixing before next session');
}
```

### Custom Prompt Enhancement
Auto-reference coding standards:
```javascript
// In user-prompt-submit.js
if (prompt.includes('create') || prompt.includes('implement')) {
  console.log('💡 Remember to follow coding standards in .dev/rules/');
}
```

## Troubleshooting

### Hook doesn't run
- Check `.claude/settings.json` configuration
- Verify hook file path is correct (relative to project root)
- Ensure hook file exists and is readable

### Hook runs but fails
- Run manually to see error messages
- Check if required dependencies are installed
- Verify file paths used in the hook

### Hook blocks Claude Code
- Check if hook exits with non-zero status
- Look for infinite loops or long-running operations
- Add timeout handling in your custom hooks

## Resources

- [Claude Code Documentation](https://docs.anthropic.com/claude-code)
- [AI Dotfiles Manager](https://github.com/TonyCasey/ai-dotfiles-manager)
- [Session Hooks Guide](../.dev/hooks/)

---

*These hooks are installed by ai-dotfiles-manager and can be customized for your project.*
