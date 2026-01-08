# Memor-<i>eeze</i>

**Plug-and-play memory and rules for Claude Code and AI coding assistants.**

Install once, start coding – automatic context persistence via a new agent SKILL.

Anything important you want to make sure gets remembered. Type "remember" during a prompt.

Memories are stored in a graph database, which is fast and efficient for storing and querying large amounts of related data.

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

- ✅ **No re-prompting** - Context persists across sessions
- ✅ **Structured memory** - Entity classification schema v1.0
- ✅ **Cross-agent** - Works with Claude Code, Codex, and other AI assistants
- ✅ **Task management** - Built-in task tracking via Graphiti
- ✅ **Configurable rules** - Deploy coding standards automatically

## Installation
### Globally first
```sh
npm install -g agent-memory
```
### Any repo you want your agents to remember their work..
```sh
agent-memory setup
```

## Quick start
```sh
# in a repo
agent-memory setup
# if you need a local stack here, add Docker assets and run:
agent-memory init && agent-memory up
```
Then start coding with Codex; the hooks will capture context automatically.


## How does it work?

It uses a Graph database, called GRAPHITI, to remember things in a much more sophisticated way than a simple database. 

GRAPHITI allows for complex queries and relationships between different pieces of information, making it easier to retrieve and analyze memories.

## Configuration
Environment overrides:
- `GRAPHITI_GROUP_ID` (default `sample-group`)
- `CODING_USER_NAME` or `USER` for tagging memories.

## Development
- Build: `npm run build` (outputs to `dist/` and copies templates).
- Test: `npm test`
- Lint: `npm run lint`


## Graphiti Memory Storage Explained

#### 1. Episodes

- What: Raw input events/messages stored chronologically
- Purpose: The source material - what was said/happened
- Example: "The user asked to implement a Tasks skill"
- Tools: add_memory, get_episodes, delete_episode

#### 2. Entities (Nodes)

- What: Extracted concepts, people, projects, or things
- Purpose: The "nouns" in your knowledge graph
- Examples: Tony Casey, Tasks Skill, agent-memories, Codex hooks
- Tools: search_nodes

#### 3. Facts (Edges)

- What: Relationships between entities with semantic meaning
- Purpose: The "verbs" connecting nouns - what we retrieved earlier
- Structure:
  source_node → [relationship] → target_node
  e.g., "Tasks Skill" → [CREATES_SKILL] → "add_memory/get_episodes"
- Tools: search_memory_facts, get_entity_edge, delete_entity_edge

## How Storage Works

Episode (input)
↓ extraction
Entities (nodes) ←——— Facts (edges) ———→ Entities (nodes)

1. On every prompt you make, MemorEase will decide if it should save the contents/sentiment to memory. 
2. Optionally, you can use the keyword "remember" during a prompt e.g. please remember that I don't like using "any"
3. The agent checks if it has any tools to "remember" and it sees that it has the "add_memory" tool.
4. The add_memory tool will extract entities and relationships from the prompt and save them to the graph.


Key Fields on Facts

| Field                 | Purpose                                  |
|-----------------------|------------------------------------------|
| uuid                  | Unique identifier for deletion/retrieval |
| group_id              | Namespace (e.g., agent-memories)         |
| valid_at / invalid_at | Temporal validity window                 |
| expired_at            | When fact was superseded                 |
| episodes              | Source episode UUIDs                     |

The temporal fields allow Graphiti to track how knowledge evolves over time - facts can be invalidated when new information supersedes them.

## Entity Classification Schema

This package uses **Entity Classification Schema v1.0** to structure memories.

**Location:** `mcp_server/config/config-docker-neo4j.yaml`

**Defined entity types:**
- **Code & Architecture**: Decision, Pattern, Dependency, TechDebt
- **Context & History**: BugPattern, Rationale, FailedApproach, EnvironmentQuirk
- **External**: UserFeedback, Incident, ApiContract
- **People & Process**: Contributor, Blocker, Estimate
- **Project Scope**: ScopeIn, ScopeOut, Milestone
- **Standard**: Preference, Requirement, Procedure

See `mcp_server/config/config-docker-neo4j.yaml` for full definitions and extraction hints.

## Documentation

- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Developer workflow, npm publishing, template deployment
- **[AGENTS.md](./AGENTS.md)** - Skills documentation and model-neutral approach
- **mcp_server/config/** - Graphiti MCP configuration and entity schema

## License
MIT
