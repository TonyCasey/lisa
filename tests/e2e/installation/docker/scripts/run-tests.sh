#!/bin/bash
# Quick Installation Tests
# Tests package installation across multiple project types
#
# Usage:
#   ./run-tests.sh <os_name>
#
# Environment variables:
#   CLI_MODE: CLI mode to test (both, claude-only, opencode-only) - default: both

set -e

OS_NAME=${1:-"unknown"}
CLI_MODE=${CLI_MODE:-"both"}
PACKAGE_PATH=$(ls /home/testuser/tonycasey-lisa-*.tgz 2>/dev/null | head -1)
SAMPLE_PROJECTS="/home/testuser/sample-projects"
WORK_DIR="/home/testuser/projects"

echo "=========================================="
echo "Lisa Quick Installation Tests"
echo "=========================================="
echo "  OS:        $OS_NAME"
echo "  CLI Mode:  $CLI_MODE"
echo "  Package:   $PACKAGE_PATH"
echo "=========================================="

if [ -z "$PACKAGE_PATH" ]; then
    echo "ERROR: No lisa package found!"
    exit 1
fi

# Export CLI_MODE for child scripts
export CLI_MODE

# Create work directory
mkdir -p "$WORK_DIR"

# Determine init flags based on CLI_MODE
INIT_FLAGS="-y --mode skip"
if [ "$CLI_MODE" = "claude-only" ]; then
    INIT_FLAGS="$INIT_FLAGS --claude-only"
elif [ "$CLI_MODE" = "opencode-only" ]; then
    INIT_FLAGS="$INIT_FLAGS --opencode-only"
fi

# Test each project type (6 total)
for PROJECT in typescript javascript python go java csharp; do
    echo ""
    echo "--- Testing $PROJECT project ---"

    # Copy sample project to writable work directory
    if [ -d "$SAMPLE_PROJECTS/$PROJECT" ]; then
        rm -rf "$WORK_DIR/$PROJECT"
        cp -r "$SAMPLE_PROJECTS/$PROJECT" "$WORK_DIR/$PROJECT"
    else
        echo "WARNING: Sample project $PROJECT not found, skipping"
        continue
    fi

    cd "$WORK_DIR/$PROJECT"

    # Initialize npm if needed
    if [ ! -f package.json ]; then
        npm init -y >/dev/null 2>&1
    fi

    # Install lisa package
    echo "  Installing lisa package..."
    npm install "$PACKAGE_PATH" || { echo "  ERROR: npm install failed"; exit 1; }

    # Determine lisa binary path
    # For non-npm projects (Python, Go, etc.), postinstall moves node_modules to .claude/lib/
    if [ -f ./node_modules/.bin/lisa ]; then
        LISA_BIN="./node_modules/.bin/lisa"
    elif [ -f ./.claude/lib/node_modules/.bin/lisa ]; then
        LISA_BIN="./.claude/lib/node_modules/.bin/lisa"
    else
        echo "  ERROR: Could not find lisa binary"
        exit 1
    fi

    # Run lisa init (use local binary to avoid npm registry conflict)
    echo "  Running: $LISA_BIN init $INIT_FLAGS"
    $LISA_BIN init $INIT_FLAGS

    # Run verification
    source /home/testuser/test-scripts/verify-installation.sh

    echo "--- $PROJECT: PASSED ---"
done

echo ""
echo "=========================================="
echo "All tests PASSED on $OS_NAME (CLI Mode: $CLI_MODE)"
echo "=========================================="
