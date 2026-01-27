# Memory Rules

Guidelines for using Lisa's memory system (`/memory` skill) to build persistent project knowledge.

## When to Create Memories

### Always Create Memories For

1. **Milestones** - Completed features, releases, significant achievements
2. **Decisions** - Architecture choices, technology selections, trade-offs made
3. **Conventions** - Naming patterns, folder structures, coding standards discovered
4. **Gotchas** - Bugs found, workarounds needed, things to avoid
5. **Configuration** - Environment setup, tool configurations, integration details

### Don't Create Memories For

- Temporary debugging notes
- Work-in-progress that may change
- Information already in documentation
- Trivial changes or fixes

## Memory Types

Use the `--type` flag to categorize memories:

| Type | When to Use | Example |
|------|-------------|---------|
| `milestone` | Feature complete, release, major achievement | "FEATURE: Added Excel parser with tests" |
| `decision` | Architecture or technology choice | "DECISION: Using Neo4j for graph storage" |
| `convention` | Naming, structure, or pattern | "CONVENTION: Files use kebab-case" |
| `gotcha` | Bug, workaround, or warning | "GOTCHA: Must escape quotes in shell commands" |
| `config` | Setup or configuration detail | "CONFIG: Docker uses port 7474 for Neo4j" |

## Memory Format

### Structure

```
<TYPE>: [<TICKET>] <Description>
```

### Examples

```bash
# Milestone (with ticket)
lisa memory add "MILESTONE: [#42] Excel brandlist parser complete with 95% test coverage" --type milestone

# Decision
lisa memory add "DECISION: Chose Zep Cloud over local Neo4j for production - better uptime, managed backups" --type decision

# Convention
lisa memory add "CONVENTION: All repository interfaces prefixed with 'I' (e.g., IMemoryRepository)" --type convention

# Gotcha
lisa memory add "GOTCHA: gh CLI requires --repo flag even in repo directory when using actions" --type gotcha

# Config
lisa memory add "CONFIG: CircleCI uses TEST label to trigger CI pipeline" --type config
```

## When to Load Memory

Load memory at the start of work to get context:

```bash
# Load recent memories
lisa memory load --cache

# Search for specific topic
lisa memory load --cache --query "authentication"

# Load with limit
lisa memory load --cache --limit 20
```

## Memory Lifecycle

### Creating

1. **After completing a feature** - Create milestone memory
2. **After making a decision** - Document reasoning while fresh
3. **After discovering a pattern** - Capture conventions
4. **After hitting a bug** - Document the gotcha

### Reviewing

Periodically review memories to:
- Remove outdated information
- Update superseded decisions
- Consolidate related memories

### Retrospectives

Use Lisa's retrospective feature to analyze recent work:

```bash
# Via lisa skill
"lisa, do a retrospective"

# Analyzes git history and saves learnings
```

## Integration with Git Workflow

After every commit, create a milestone memory:

```bash
git commit -m "feat: add Excel parser"
lisa memory add "MILESTONE: Added Excel parser with unit tests" --type milestone --cache
```

See `/git` skill and `git-rules.md` for full workflow.

## Memory Search Tips

- Use specific keywords for better results
- Search by type: "DECISION authentication"
- Search by ticket: "#42" or "JIRA-123"
- Recent memories load first by default

## Related Skills

- `/lisa` - Natural language interface ("lisa, what do you know about X")
- `/tasks` - Task management (different from memories)
- `/git` - Milestone creation after commits
