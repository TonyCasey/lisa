# CLI Commands Reference

## lisa init

Initialize a project with Lisa memory support.

```bash
lisa init [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-e, --endpoint <url>` | MCP endpoint (default: `http://localhost:8010/mcp/`) |
| `-g, --group <id>` | Group ID for memories (default: project folder name) |
| `-f, --force` | Overwrite existing files (except `.lisa/.env`) |
| `-m, --mode <mode>` | Deployment mode: `local`, `zep-cloud`, or `skip` |
| `--zep-api-key <key>` | Zep API key (for zep-cloud mode) |
| `--zep-project-id <id>` | Zep project ID (for zep-cloud mode) |
| `-y, --yes` | Skip interactive prompts, use defaults |
| `--claude-only` | Only set up Claude Code support |
| `--opencode-only` | Only set up OpenCode support |
| `--isolated` | Install to `.claude/lib` for non-npm projects |

### Examples

```bash
# Interactive setup (both CLIs)
lisa init

# Non-interactive with defaults
lisa init -y

# Claude Code only
lisa init --claude-only

# OpenCode only
lisa init --opencode-only

# Zep Cloud mode
lisa init --mode zep-cloud --zep-api-key YOUR_KEY --zep-project-id YOUR_PROJECT

# Custom group ID
lisa init -g my-custom-group

# For Python/Go projects (keeps root clean)
lisa init --isolated
```

### What It Creates

- `.lisa/` - Skills, rules, and configuration
- `.lisa/.env` - Environment configuration (created on first init only)
- `.claude/` - Claude Code configuration (if selected)
  - `settings.json` - Hook commands registered here
  - `skills/lisa/` - Symlink to `.lisa/skills`
  - `rules/lisa/` - Symlink to `.lisa/rules`
- `.opencode/` - OpenCode plugin (if selected)
  - `plugin/lisa.js` - Bundled plugin
  - `skills/` - Individual skill symlinks
- `docker-compose.graphiti.yml` - Docker stack (if local mode)

**Note:** Lisa uses subdirectory symlinks to preserve any existing user files in `.claude/` or `.opencode/`.

---

## lisa up

Start the Docker stack (Neo4j + Graphiti MCP server).

```bash
lisa up [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-c, --compose <file>` | Compose file (default: `docker-compose.graphiti.yml`) |

### Example

```bash
lisa up
lisa up -c custom-compose.yml
```

---

## lisa down

Stop the Docker stack.

```bash
lisa down [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-c, --compose <file>` | Compose file (default: `docker-compose.graphiti.yml`) |

### Example

```bash
lisa down
```

---

## lisa doctor

Validate Docker and MCP connectivity.

```bash
lisa doctor [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-c, --compose <file>` | Compose file (default: `docker-compose.graphiti.yml`) |
| `-e, --endpoint <url>` | Override MCP endpoint for testing |

### Example Output (Local Mode)

```
Mode: local
Group: my-project

Docker OK: Docker version 24.0.7
Docker Compose OK: Docker Compose version v2.23.0
Compose file found: docker-compose.graphiti.yml
MCP reachable at http://localhost:8010/mcp/
```

### Example Output (Zep Cloud)

```
Mode: zep-cloud
Group: my-project

Zep Cloud mode - no local Docker required

Zep MCP reachable at https://api.getzep.com/mcp/
```

---

## lisa scan

Scan a directory for projects and create solution-level knowledge.

```bash
lisa scan [path]
```

---

## lisa sync

Sync copied directories when symlinks couldn't be created.

On some systems (e.g., Windows without developer mode), Lisa falls back to copying directories instead of creating symlinks. This command syncs those copies with the source.

```bash
lisa sync [options]
```

### Options

| Option | Description |
|--------|-------------|
| `--cwd <path>` | Project directory (default: current directory) |

### Example

```bash
lisa sync
```

This reads `.lisa/.copy-fallbacks.json` and updates any copied directories from their source.

---

## lisa version

Show Lisa version.

```bash
lisa --version
lisa -V
```

---

## lisa memory

Memory management commands.

```bash
lisa memory <subcommand> [options]
```

### Subcommands

#### load

Load memories from storage.

```bash
lisa memory load [options]
```

| Option | Description |
|--------|-------------|
| `--query <text>` | Semantic search query |
| `--limit <n>` | Maximum facts to return |
| `--since <date>` | Filter by date (ISO, `today`, `7d`, `1w`, `24h`, `1m`) |
| `--until <date>` | End date for range filter |
| `--cache` | Use cache fallback if backend unavailable |

#### add

Add a memory fact.

```bash
lisa memory add <text> [options]
```

| Option | Description |
|--------|-------------|
| `--tag <tag>` | Add a tag (repeatable) |
| `--type <type>` | Memory type (e.g., `milestone`, `decision`, `convention`, `gotcha`) |
| `--source <source>` | Source type (`user-explicit`, `session-capture`, etc.) |
| `--lifecycle <tier>` | Lifecycle tier (`permanent`, `project`, `session`, `ephemeral`) |
| `--ttl <duration>` | Time-to-live (e.g., `30s`, `5m`, `2h`, `7d`, `1w`) |
| `--cache` | Enable cache |

#### expire

Expire a single memory by UUID.

```bash
lisa memory expire <uuid>
```

#### cleanup

Clean up expired memories based on lifecycle TTL.

```bash
lisa memory cleanup [options]
```

| Option | Description |
|--------|-------------|
| `--dry-run` | Preview what would be expired without applying |

#### conflicts

Find groups of potentially conflicting facts.

```bash
lisa memory conflicts [options]
```

| Option | Description |
|--------|-------------|
| `--topic <topic>` | Filter by topic tag |

#### dedupe

Detect duplicate facts using multi-pass algorithm.

```bash
lisa memory dedupe [options]
```

| Option | Description |
|--------|-------------|
| `--min-similarity <n>` | Minimum Jaccard similarity threshold (0-1) |
| `--limit <n>` | Maximum facts to analyze |
| `--since <date>` | Filter by date |

#### curate

Mark a fact with curation status.

```bash
lisa memory curate <uuid> --mark <mark>
```

| Option | Description |
|--------|-------------|
| `--mark <mark>` | Curation mark: `authoritative`, `draft`, `deprecated`, `needs-review` |

#### consolidate

Consolidate duplicate facts.

```bash
lisa memory consolidate <uuid...> --action <action>
```

| Option | Description |
|--------|-------------|
| `--action <action>` | Action: `merge`, `archive-duplicates`, `keep-all` |
| `--retain <uuid>` | UUID of fact to retain (for merge) |
| `--text <text>` | Merged text (for merge) |

#### summarize

Summarize recent memories using LLM.

```bash
lisa memory summarize [options]
```

| Option | Description |
|--------|-------------|
| `--since <date>` | Start date for facts to summarize |
| `--topic <topic>` | Focus on a specific topic |
| `--style <style>` | Summary style: `concise` or `detailed` |
| `--max-facts <n>` | Maximum facts to include |

---

## lisa tasks

Task management commands.

```bash
lisa tasks <subcommand> [options]
```

### Subcommands

#### list

List tasks.

```bash
lisa tasks list [options]
```

| Option | Description |
|--------|-------------|
| `--since <date>` | Filter by start date |
| `--until <date>` | Filter by end date |
| `--all` | Include completed tasks |
| `--limit <n>` | Maximum tasks to return |
| `--cache` | Use cache fallback |

#### add

Add a task.

```bash
lisa tasks add <text> [options]
```

| Option | Description |
|--------|-------------|
| `--status <status>` | Initial status: `todo`, `doing`, `done`, `blocked` |
| `--tag <tag>` | Add a tag (repeatable) |
| `--cache` | Enable cache |

#### update

Update a task.

```bash
lisa tasks update <text> [options]
```

| Option | Description |
|--------|-------------|
| `--status <status>` | New status: `todo`, `doing`, `done`, `blocked` |
| `--tag <tag>` | Add a tag (repeatable) |

---

## lisa llm

LLM provider configuration and management.

```bash
lisa llm <subcommand> [options]
```

### Subcommands

#### config

Display or set LLM configuration.

```bash
lisa llm config [options]
```

| Option | Description |
|--------|-------------|
| `--provider <provider>` | Set provider: `anthropic`, `openai`, `ollama` |
| `--model <model>` | Set model name |
| `--endpoint <url>` | Set custom endpoint |
| `--api-key <key>` | Set API key |
| `--enable` | Enable LLM features |
| `--disable` | Disable LLM features |
| `--max-tokens <n>` | Set max tokens |
| `--temperature <n>` | Set temperature |
| `--reset` | Reset to defaults |

#### test

Send a test prompt to verify LLM connectivity.

```bash
lisa llm test [prompt]
```

#### usage

Show LLM token usage and estimated cost.

```bash
lisa llm usage [options]
```

| Option | Description |
|--------|-------------|
| `--since <date>` | Filter usage from date |

#### features

Show or toggle LLM feature availability.

```bash
lisa llm features [options]
```

| Option | Description |
|--------|-------------|
| `--enable <feature>` | Enable a feature |
| `--disable <feature>` | Disable a feature |

---

## lisa pref

Preference key-value store.

```bash
lisa pref <subcommand>
```

### Subcommands

#### get

Retrieve a preference value.

```bash
lisa pref get <key>
```

#### set

Store a preference value.

```bash
lisa pref set <key> <value>
```

#### delete

Remove a preference.

```bash
lisa pref delete <key>
```

#### list

Display all stored preferences.

```bash
lisa pref list
```

---

## lisa storage

Storage backend management.

```bash
lisa storage <subcommand>
```

### Subcommands

#### status

Show current storage mode and connection status.

```bash
lisa storage status
```

#### switch

Switch storage mode.

```bash
lisa storage switch <mode>
```

Where `<mode>` is `local` or `zep-cloud`.

---

## lisa pr

PR workflow commands.

```bash
lisa pr <subcommand> [options]
```

### Subcommands

#### create

Create a PR with auto-generated body and issue linking.

```bash
lisa pr create [options]
```

| Option | Description |
|--------|-------------|
| `--issue <number>` | Link to issue (repeatable) |
| `--base <branch>` | Base branch (default: main) |
| `--title <title>` | PR title |
| `--draft` | Create as draft PR |
| `--no-watch` | Don't auto-watch after creation |
| `--no-comment` | Don't add linking comment |
| `--no-poll` | Don't poll after creation |
| `--json` | Output as JSON |

#### review

Run local AI code review on current branch diff.

```bash
lisa pr review [options]
```

| Option | Description |
|--------|-------------|
| `--base <branch>` | Base branch for diff |
| `--block` | Block merge on issues |
| `--json` | Output as JSON |

#### checks

Get CI check status for a PR.

```bash
lisa pr checks <pr-number> [options]
```

| Option | Description |
|--------|-------------|
| `--repo <owner/repo>` | Repository |
| `--json` | Output as JSON |
| `--no-save` | Don't save to memory |

#### comments

Fetch and display PR review comments.

```bash
lisa pr comments <pr-number> [options]
```

| Option | Description |
|--------|-------------|
| `--repo <owner/repo>` | Repository |
| `--filter <filter>` | Filter comments |
| `--json` | Output as JSON |
| `--no-save` | Don't save to memory |

#### address

Fetch pending comments and prepare them for addressing.

```bash
lisa pr address <pr-number> [options]
```

| Option | Description |
|--------|-------------|
| `--repo <owner/repo>` | Repository |
| `--include-resolved` | Include resolved comments |
| `--context <n>` | Lines of context |
| `--json` | Output as JSON |

#### watch / unwatch

Start or stop watching a PR for updates.

```bash
lisa pr watch <pr-number> [--repo <owner/repo>]
lisa pr unwatch <pr-number> [--repo <owner/repo>]
```

#### poll

Poll all watched PRs for state changes.

```bash
lisa pr poll [options]
```

| Option | Description |
|--------|-------------|
| `--pr <number>` | Poll specific PR |
| `--current` | Poll PR for current branch |
| `--interval <seconds>` | Polling interval |
| `--watch` | Watch-and-poll mode |
| `--no-auto-unwatch` | Don't auto-unwatch merged/closed PRs |
| `--no-auto-address` | Don't auto-address new comments |
| `--notify` | Send desktop notifications |
| `--json` | Output as JSON |

#### link

Link a PR to an issue (creates CLOSES relationship).

```bash
lisa pr link <pr-number> <issue-number> [options]
```

| Option | Description |
|--------|-------------|
| `--repo <owner/repo>` | Repository |
| `--no-comment` | Don't add linking comment |
| `--json` | Output as JSON |

#### remember

Save a note about a PR to memory.

```bash
lisa pr remember <pr-number> <note> [options]
```

| Option | Description |
|--------|-------------|
| `--repo <owner/repo>` | Repository |
| `--json` | Output as JSON |

#### watching / status

List watched PRs or show status summary.

```bash
lisa pr watching [--repo <owner/repo>] [--limit <n>] [--json]
lisa pr status [--repo <owner/repo>] [--json]
```

#### cron

Manage PR polling cron jobs.

```bash
lisa pr cron install [--notify] [--interval <minutes>]
lisa pr cron uninstall
lisa pr cron status [--json]
```

---

## lisa issue

GitHub issue management with automatic label inference.

```bash
lisa issue <subcommand> [options]
```

### Subcommands

#### create

Create a GitHub issue with automatic label inference.

```bash
lisa issue create [options]
```

| Option | Description |
|--------|-------------|
| `--title <title>` | Issue title |
| `--body <body>` | Issue body |
| `--label <label>` | Add label (repeatable) |
| `--no-auto-label` | Skip automatic label inference |
| `--yes` | Skip confirmation |
| `--dry-run` | Preview without creating |

#### labels

Infer labels for content without creating an issue.

```bash
lisa issue labels [options]
```

| Option | Description |
|--------|-------------|
| `--title <title>` | Content title |
| `--body <body>` | Content body |
| `--json` | Output as JSON |

---

## lisa hook

Hook commands invoked by Claude Code during session lifecycle events. These are registered in `.claude/settings.json` and called automatically.

```bash
lisa hook <event>
```

### Subcommands

| Command | Description |
|---------|-------------|
| `lisa hook session-start` | Load memory context at session start |
| `lisa hook session-stop` | Capture work when session stops |
| `lisa hook user-prompt-submit` | Process user prompts |

### How Hooks Work

Hooks are registered in `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{ "type": "command", "command": "lisa hook session-start" }]
    }],
    "Stop": [{
      "hooks": [{ "type": "command", "command": "lisa hook session-stop" }]
    }],
    "UserPromptSubmit": [{
      "hooks": [{ "type": "command", "command": "lisa hook user-prompt-submit" }]
    }]
  }
}
```

Claude Code invokes these commands at the appropriate lifecycle events. The hooks:
- Read JSON from stdin (event context)
- Output JSON to stdout (context for Claude)
- Write status messages to stderr (visible to user)

### Manual Testing

```bash
# Test session-start hook
echo '{"source":"startup"}' | lisa hook session-start

# Test with resume trigger
echo '{"source":"resume"}' | lisa hook session-start

# Test session-stop hook
echo '{"session_id":"test"}' | lisa hook session-stop
```

---

## lisa github

GitHub issues and projects management (skill passthrough).

```bash
lisa github <subcommand> [options]
```

### Subcommands

#### Issues

```bash
# List issues
lisa github issues list --repo owner/repo [--state open|closed|all] [--labels x,y] [--limit N]

# Create issue
lisa github issues create --repo owner/repo --title "..." [--body "..."] [--labels x,y]

# View issue
lisa github issues view --repo owner/repo <number>

# Close/reopen issue
lisa github issues close --repo owner/repo <number> [--reason completed|not_planned]
lisa github issues reopen --repo owner/repo <number>

# Manage labels
lisa github issues label --repo owner/repo <number> --add x,y
lisa github issues label --repo owner/repo <number> --remove z
```

#### Projects v2

```bash
# List projects
lisa github projects list --repo owner/repo

# View project
lisa github projects view --repo owner/repo <number>

# List items in project
lisa github projects items --repo owner/repo <number>

# Add issue to project
lisa github projects add --repo owner/repo <project-number> <issue-number>
```

#### Sync

Bidirectional sync between GitHub Issues and Lisa tasks.

```bash
# Import GitHub issues to Lisa tasks
lisa github sync --repo owner/repo --import

# Export Lisa tasks to GitHub issues
lisa github sync --repo owner/repo --export

# Bidirectional sync (default)
lisa github sync --repo owner/repo

# Preview changes without applying
lisa github sync --repo owner/repo --dry-run

# Filter by labels
lisa github sync --repo owner/repo --labels bug,enhancement
```

---

## lisa jira

Jira issue management (skill passthrough).

```bash
lisa jira <subcommand> [options]
```

Delegates to the Jira skill script. See `/jira` skill for details.

---

## lisa help

Show help for any command.

```bash
lisa --help
lisa init --help
lisa memory --help
lisa pr --help
```
