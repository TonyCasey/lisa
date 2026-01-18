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

# 4. Memory script exists and is executable
check "Memory script exists" "[ -f .lisa/skills/memory/scripts/memory.js ] || [ -f .lisa/skills/memory/scripts/memory.cjs ]"

# 5. Configuration file created
check "lisa.config.json exists" "[ -f .lisa/lisa.config.json ]"

# =============================================================================
# Claude Code Tests (if mode is 'both' or 'claude-only')
# =============================================================================

if [ "$CLI_MODE" = "both" ] || [ "$CLI_MODE" = "claude-only" ]; then
    echo ""
    echo "=== Claude Code Installation ==="
    
    # .claude/ folder structure
    check ".claude/ folder exists" "[ -d .claude ]"
    check ".claude/hooks/ exists" "[ -d .claude/hooks ]"
    
    # Hooks files present
    check "session-start hook exists" "[ -f .claude/hooks/session-start.js ] || [ -f .claude/hooks/session-start.cjs ]"
    check "session-stop hook exists" "[ -f .claude/hooks/session-stop.js ] || [ -f .claude/hooks/session-stop.cjs ]"
    check "user-prompt-submit hook exists" "[ -f .claude/hooks/user-prompt-submit.js ] || [ -f .claude/hooks/user-prompt-submit.cjs ]"
    
    # Symlinks to shared resources
    check ".claude/skills symlink exists" "[ -L .claude/skills ] || [ -d .claude/skills ]"
    check ".claude/rules symlink exists" "[ -L .claude/rules ] || [ -d .claude/rules ]"
    
    # config.js (settings.json is no longer used with bundled hooks)
    check "Claude config.js exists" "[ -f .claude/config.js ]"
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
    
    # Symlinks to shared resources
    check ".opencode/skill symlink exists" "[ -L .opencode/skill ] || [ -d .opencode/skill ]"
fi

# =============================================================================
# CLI Selection Verification
# =============================================================================

echo ""
echo "=== CLI Configuration ==="

# Check lisa.config.json contains correct cliSupport
if [ -f .lisa/lisa.config.json ]; then
    if [ "$CLI_MODE" = "both" ]; then
        check "Config has claude-code" "grep -q 'claude-code' .lisa/lisa.config.json"
        check "Config has opencode" "grep -q 'opencode' .lisa/lisa.config.json"
    elif [ "$CLI_MODE" = "claude-only" ]; then
        check "Config has claude-code" "grep -q 'claude-code' .lisa/lisa.config.json"
        check "Config does NOT have opencode" "! grep -q 'opencode' .lisa/lisa.config.json"
    elif [ "$CLI_MODE" = "opencode-only" ]; then
        check "Config has opencode" "grep -q 'opencode' .lisa/lisa.config.json"
        check "Config does NOT have claude-code" "! grep -q 'claude-code' .lisa/lisa.config.json"
    fi
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
