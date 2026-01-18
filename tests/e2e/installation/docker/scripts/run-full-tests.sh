#!/bin/bash
# Full Installation Tests
# Runs all installation and memory persistence tests
#
# Usage:
#   ./run-full-tests.sh <os_name>
#
# Arguments:
#   os_name:  Name of the OS (ubuntu, debian, fedora, alpine)
#
# Environment Variables:
#   CLI_MODE: CLI mode to test (both, claude-only, opencode-only) - default: both

set -e

OS_NAME=${1:-"unknown"}
CLI_MODE=${CLI_MODE:-"both"}
PACKAGE_PATH=$(ls /home/testuser/tonycasey-lisa-*.tgz 2>/dev/null | head -1)

echo "=========================================="
echo "Lisa Installation Tests"
echo "=========================================="
echo "  OS:        $OS_NAME"
echo "  CLI Mode:  $CLI_MODE"
echo "  Package:   $PACKAGE_PATH"
echo "  Endpoint:  ${GRAPHITI_ENDPOINT:-not set}"
echo "  Group ID:  ${GRAPHITI_GROUP_ID:-not set}"
echo "=========================================="

if [ -z "$PACKAGE_PATH" ]; then
    echo "ERROR: No lisa package found!"
    exit 1
fi

# Export CLI_MODE for child scripts
export CLI_MODE

# =============================================================================
# Phase 1: Setup Test Projects
# =============================================================================

echo ""
echo "=== Phase 1: Setup Test Projects ==="
source /home/testuser/test-scripts/setup-project.sh

# =============================================================================
# Phase 2: Install Lisa Package
# =============================================================================

echo ""
echo "=== Phase 2: Install Lisa Package ==="
cd ~/projects/typescript
npm init -y >/dev/null 2>&1

echo "  Installing lisa package..."
npm install "$PACKAGE_PATH" >/dev/null 2>&1

# Determine init flags based on CLI_MODE
INIT_FLAGS="-y --mode skip"
if [ "$CLI_MODE" = "claude-only" ]; then
    INIT_FLAGS="$INIT_FLAGS --claude-only"
elif [ "$CLI_MODE" = "opencode-only" ]; then
    INIT_FLAGS="$INIT_FLAGS --opencode-only"
fi

echo "  Running: npx lisa init $INIT_FLAGS"
npx lisa init $INIT_FLAGS

# =============================================================================
# Phase 3: Verify Installation
# =============================================================================

echo ""
echo "=== Phase 3: Verify Installation ==="
source /home/testuser/test-scripts/verify-installation.sh

# =============================================================================
# Phase 4: Memory Persistence Tests (if endpoint is configured)
# =============================================================================

if [ -n "$GRAPHITI_ENDPOINT" ]; then
    echo ""
    echo "=== Phase 4: Memory Persistence Tests ==="
    source /home/testuser/test-scripts/test-memory-persistence.sh
else
    echo ""
    echo "=== Phase 4: Memory Persistence Tests ==="
    echo "  SKIP: GRAPHITI_ENDPOINT not set"
fi

# =============================================================================
# Phase 5: CLI Mode Specific Tests
# =============================================================================

echo ""
echo "=== Phase 5: CLI-Specific Verification ==="

if [ "$CLI_MODE" = "both" ]; then
    # Test that both CLIs are installed
    if [ -d .claude ] && [ -d .opencode ]; then
        echo "  Both CLI directories exist: PASS"
    else
        echo "  Both CLI directories exist: FAIL"
        exit 1
    fi
elif [ "$CLI_MODE" = "claude-only" ]; then
    # Test that only Claude is installed
    if [ -d .claude ] && [ ! -d .opencode ]; then
        echo "  Only Claude Code installed: PASS"
    else
        echo "  Only Claude Code installed: FAIL"
        exit 1
    fi
elif [ "$CLI_MODE" = "opencode-only" ]; then
    # Test that only OpenCode is installed
    if [ ! -d .claude ] && [ -d .opencode ]; then
        echo "  Only OpenCode installed: PASS"
    else
        echo "  Only OpenCode installed: FAIL"
        exit 1
    fi
fi

# =============================================================================
# Summary
# =============================================================================

echo ""
echo "=========================================="
echo "All tests PASSED"
echo "  OS:       $OS_NAME"
echo "  CLI Mode: $CLI_MODE"
echo "=========================================="
