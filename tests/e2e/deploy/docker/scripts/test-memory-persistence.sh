#!/bin/bash
# Memory Persistence Tests - requires Graphiti MCP to be running

PASS=0
FAIL=0
TEST_MEMORY="Docker integration test memory $(date +%s)"

check() {
    local name="$1"
    local command="$2"

    echo -n "  Checking: $name... "
    if eval "$command" > /dev/null 2>&1; then
        echo "PASS"
        ((PASS++))
    else
        echo "FAIL"
        ((FAIL++))
    fi
}

echo "Running memory persistence tests..."
echo "  Using endpoint: $GRAPHITI_ENDPOINT"
echo "  Using group: $GRAPHITI_GROUP_ID"

# Find the memory script
MEMORY_SCRIPT=""
if [ -f .agents/skills/memory/scripts/memory.js ]; then
    MEMORY_SCRIPT=".agents/skills/memory/scripts/memory.js"
elif [ -f .agents/skills/memory/scripts/memory.cjs ]; then
    MEMORY_SCRIPT=".agents/skills/memory/scripts/memory.cjs"
fi

if [ -z "$MEMORY_SCRIPT" ]; then
    echo "  ERROR: Memory script not found!"
    exit 1
fi

echo "  Memory script: $MEMORY_SCRIPT"
echo ""

# Test 1: Add a memory
echo "  Adding test memory: '$TEST_MEMORY'"
ADD_OUTPUT=$(node "$MEMORY_SCRIPT" add "$TEST_MEMORY" 2>&1)
ADD_EXIT=$?

if [ $ADD_EXIT -eq 0 ]; then
    echo "  Memory add: PASS"
    ((PASS++))
else
    echo "  Memory add: FAIL"
    echo "  Output: $ADD_OUTPUT"
    ((FAIL++))
fi

# Small delay for processing
sleep 2

# Test 2: Load memories and verify our test memory exists
echo "  Loading memories..."
LOAD_OUTPUT=$(node "$MEMORY_SCRIPT" load --limit 20 2>&1)
LOAD_EXIT=$?

if [ $LOAD_EXIT -eq 0 ]; then
    echo "  Memory load: PASS"
    ((PASS++))
else
    echo "  Memory load: FAIL"
    echo "  Output: $LOAD_OUTPUT"
    ((FAIL++))
fi

# Test 3: Verify test memory appears in loaded output
if echo "$LOAD_OUTPUT" | grep -q "Docker integration test memory"; then
    echo "  Memory retrieval: PASS"
    ((PASS++))
else
    echo "  Memory retrieval: FAIL (test memory not found in output)"
    echo "  Expected to find: 'Docker integration test memory'"
    ((FAIL++))
fi

# Test 4: Test group isolation (different project = different memories)
echo ""
echo "  Testing group isolation..."
cd ~/projects/python
npm init -y >/dev/null 2>&1
npm install /home/testuser/tonycasey-lisa-*.tgz >/dev/null 2>&1

# Load memories in different project (should not have the ubuntu test memory)
export GRAPHITI_GROUP_ID="docker-test-python"
PYTHON_OUTPUT=$(node .agents/skills/memory/scripts/memory.js load --limit 10 2>&1)

# The python project should NOT have the ubuntu test memory (different group)
if echo "$PYTHON_OUTPUT" | grep -q "Docker integration test memory"; then
    echo "  Group isolation: FAIL (memory leaked to different group)"
    ((FAIL++))
else
    echo "  Group isolation: PASS (memories properly isolated)"
    ((PASS++))
fi

# Summary
echo ""
echo "Memory persistence results: $PASS passed, $FAIL failed"

if [ $FAIL -gt 0 ]; then
    exit 1
fi
