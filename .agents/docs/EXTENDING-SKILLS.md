# Extending Skills

This guide explains how to extend Lisa's built-in skills with company-specific workflows without modifying the base skill files.

## Overview

Skills can be extended using `SKILL.local.md` files. These files:
- Are preserved when Lisa is updated
- Are merged with the base `SKILL.md` at build time
- Allow you to add company-specific workflows, scripts, and documentation

## Quick Start

### 1. Create a Local Extension

Create a `SKILL.local.md` file in the skill directory you want to extend:

```bash
# Extend the git skill
touch .agents/skills/git/SKILL.local.md
```

### 2. Add Your Extensions

```markdown
---
extends: git
---

## Company Git Workflow

### Pre-push Checklist
1. Run security scan: `npm run security`
2. Update changelog
3. Bump version

### Deploy to Staging
\`\`\`bash
./scripts/deploy-staging.sh
\`\`\`
```

### 3. Compile to Apply

Ask Lisa to compile the skills:
```
lisa, compile skills
```

Or run the script directly:
```bash
node .agents/skills/lisa/scripts/compile-skills.js
```

The `SKILL.local.md` content will be merged into `SKILL.md`.

**Note:** Skill extensions are also automatically merged when:
- The Lisa package is installed or updated (`npm install`)
- You explicitly ask Lisa to compile skills

## File Structure

```
.agents/skills/git/
├── SKILL.md           # Base skill (from Lisa package)
├── SKILL.local.md     # Your extensions (preserved on updates)
└── scripts/
    ├── bump-version.js     # Base scripts
    └── company-deploy.js   # Your custom scripts
```

## SKILL.local.md Format

### Frontmatter

```yaml
---
extends: skill-name        # Required: name of the skill being extended
description: "Additional triggers"  # Optional: appended to base description
---
```

### Body

Add any markdown content. Common sections:
- Custom workflows
- Company-specific commands
- Integration instructions
- Environment setup

## Example: Extending the Git Skill

### .agents/skills/git/SKILL.local.md

```markdown
---
extends: git
description: "Also triggers on 'deploy', 'release'."
---

## Company Release Process

### Pre-release Checklist

Before creating a release:

1. **Update version**
   \`\`\`bash
   node .agents/skills/git/scripts/bump-version.js minor
   \`\`\`

2. **Run security audit**
   \`\`\`bash
   npm audit --production
   \`\`\`

3. **Update CHANGELOG.md**
   \`\`\`bash
   npx conventional-changelog -p angular -i CHANGELOG.md -s
   \`\`\`

### Deploy to Production

\`\`\`bash
# Tag and push
git tag -a "v$(node -p "require('./package.json').version")" -m "Release"
git push origin --tags

# Deploy via CI
gh workflow run deploy.yml
\`\`\`

### Rollback Procedure

If deployment fails:

\`\`\`bash
# Revert to previous tag
git checkout tags/v1.2.3
./scripts/emergency-deploy.sh
\`\`\`
```

## Adding Custom Scripts

You can add custom scripts alongside the base scripts:

```
.agents/skills/git/scripts/
├── bump-version.js        # Base (from Lisa)
├── poll-ci.sh             # Base (from Lisa)
├── company-deploy.js      # Custom (yours)
└── security-scan.js       # Custom (yours)
```

Custom scripts are preserved during Lisa updates if placed in:
- The `scripts/` directory (alongside base scripts)
- A `.local/` directory (e.g., `scripts.local/`)

## How Merging Works

When Lisa is installed/updated or you run "lisa, compile skills":

1. **Preserve**: `SKILL.local.md` files are saved during package update
2. **Deploy**: Base templates are copied to `.agents/`
3. **Restore**: `SKILL.local.md` files are restored
4. **Merge**: Local content is appended to base `SKILL.md`

### Merge Result

**Base SKILL.md:**
```markdown
---
name: git
description: "GitHub workflow helpers"
---

## How to use
...base content...
```

**SKILL.local.md:**
```markdown
---
extends: git
---

## Company Workflow
...your content...
```

**Merged SKILL.md:**
```markdown
---
name: "git"
description: "GitHub workflow helpers"
---

## How to use
...base content...

<!-- Local Extensions (from SKILL.local.md) -->

## Company Workflow
...your content...
```

## Best Practices

### Do

- ✅ Use `SKILL.local.md` for company-specific workflows
- ✅ Add custom scripts to the `scripts/` directory
- ✅ Document your extensions clearly
- ✅ Include examples and commands
- ✅ Reference base skill sections when relevant

### Don't

- ❌ Modify base `SKILL.md` directly (changes will be overwritten)
- ❌ Duplicate content from the base skill
- ❌ Remove base functionality
- ❌ Use conflicting section names

## Extending Other Skills

The same pattern works for any skill:

| Skill | Extension File |
|-------|----------------|
| git | `.agents/skills/git/SKILL.local.md` |
| memory | `.agents/skills/memory/SKILL.local.md` |
| tasks | `.agents/skills/tasks/SKILL.local.md` |
| jira | `.agents/skills/jira/SKILL.local.md` |

## Troubleshooting

### Extension not appearing

1. Ensure file is named exactly `SKILL.local.md` (case-sensitive)
2. Ask "lisa, compile skills" to trigger the merge
3. Check the merged `SKILL.md` for your content

### Extension overwritten

1. Ensure your file has `.local.md` extension
2. Check that the `extends:` frontmatter matches the skill name
3. Local files should never be overwritten during updates

### Merge conflicts

The merge process appends local content; it doesn't try to merge sections. If you need to override a specific section, copy it to your local file with modifications.

## Version Control

### .gitignore

```gitignore
# Ignore base skills (they come from Lisa package)
.agents/skills/*/SKILL.md

# But track local extensions
!.agents/skills/*/SKILL.local.md
```

### Committing Extensions

```bash
# Add your local extensions
git add .agents/skills/*/SKILL.local.md
git add .agents/skills/*/scripts/company-*.js

git commit -m "feat: add company git workflow extensions"
```

## Migration from Modified Base Files

If you've modified base `SKILL.md` files directly:

1. Copy your custom sections to a new `SKILL.local.md`
2. Remove the `---` frontmatter (or use `extends:`)
3. Ask "lisa, compile skills" to merge local extensions
4. Verify the merged result

```bash
# Example: migrate git skill customizations
cp .agents/skills/git/SKILL.md .agents/skills/git/SKILL.local.md.bak
# Edit SKILL.local.md to keep only your custom sections
# Add extends: git frontmatter
# Then ask: "lisa, compile skills"
```
