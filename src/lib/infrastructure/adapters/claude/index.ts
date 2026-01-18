/**
 * Claude Code adapter hooks.
 * 
 * These are thin adapters that translate Claude Code hook protocol
 * to Lisa events and delegate to the shared handlers.
 */

export { readStdin, IHookInput } from './stdin';

// Note: The actual hook entry points are:
// - session-start.ts
// - session-stop.ts  
// - user-prompt-submit.ts
// 
// These are meant to be compiled and deployed to .claude/hooks/
