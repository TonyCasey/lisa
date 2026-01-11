#!/bin/bash
# Verification Checklist - mirrors Windows test plan

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

echo "Running verification checklist..."

# 1. CLI accessible
check "lisa CLI accessible" "npx lisa --help"

# 2. .agents/ folder created with skills
check ".agents/ folder exists" "[ -d .agents ]"
check ".agents/skills/ exists" "[ -d .agents/skills ]"

# 3. .claude/ folder created with hooks
check ".claude/ folder exists" "[ -d .claude ]"
check ".claude/hooks/ exists" "[ -d .claude/hooks ]"

# 4. Skills files present
check "memory skill exists" "[ -f .agents/skills/memory/SKILL.md ]"
check "tasks skill exists" "[ -f .agents/skills/tasks/SKILL.md ]"
check "lisa skill exists" "[ -f .agents/skills/lisa/SKILL.md ]"

# 5. Hooks files present
check "session-start hook exists" "[ -f .claude/hooks/session-start.js ] || [ -f .claude/hooks/session-start.cjs ]"
check "user-prompt-submit hook exists" "[ -f .claude/hooks/user-prompt-submit.js ] || [ -f .claude/hooks/user-prompt-submit.cjs ]"

# 6. Memory script exists
check "Memory script exists" "[ -f .agents/skills/memory/scripts/memory.js ] || [ -f .agents/skills/memory/scripts/memory.cjs ]"

# Summary
echo ""
echo "Results: $PASS passed, $FAIL failed"

if [ $FAIL -gt 0 ]; then
    exit 1
fi
