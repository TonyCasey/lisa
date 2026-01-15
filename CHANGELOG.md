# Changelog

All notable changes to Lisa will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.0] - 2026-01-15

### Added

#### New Skills
- **lisa** skill - Intelligent assistant for memory and tasks
  - Retrospective capability to analyze session changes and save learnings
  - `lisa, compile skills` command to merge SKILL.local.md extensions

- **jira** skill - Create and manage Jira issues via REST API
  - Create tickets with type, priority, and labels
  - List and view issues
  - Change issue types and status

- **git** skill - GitHub and Git workflow helpers
  - Version bump script (`bump-version.ts`)
  - PR creation workflow
  - CI status polling (`poll-ci.sh`)

#### Skill Extensions
- **SKILL.local.md support** - Customize skills per project
  - Create `SKILL.local.md` alongside any `SKILL.md` to extend it
  - Local extensions preserved during deployments
  - `lisa, compile skills` merges extensions into deployed skills

#### Memory Enhancements
- **Summarization for /memory** - Human-readable output instead of raw JSON
  - Automatic categorization (Project, Activity, Conventions, Config, Milestones)
  - Filters expired facts and prioritizes recent ones

#### Hook Improvements
- **session-start.ts** - Handle all trigger types (startup, resume, compact, clear)
  - Context-appropriate messaging for each trigger type
  - Skills reminder after context compaction

#### Scanner Module
- **lisa scan** command for cross-repo knowledge scanning
  - `analyzer.ts` - Code pattern analysis
  - `discovery.ts` - Repository discovery
  - `facts.ts` - Fact extraction
  - `reviewer.ts` - Code review generation

### Changed
- Memory skill now requires summarization of results (never show raw JSON)
- Session-start hook provides differentiated messages per trigger type

### Documentation
- Added `CLAUDE.md` with development workflow and project context
- Added `EXTENDING-SKILLS.md` guide for skill customization
- Updated skill documentation with usage examples

---

## [1.1.2] - 2026-01-10

Previous release. See git history for details.
