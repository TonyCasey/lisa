# Changelog

All notable changes to the agent-memory package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.5.0] - 2026-01-08

### Added

#### CLI Commands
- `agent-memory setup` - Initialize memory system without Docker
- `agent-memory init` - Initialize memory system with Docker stack
- `agent-memory up` - Start Docker stack (Neo4j + Graphiti MCP)
- `agent-memory down` - Stop Docker stack
- `agent-memory doctor` - System health check and diagnostics

#### Memory Skills
- **memory** skill - Load/remember project context via Graphiti MCP
  - `load` command with query support and caching
  - `add` command to append episodes to memory
  - Automatic cache fallback when MCP is offline
  - Multi-group support for different projects/teams
- **tasks** skill - CRUD operations for task management
  - `list` command to show all tasks
  - `add` command with status (todo/doing/done) and tags
  - Task filtering by group and status
  - Cache fallback support
- **prompt** skill - Capture prompts to Graphiti memory

#### Hooks
- **Claude Code hooks** (TypeScript)
  - `session-start.ts` - Session initialization hook
  - `user-prompt-submit.ts` - Prompt capture hook
  - Common utilities for hook execution
- **Codex hooks** (TypeScript)
  - `session_start.ts` - Session initialization
  - `per_prompt.ts` - Per-prompt processing
  - `before_command.ts` - Pre-command execution
  - `after_command.ts` - Post-command execution
  - `session_end.ts` - Session cleanup
  - Task management hooks (create, start, done, ready, overview)

#### Coding Standards & Rules
- Clean Architecture guidelines (`clean-architecture.md`)
- Code Quality Rules (`code-quality-rules.md`)
- Testing Principles (`testing-principles.md`)
- TypeScript-specific standards and config guide
- Automatic deployment to `.agents/rules/` directory

#### Configuration
- Entity Classification Schema v1.0 (mcp_server/config/config-docker-neo4j.yaml)
- Predefined entity types:
  - Code & Architecture: Decision, Pattern, Dependency, TechDebt
  - Context & History: BugPattern, Rationale, FailedApproach, EnvironmentQuirk
  - External: UserFeedback, Incident, ApiContract
  - People & Process: Contributor, Blocker, Estimate
  - Project Scope: ScopeIn, ScopeOut, Milestone
  - Standard: Preference, Requirement, Procedure

#### Docker Integration
- Docker Compose template for Graphiti stack
- Neo4j database integration
- Graphiti MCP server configuration
- Environment variable templating

#### Documentation
- Comprehensive README with target audience and use cases
- DEPLOYMENT.md with developer and npm consumer workflows
- AGENTS.md explaining model-neutral skills approach
- Worked examples in SKILL.md files for memory and tasks
- Entity schema documentation

### Changed
- Package name: `agent-memory` (previously may have been different)
- Version bumped from 0.1.0 to 0.5.0 (significant features added)
- README restructured to clarify target audience (development teams)
- Removed "end user" language - clarified this is for developers using AI assistants

### Fixed
- Consolidated rules from 4 locations down to single source of truth (`src/templates/`)
- Removed duplicate and orphaned files (`.dev/rules/` deleted)
- Created .gitignore to prevent runtime data and build artifacts from being committed
- Verified all Codex hooks have TypeScript source in `src/templates/codex/hooks/`

### Developer Experience
- TypeScript strict mode enabled
- Clean architecture with dependency injection
- Build pipeline: `tsc` → template copying → agent deployment
- Local deployment to `.agents/` and `.claude/` on every build
- Symlinks for rules and skills to reduce duplication

### Infrastructure
- Template system: `src/templates/` as single source of truth
- Post-build deployment script
- Post-install script for npm consumers
- Cache system for offline operation
- Multi-group support for enterprise teams

---

## [0.1.0] - Initial Development

### Added
- Initial CLI structure
- Basic Graphiti MCP integration
- Prototype memory and tasks functionality

---

## Upcoming (Not Yet Implemented)

### Planned Features
- Ralph Wiggum integration (per ralph-plan.md)
- Offline queuing for memory capture when MCP is unavailable
- Graph insights command (centrality, critical-path analysis)
- Task update functionality (currently only add/list)
- Cross-model testing validation (Codex, Claude, Gemini)
- npm publish and registry setup

### Under Consideration
- Web dashboard for memory visualization
- Advanced query builder for facts
- Memory compaction and archival
- Multi-tenant support
- Enhanced entity relationship visualization
- Slack/Discord integration for team notifications

---

## Version History

- **0.5.0** (2026-01-08) - First feature-complete pre-release
- **0.1.0** - Initial development version

---

## Upgrade Guide

### From 0.1.0 to 0.5.0

**Breaking Changes:**
- None (0.x.x versions allow breaking changes, but we maintained compatibility)

**New Features:**
- CLI commands now available: `setup`, `init`, `up`, `down`, `doctor`
- Skills now have worked examples in SKILL.md files
- Entity Classification Schema v1.0 deployed
- Coding standards automatically deployed

**Migration Steps:**
1. Update package: `npm install -g agent-memory@0.5.0`
2. Re-run setup in your project: `agent-memory setup`
3. (Optional) Initialize Docker stack: `agent-memory init && agent-memory up`
4. Verify with: `agent-memory doctor`

---

## Contributing

See [DEPLOYMENT.md](./DEPLOYMENT.md) for developer workflow and contribution guidelines.

---

## License

MIT - see [LICENSE](./LICENSE) file for details