# Entity Classification Schema

Entity types for structured memory capture. Use `--type <type>` when adding memories.

## Entity Types

### Code & Architecture

| Type | Tag | Description | Example |
|------|-----|-------------|---------|
| `decision` | `code:decision` | Architecture decisions, tech choices, ADRs | "Chose Graphiti over custom graph DB for temporal knowledge" |
| `pattern` | `code:pattern` | Recurring solutions, design patterns used | "Repository pattern for all data access" |
| `dependency` | `code:dependency` | Why packages added, known issues, upgrade notes | "Added commander@11 for CLI parsing, stable API" |
| `tech-debt` | `code:tech-debt` | Known shortcuts, refactor candidates | "Memory script needs retry logic for MCP timeouts" |

### Context & History

| Type | Tag | Description | Example |
|------|-----|-------------|---------|
| `bug` | `context:bug` | Bug patterns, root causes, clustering | "Null checks missing in async handlers - 3 instances" |
| `rationale` | `context:rationale` | Why features built, stakeholder needs | "Skills replace hooks for model-neutrality across Codex/Claude/Gemini" |
| `failed` | `context:failed` | What didn't work and why | "Direct MCP calls too fragile - added cache fallback" |
| `quirk` | `context:quirk` | Environment gotchas, workarounds | "Node >=18 required for native fetch" |

### External

| Type | Tag | Description | Example |
|------|-----|-------------|---------|
| `feedback` | `external:feedback` | User requests, pain points | "Need better error messages when MCP unavailable" |
| `incident` | `external:incident` | What broke, how fixed, prevention | "MCP timeout caused data loss - added cache" |
| `contract` | `external:contract` | API contracts, external dependencies | "Graphiti expects group_id on all calls" |

### People & Process

| Type | Tag | Description | Example |
|------|-----|-------------|---------|
| `contributor` | `people:contributor` | Who knows what, expertise areas | "tony.casey - full stack, TypeScript, Graphiti integration" |
| `review` | `people:review` | Feedback themes, common issues | "PR reviews often catch missing null checks" |
| `blocker` | `people:blocker` | What slowed work, resolutions | "Waiting on Graphiti auth fix - workaround: local dev mode" |
| `estimate` | `people:estimate` | Calibration data, estimates vs actuals | "Skills migration estimated 2d, took 4d due to MCP issues" |

### Project

| Type | Tag | Description | Example |
|------|-----|-------------|---------|
| `scope-in` | `project:scope-in` | Feature/work added to scope | "Added session_end skill to scope" |
| `scope-out` | `project:scope-out` | Feature/work removed from scope | "Dropped PR Feedback skill from scope" |
| `milestone` | `project:milestone` | Key achievements, releases | "v0.1.0 released with memory and tasks skills" |

## Usage

### Adding typed memories

```bash
# Using --type (maps to tag)
node memory.js add "Chose Graphiti for temporal knowledge graphs" --type decision --cache

# Direct tag usage
node memory.js add "Chose Graphiti for temporal knowledge graphs" --tag code:decision --cache
```

### Querying by type

```bash
# Find all decisions
node memory.js load --query "decision" --cache

# Find all tech debt
node memory.js load --query "tech-debt" --cache
```

## Prefixes for Quick Capture

When adding memories, you can prefix the text for quick classification:

| Prefix | Maps to |
|--------|---------|
| `DECISION:` | `code:decision` |
| `PATTERN:` | `code:pattern` |
| `TECH-DEBT:` | `code:tech-debt` |
| `BUG:` | `context:bug` |
| `RATIONALE:` | `context:rationale` |
| `FAILED:` | `context:failed` |
| `INCIDENT:` | `external:incident` |
| `BLOCKER:` | `people:blocker` |
| `SCOPE-IN:` | `project:scope-in` |
| `SCOPE-OUT:` | `project:scope-out` |

Example:
```bash
node memory.js add "DECISION: Use TypeScript strict mode for all production code" --cache
```

## Schema Version

- **Version**: 1.0.0
- **Created**: 2026-01-07
- **Author**: tony.casey