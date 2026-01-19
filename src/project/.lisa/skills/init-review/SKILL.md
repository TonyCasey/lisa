# Init Review Skill

## Purpose
Automatically analyzes a codebase when Lisa is installed, creating a foundational memory of the project structure, technologies, and patterns. This init review serves as context for all future Claude sessions.

## Triggers
Use when the user says things like:
- "run init review"
- "analyze this codebase"
- "scan the project"
- "what is this project about"
- "refresh codebase summary"

## How to use

### Automatic (during npm install)
The init review runs automatically when Lisa is installed via `npm install @tonycasey/lisa`. It:
1. Detects if the folder is a codebase
2. Runs static analysis (language, framework, structure)
3. Stores result as first memory
4. Queues background AI enrichment

### Manual commands
```bash
# Run init review (or re-run with --force)
lisa init-review run [--force]

# Show current init review
lisa init-review show

# Check status (done, enriched, etc.)
lisa init-review status
```

## I/O contract

### Static analysis output
```json
{
  "status": "ok",
  "action": "run",
  "result": {
    "version": "1.0",
    "project": { "name": "lisa", "path": "/dev/lisa", "groupId": "dev-lisa" },
    "codebase": {
      "language": "TypeScript",
      "languages": ["TypeScript", "JavaScript"],
      "framework": null,
      "buildTools": ["npm", "tsc"]
    },
    "structure": {
      "entryPoints": ["src/cli.ts", "src/index.ts"],
      "mainModules": ["src/domain/", "src/infrastructure/"],
      "testDirs": ["tests/"]
    },
    "dependencies": {
      "count": 12,
      "noteworthy": ["commander", "fs-extra", "@anthropic-ai/claude-code"]
    },
    "patterns": {
      "architecture": "clean-architecture",
      "testing": "node-test"
    },
    "metrics": {
      "fileCount": 45,
      "hasTests": true,
      "hasDocumentation": true
    }
  },
  "summary": "TypeScript CLI project with clean-architecture pattern..."
}
```

### Show output
```json
{
  "status": "ok",
  "action": "show",
  "review": "TypeScript CLI project with clean-architecture pattern...",
  "enriched": true,
  "timestamp": "2026-01-11T15:30:00Z"
}
```

### Status output
```json
{
  "status": "ok",
  "action": "status",
  "done": true,
  "enriched": true,
  "timestamp": "2026-01-11T15:30:00Z",
  "groupId": "dev-lisa"
}
```

## Memory storage

Init reviews are stored with these tags:
- `type:init-review` - Identifies as init review memory
- `scope:codebase` - Full codebase analysis
- `ai:enriched` - Present if AI enrichment completed

## Marker file

Location: `.lisa/.init-review-done`

Prevents re-running on subsequent installs. Delete to force re-run, or use `--force` flag.

## Cross-model checklist
- Codex: Use explicit script paths; verify triggers match
- Claude: Keep output concise; shown in session-start context
- Gemini: Explicit commands; avoid model-specific tokens

## Notes
- Static analysis targets <2 seconds execution
- AI enrichment runs in background (30-60 seconds)
- Logs written to `.lisa/.init-review.log`
- Never blocks npm install - errors are caught and logged
