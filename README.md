# Lisa – Long Term Memory for AI Coding Assistants

![Lisa for Claude](claude-i-remember.png)


> *Lisa, never forgets a commit, a pr, a code change, or a saxophone lesson.*

## Why Lisa?

Unlike simple vector databases or file-based memory, Lisa uses **[Graphiti](https://github.com/getzep/graphiti)** - a knowledge graph that captures *relationships* between concepts, not just text.

- **Graph-native storage** (Neo4j) - Connections matter as much as content
- **LLM-powered extraction** - Automatically identifies entities and relationships
- **Temporal awareness** - Knows *when* you learned something
- **Semantic retrieval** - Finds relevant context by meaning, not keywords
- **Multi-CLI support** - Works with Claude Code and OpenCode


---

![Graph DB](lisa-graph-db.png)

## Installation

### Quick Start

```bash
# Install Lisa globally - IMPORTANT
npm install -g @tonycasey/lisa

# change to any project directory
cd your-project-directory

# initialize - copies in relevant files
lisa init

```


## Using Lisa

Once installed, Lisa works automatically. Your AI assistant will:

1. **Load context at session start** - Previous memories and project context
2. **Capture important info during coding** - Decisions, patterns, etc.
3. **Remember explicitly when asked** - Say "remember that..." to save important notes



During a coding session:

- "remember that we decided to use Redux for state management"
- "hey lisa, what do you know about the authentication system?"
- "lisa, show me recent memories"
- "lisa, what tasks are we working on?"

---

See the [Getting Started Guide](./docs/getting-started.md)

---

[Contributing](./CONTRIBUTING.md) | [Changelog](./CHANGELOG.md)
