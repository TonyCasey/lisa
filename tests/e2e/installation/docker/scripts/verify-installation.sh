#!/bin/bash
# Installation Verification Checklist
# Tests that Lisa package installs correctly and scaffolds all required files
#
# Supports CLI modes:
#   - both (default): Verify .claude/ and .opencode/
#   - claude-only: Verify only .claude/
#   - opencode-only: Verify only .opencode/

CLI_MODE=${CLI_MODE:-"both"}
PASS=0
FAIL=0

check() {
    local name="$1"
    local command="$2"

    echo -n "  Checking: $name... "
    if eval "$command" > /dev/null 2>&1; then
        echo "PASS"
        PASS=$((PASS + 1))
    else
        echo "FAIL"
        FAIL=$((FAIL + 1))
    fi
}

echo "Running installation verification checklist..."
echo "  CLI Mode: $CLI_MODE"
echo ""

# =============================================================================
# Core Installation Tests (always run)
# =============================================================================

echo "=== Core Installation ==="

# Determine lisa binary path (postinstall moves node_modules for non-npm projects)
if [ -f ./node_modules/.bin/lisa ]; then
    LISA_BIN="./node_modules/.bin/lisa"
elif [ -f ./.claude/lib/node_modules/.bin/lisa ]; then
    LISA_BIN="./.claude/lib/node_modules/.bin/lisa"
else
    LISA_BIN="npx lisa"  # Fallback
fi

# 1. CLI accessible (use local binary to avoid npm registry conflict)
check "lisa CLI accessible" "$LISA_BIN --help"
check "lisa version shows" "$LISA_BIN --version"

# 2. .lisa/ folder created with structure
check ".lisa/ folder exists" "[ -d .lisa ]"
check ".lisa/skills/ exists" "[ -d .lisa/skills ]"
check ".lisa/rules/ exists" "[ -d .lisa/rules ]"

# 3. Skills files present
check "memory skill exists" "[ -f .lisa/skills/memory/SKILL.md ]"
check "tasks skill exists" "[ -f .lisa/skills/tasks/SKILL.md ]"
check "lisa skill exists" "[ -f .lisa/skills/lisa/SKILL.md ]"

# 4. Lisa hook commands available
check "lisa hook command available" "$LISA_BIN hook --help"

# =============================================================================
# Claude Code Tests (if mode is 'both' or 'claude-only')
# =============================================================================

if [ "$CLI_MODE" = "both" ] || [ "$CLI_MODE" = "claude-only" ]; then
    echo ""
    echo "=== Claude Code Installation ==="
    
    # .claude/ folder structure
    check ".claude/ folder exists" "[ -d .claude ]"
    
    # settings.json with hook configuration (new architecture - CLI commands)
    check ".claude/settings.json exists" "[ -f .claude/settings.json ]"
    check "settings.json has SessionStart hook" "grep -q 'lisa hook session-start' .claude/settings.json"
    check "settings.json has Stop hook" "grep -q 'lisa hook session-stop' .claude/settings.json"
    check "settings.json has UserPromptSubmit hook" "grep -q 'lisa hook user-prompt-submit' .claude/settings.json"
    
    # Subdirectory symlinks to shared resources (zero-impact structure)
    check ".claude/skills/lisa exists" "[ -L .claude/skills/lisa ] || [ -d .claude/skills/lisa ]"
    check ".claude/rules/lisa exists" "[ -L .claude/rules/lisa ] || [ -d .claude/rules/lisa ]"
    
    # Verify symlinks resolve correctly
    check ".claude/skills/lisa/memory accessible" "[ -f .claude/skills/lisa/memory/SKILL.md ]"
fi

# =============================================================================
# OpenCode Tests (if mode is 'both' or 'opencode-only')
# =============================================================================

if [ "$CLI_MODE" = "both" ] || [ "$CLI_MODE" = "opencode-only" ]; then
    echo ""
    echo "=== OpenCode Installation ==="
    
    # .opencode/ folder structure
    check ".opencode/ folder exists" "[ -d .opencode ]"
    
    # Plugin exists
    check "OpenCode plugin exists" "[ -f .opencode/plugin/lisa.js ]"
    
    # Individual skill symlinks (OpenCode expects skills/<skill>/SKILL.md)
    check ".opencode/skills/memory exists" "[ -L .opencode/skills/memory ] || [ -d .opencode/skills/memory ]"
    check ".opencode/skills/lisa exists" "[ -L .opencode/skills/lisa ] || [ -d .opencode/skills/lisa ]"
    check ".opencode/skills/tasks exists" "[ -L .opencode/skills/tasks ] || [ -d .opencode/skills/tasks ]"
    
    # Verify symlinks resolve correctly
    check ".opencode/skills/lisa/SKILL.md accessible" "[ -f .opencode/skills/lisa/SKILL.md ]"
fi

# =============================================================================
# Summary
# =============================================================================

echo ""
echo "=========================================="
echo "Installation Results: $PASS passed, $FAIL failed"
echo "=========================================="

if [ $FAIL -gt 0 ]; then
    exit 1
fi
