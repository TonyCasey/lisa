# Lisa

**Lisa remembers everything.**

> *Named after Lisa Simpson - the overachiever who never forgets a fact, a slight, or a saxophone lesson.*

Plug-and-play memory for Claude Code and AI coding assistants. Install once, start coding - automatic context persistence via Graphiti.

## Target Audience

This package is designed for **developers** using:
- **Claude Code** (Anthropic's CLI)
- **Codex** (AI coding assistant) **IN PROGRESS**
- **Local Graphiti MCP stack** (Neo4j + memory graph)

Perfect for teams who want their AI assistants to remember project context across sessions without manual prompting.

## What Gets Remembered

Your AI assistants automatically remember:
- **Project context**: What you're working on, features, architecture
- **Coding guidelines**: Standards, patterns, testing principles
- **Design decisions**: Why choices were made, trade-offs, ADRs
- **Task history**: What's done, in progress, or blocked
- **Personal context**: Your role, preferences, coding style
- **Bug patterns**: What broke before, how it was fixed

## Why Use It?

- No re-prompting - Context persists across sessions
- Structured memory - Entity classification schema v1.0
- Cross-agent - Works with Claude Code, Codex, and other AI assistants
- Task management - Built-in task tracking via Graphiti
- Configurable rules - Deploy coding standards automatically

## Installation

### Global install
```sh
npm install -g lisa
```

### In any repo you want your agents to remember
```sh
lisa setup
```

## Quick Start
```sh
# In a repo
lisa setup

# If you need a local Graphiti stack, add Docker assets and run:
lisa init && lisa up
```

Then start coding with Claude Code or Codex - the hooks will capture context automatically.

Type "remember" during a prompt to explicitly save something important.

## How Does It Work?

Lisa uses **Graphiti**, a graph database designed for AI memory. It stores information as a knowledge graph with:
- **Episodes**: Raw events/messages stored chronologically
- **Entities**: Extracted concepts, people, projects (the "nouns")
- **Facts**: Relationships between entities (the "verbs")

This allows for sophisticated querying and relationship tracking that simple databases can't provide.

## Configuration

Environment overrides:
- `GRAPHITI_GROUP_ID` (default: project name)
- `CODING_USER_NAME` or `USER` for tagging memories

## Development

```sh
npm run build    # Build (outputs to dist/, copies templates)
npm test         # Run tests
npm run lint     # Lint code
```

## Entity Classification Schema

Lisa uses **Entity Classification Schema v1.0** to structure memories:

- **Code & Architecture**: Decision, Pattern, Dependency, TechDebt
- **Context & History**: BugPattern, Rationale, FailedApproach, EnvironmentQuirk
- **External**: UserFeedback, Incident, ApiContract
- **People & Process**: Contributor, Blocker, Estimate
- **Project Scope**: ScopeIn, ScopeOut, Milestone
- **Standard**: Preference, Requirement, Procedure

## Documentation

- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Developer workflow, npm publishing
- **[AGENTS.md](./AGENTS.md)** - Skills documentation and model-neutral approach
- **mcp_server/config/** - Graphiti MCP configuration and entity schema

## License
MIT
