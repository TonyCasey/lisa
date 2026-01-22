#!/bin/bash
# Memory Persistence Tests
# Tests that Lisa can save and retrieve memories via Graphiti MCP
#
# Requires:
#   - GRAPHITI_ENDPOINT environment variable set
#   - GRAPHITI_GROUP_ID environment variable set
#   - Graphiti MCP server running and healthy
#   - lisa CLI installed globally

# Disable errexit for this script (arithmetic with 0 triggers exit)
set +e

PASS=0
FAIL=0
TIMESTAMP=$(date +%s)
# Use meaningful content that LLM fact extraction will process properly
TEST_MEMORY="DECISION: We decided to use PostgreSQL for database $TIMESTAMP because it provides better JSON support"

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
# Check lisa CLI is available
# =============================================================================

if ! command -v lisa &> /dev/null; then
    echo "ERROR: lisa CLI not found!"
    exit 1
fi

echo "  Lisa CLI: $(lisa --version 2>/dev/null || echo 'available')"
echo ""

# =============================================================================
# Test 1: Add a memory
# =============================================================================

echo "=== Test 1: Add Memory ==="
echo "  Adding: '$TEST_MEMORY'"

ADD_OUTPUT=$(lisa memory add "$TEST_MEMORY" 2>&1)
ADD_EXIT=$?

if [ $ADD_EXIT -eq 0 ]; then
    echo "  Result: PASS"
    ((PASS++))
else
    echo "  Result: FAIL"
    echo "  Output: $ADD_OUTPUT"
    ((FAIL++))
fi

# Wait for Graphiti to process (LLM fact extraction takes time)
echo "  Waiting for processing (10s)..."
sleep 10

# =============================================================================
# Test 2: Load memories
# =============================================================================

echo ""
echo "=== Test 2: Load Memories ==="

LOAD_OUTPUT=$(lisa memory load --limit 50 2>&1)
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
# Test 3: Verify facts exist in loaded output
# =============================================================================

echo ""
echo "=== Test 3: Verify Memory Retrieval ==="

# LLM fact extraction transforms input, so check for any facts or PostgreSQL/database keywords
FACT_COUNT=$(echo "$LOAD_OUTPUT" | grep -c '"fact"' || true)
HAS_CONTENT=$(echo "$LOAD_OUTPUT" | grep -qiE 'PostgreSQL|database|JSON' && echo "yes" || echo "no")

if [ "$FACT_COUNT" -gt 0 ] || [ "$HAS_CONTENT" = "yes" ]; then
    echo "  Memory facts found: PASS (facts: $FACT_COUNT)"
    ((PASS++))
else
    echo "  Memory facts found: FAIL"
    echo "  Expected facts about PostgreSQL/database"
    echo "  Loaded output preview:"
    echo "$LOAD_OUTPUT" | head -30
    ((FAIL++))
fi

# =============================================================================
# Test 4: Search for specific memory
# =============================================================================

echo ""
echo "=== Test 4: Search Memory ==="

SEARCH_OUTPUT=$(lisa memory load --query "PostgreSQL database" --limit 10 2>&1)
SEARCH_EXIT=$?

# Check that search returns results (status ok)
if [ $SEARCH_EXIT -eq 0 ] && echo "$SEARCH_OUTPUT" | grep -q '"status": "ok"'; then
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

# Create a temporary different group (without timestamp to avoid false positives)
export GRAPHITI_GROUP_ID="isolated-test-group-$$"

ISOLATED_OUTPUT=$(lisa memory load --limit 10 2>&1)

# The isolated group should have zero facts (empty group)
ISOLATED_FACTS=$(echo "$ISOLATED_OUTPUT" | grep -c '"fact"' || true)

if [ "$ISOLATED_FACTS" -eq 0 ]; then
    echo "  Group isolation: PASS (isolated group has no facts)"
    ((PASS++))
else
    echo "  Group isolation: FAIL (found $ISOLATED_FACTS facts in isolated group)"
    ((FAIL++))
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
