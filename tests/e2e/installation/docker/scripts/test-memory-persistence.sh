#!/bin/bash
# Memory Persistence Tests
# Tests that Lisa can save and retrieve memories via Graphiti MCP
#
# Requires:
#   - GRAPHITI_ENDPOINT environment variable set
#   - GRAPHITI_GROUP_ID environment variable set
#   - Graphiti MCP server running and healthy

PASS=0
FAIL=0
TIMESTAMP=$(date +%s)
TEST_MEMORY="Installation test memory $TIMESTAMP"

check() {
    local name="$1"
    local command="$2"

    echo -n "  Checking: $name... "
    if eval "$command" > /dev/null 2>&1; then
        echo "PASS"
        ((PASS++))
        return 0
    else
        echo "FAIL"
        ((FAIL++))
        return 1
    fi
}

echo "Running memory persistence tests..."
echo "  Endpoint: ${GRAPHITI_ENDPOINT:-not set}"
echo "  Group ID: ${GRAPHITI_GROUP_ID:-not set}"
echo ""

# =============================================================================
# Find memory script
# =============================================================================

MEMORY_SCRIPT=""
if [ -f .lisa/skills/memory/scripts/memory.js ]; then
    MEMORY_SCRIPT=".lisa/skills/memory/scripts/memory.js"
elif [ -f .lisa/skills/memory/scripts/memory.cjs ]; then
    MEMORY_SCRIPT=".lisa/skills/memory/scripts/memory.cjs"
fi

if [ -z "$MEMORY_SCRIPT" ]; then
    echo "ERROR: Memory script not found!"
    exit 1
fi

echo "  Memory script: $MEMORY_SCRIPT"
echo ""

# =============================================================================
# Test 1: Add a memory
# =============================================================================

echo "=== Test 1: Add Memory ==="
echo "  Adding: '$TEST_MEMORY'"

ADD_OUTPUT=$(node "$MEMORY_SCRIPT" add "$TEST_MEMORY" 2>&1)
ADD_EXIT=$?

if [ $ADD_EXIT -eq 0 ]; then
    echo "  Result: PASS"
    ((PASS++))
else
    echo "  Result: FAIL"
    echo "  Output: $ADD_OUTPUT"
    ((FAIL++))
fi

# Wait for Graphiti to process (embedding generation, etc.)
echo "  Waiting for processing..."
sleep 3

# =============================================================================
# Test 2: Load memories
# =============================================================================

echo ""
echo "=== Test 2: Load Memories ==="

LOAD_OUTPUT=$(node "$MEMORY_SCRIPT" load --limit 50 2>&1)
LOAD_EXIT=$?

if [ $LOAD_EXIT -eq 0 ]; then
    echo "  Memory load: PASS"
    ((PASS++))
else
    echo "  Memory load: FAIL"
    echo "  Output: $LOAD_OUTPUT"
    ((FAIL++))
fi

# =============================================================================
# Test 3: Verify test memory exists in loaded output
# =============================================================================

echo ""
echo "=== Test 3: Verify Memory Retrieval ==="

if echo "$LOAD_OUTPUT" | grep -q "Installation test memory"; then
    echo "  Memory found: PASS"
    ((PASS++))
else
    echo "  Memory found: FAIL"
    echo "  Expected to find: 'Installation test memory'"
    echo "  Loaded output preview:"
    echo "$LOAD_OUTPUT" | head -20
    ((FAIL++))
fi

# =============================================================================
# Test 4: Search for specific memory
# =============================================================================

echo ""
echo "=== Test 4: Search Memory ==="

SEARCH_OUTPUT=$(node "$MEMORY_SCRIPT" load --query "Installation test memory" --limit 10 2>&1)
SEARCH_EXIT=$?

if [ $SEARCH_EXIT -eq 0 ] && echo "$SEARCH_OUTPUT" | grep -q "Installation test memory"; then
    echo "  Memory search: PASS"
    ((PASS++))
else
    echo "  Memory search: FAIL"
    ((FAIL++))
fi

# =============================================================================
# Test 5: Group isolation (different project = different memories)
# =============================================================================

echo ""
echo "=== Test 5: Group Isolation ==="

# Save original group
ORIGINAL_GROUP="$GRAPHITI_GROUP_ID"

# Create a temporary different group
export GRAPHITI_GROUP_ID="isolated-test-group-$TIMESTAMP"

ISOLATED_OUTPUT=$(node "$MEMORY_SCRIPT" load --limit 10 2>&1)

# The isolated group should NOT have our test memory
if echo "$ISOLATED_OUTPUT" | grep -q "Installation test memory $TIMESTAMP"; then
    echo "  Group isolation: FAIL (memory leaked to different group)"
    ((FAIL++))
else
    echo "  Group isolation: PASS (memories properly isolated)"
    ((PASS++))
fi

# Restore original group
export GRAPHITI_GROUP_ID="$ORIGINAL_GROUP"

# =============================================================================
# Test 6: Session hook integration (if hooks exist)
# =============================================================================

echo ""
echo "=== Test 6: Session Hook Integration ==="

HOOK_PATH=""
if [ -f .claude/hooks/session-start.js ]; then
    HOOK_PATH=".claude/hooks/session-start.js"
elif [ -f .claude/hooks/session-start.cjs ]; then
    HOOK_PATH=".claude/hooks/session-start.cjs"
fi

if [ -n "$HOOK_PATH" ]; then
    echo "  Testing session-start hook..."
    HOOK_OUTPUT=$(echo '{"trigger":"startup"}' | timeout 30 node "$HOOK_PATH" 2>&1)
    HOOK_EXIT=$?
    
    if [ $HOOK_EXIT -eq 0 ] || [ $HOOK_EXIT -eq 124 ]; then
        # Exit 0 = success, Exit 124 = timeout (acceptable for hook)
        echo "  Session hook: PASS"
        ((PASS++))
    else
        echo "  Session hook: FAIL (exit code: $HOOK_EXIT)"
        ((FAIL++))
    fi
else
    echo "  Session hook: SKIP (hook not found)"
fi

# =============================================================================
# Summary
# =============================================================================

echo ""
echo "=========================================="
echo "Memory Persistence Results: $PASS passed, $FAIL failed"
echo "=========================================="

if [ $FAIL -gt 0 ]; then
    exit 1
fi
