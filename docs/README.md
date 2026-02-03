# Lisa Documentation

Welcome to the Lisa documentation. Lisa gives your AI coding assistants persistent memory.

## Guides

- **[Getting Started](./getting-started.md)** - Installation and first steps
- **[Commands](./commands.md)** - CLI reference
- **[Configuration](./configuration.md)** - Environment variables, LLM settings, preferences
- **[Skills](./skills.md)** - Memory, tasks, PR workflow, and integrations
- **[Troubleshooting](./troubleshooting.md)** - Common issues and solutions

## Architecture

- **[Architecture Overview](./architecture/README.md)** - Clean architecture, DI, event flow
- **[Events & Hooks](./architecture/events.md)** - Event-driven handler patterns and hook I/O
- **[Transcripts](./architecture/transcripts.md)** - Transcript discovery, parsing, heuristic detectors
- **[DAL Routing](./architecture/dal-routing.md)** - Backend selection and fallback behavior
- **[MCP Sessions](./architecture/mcp-sessions.md)** - MCP session lifecycle and connection reuse
- **[Timeouts](./architecture/timeouts.md)** - Timeout semantics and cancellation patterns

## Quick Links

| Topic | Description |
|-------|-------------|
| [Installation](./getting-started.md#quick-start) | Get started in 2 minutes |
| [Docker Setup](./getting-started.md#option-1-self-hosted-with-docker-recommended) | Run Graphiti locally |
| [Zep Cloud](./getting-started.md#option-2-zep-cloud-managed) | Use managed storage |
| [CLI Commands](./commands.md) | Full command reference |
| [Environment Variables](./configuration.md#environment-variables) | Configuration options |
| [LLM Settings](./configuration.md#lisa-llm-settings) | Lisa's own LLM for curation |
| [PR Workflow](./skills.md#pr-pull-request-workflow) | Create, review, and poll PRs |

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development setup.
