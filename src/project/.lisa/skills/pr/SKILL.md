---
name: pr
description: "PR workflow operations: check status, view comments, watch PRs. Triggers on 'pr checks', 'pr comments', 'watch pr', 'watching'."
---

## Purpose
Model-neutral helper for GitHub PR workflow operations including checking CI status, viewing and addressing review comments, and tracking PRs you're working on.

## Triggers
Use when the user says: "pr checks", "check pr", "pr comments", "view comments", "watch pr", "unwatch pr", "watching", "what prs am i watching", "pr status".

## How to use

### Check PR CI Status
Get the current status of CI checks for a PR:

```bash
# Check current repo's PR
lisa pr checks <PR_NUMBER>

# Check specific repo's PR
lisa pr checks <PR_NUMBER> --repo owner/repo

# Output as JSON
lisa pr checks <PR_NUMBER> --json
```

**Output:**
```text
PR #50 Checks
fix(github): prevent shell injection in GithubClient

✅ 2 passed, 0 failed

  ✓ ci/build
  ✓ security/gitguardian
```

### View PR Comments
Fetch and display PR review comments with triage status:

```bash
# View all comments
lisa pr comments <PR_NUMBER>

# View only pending comments
lisa pr comments <PR_NUMBER> --filter pending

# View only addressed comments
lisa pr comments <PR_NUMBER> --filter addressed

# Output as JSON
lisa pr comments <PR_NUMBER> --json
```

**Output:**
```text
PR: fix(github): prevent shell injection in GithubClient

Comments: 4 total (2 pending, 1 addressed, 1 resolved)

src/lib/infrastructure/github/GithubClient.ts
  :red_circle: Line:365 - @coderabbitai
    "Shell injection risk in command argument construction..."
  :yellow_circle: Line:138 - @coderabbitai (addressed)
    "The current escaping only handles double quotes..."
```

**Comment Status:**
- :red_circle: **pending** - Needs attention
- :yellow_circle: **addressed** - We replied, waiting for reviewer
- :white_check_mark: **resolved** - Reviewer marked as resolved

### Watch a PR
Start tracking a PR for updates (used by polling system):

```bash
# Watch a PR in current repo
lisa pr watch <PR_NUMBER>

# Watch a PR in specific repo
lisa pr watch <PR_NUMBER> --repo owner/repo
```

**Output:**
```text
Now watching PR #50: fix(github): prevent shell injection in GithubClient
```

### Unwatch a PR
Stop tracking a PR:

```bash
lisa pr unwatch <PR_NUMBER>
```

### List Watched PRs
See all PRs you're currently watching:

```bash
# List all watched PRs
lisa pr watching

# Filter by repo
lisa pr watching --repo owner/repo

# Output as JSON
lisa pr watching --json
```

**Output:**
```text
Watching 3 PR(s)

:green_circle: #50 fix(github): prevent shell injection in GithubClient
   TonyCasey/lisa :white_check_mark:
:green_circle: #49 feat(dal): add PR entity types and Neo4j repository
   TonyCasey/lisa :white_check_mark:
:purple_circle: #48 feat: add session compaction detection
   TonyCasey/lisa :white_check_mark: (merged)
```

**PR Status Indicators:**
- :green_circle: Open
- :purple_circle: Merged
- :white_circle: Closed

**Checks Indicators:**
- :white_check_mark: All passing
- :x: Failures
- :hourglass: Pending

## Addressing Comments Workflow

When you need to address PR review comments:

1. **View the comments:**
   ```bash
   lisa pr comments 50 --filter pending
   ```

2. **Make the code fixes** based on feedback

3. **Reply to the comment** on GitHub (include commit hash):
   ```bash
   gh api repos/owner/repo/pulls/comments/COMMENT_ID/replies -X POST -f body="Fixed in commit abc123"
   ```

4. **Or add a summary comment** to the PR:
   ```bash
   gh pr comment 50 --body "Addressed review comments in commit abc123"
   ```

5. **Push and re-check:**
   ```bash
   git push
   lisa pr checks 50
   ```

## I/O Contract

### lisa pr checks
```json
{
  "repo": "owner/repo",
  "prNumber": 50,
  "title": "PR title",
  "overallStatus": "success",
  "checks": [
    {"name": "ci/build", "status": "success", "detailsUrl": "..."}
  ],
  "summary": ":white_check_mark: 2 passed, 0 failed"
}
```

### lisa pr comments
```json
{
  "repo": "owner/repo",
  "prNumber": 50,
  "title": "PR title",
  "comments": [
    {
      "id": 12345,
      "file": "src/file.ts",
      "line": 42,
      "author": "reviewer",
      "body": "Comment text",
      "status": "pending",
      "htmlUrl": "..."
    }
  ],
  "summary": {"total": 4, "pending": 2, "addressed": 1, "resolved": 1}
}
```

### lisa pr watching
```json
{
  "action": "list",
  "success": true,
  "message": "Watching 3 PR(s)",
  "watchedPrs": [
    {
      "number": 50,
      "repo": "owner/repo",
      "title": "PR title",
      "status": "open",
      "checksStatus": "success",
      "unresolvedComments": 2,
      "watchingSince": "2026-01-26T10:00:00Z"
    }
  ]
}
```

## Cross-model checklist
- Claude: Use concise lisa pr commands; prefer --json for programmatic access
- Gemini: Use explicit commands; avoid model-specific tokens
- All: Neo4j must be running for watch/watching commands (lisa doctor to verify)

## Related Skills
- `/git` - For creating PRs, version bumping, CI retriggers
- `/github` - For GitHub Issues and Projects operations
