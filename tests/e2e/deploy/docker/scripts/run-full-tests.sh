#!/bin/bash
set -e

OS_NAME=${1:-"unknown"}
PACKAGE_PATH=$(ls /home/testuser/tonycasey-lisa-*.tgz 2>/dev/null | head -1)

echo "=========================================="
echo "Full Integration Test on: $OS_NAME"
echo "Package: $PACKAGE_PATH"
echo "GRAPHITI_ENDPOINT: $GRAPHITI_ENDPOINT"
echo "=========================================="

if [ -z "$PACKAGE_PATH" ]; then
    echo "ERROR: No lisa package found!"
    exit 1
fi

# Setup test projects
source /home/testuser/test-scripts/setup-project.sh

# Run installation test on typescript project
echo ""
echo "=== Phase 1: Installation Tests ==="
cd ~/projects/typescript
npm init -y >/dev/null 2>&1
npm install "$PACKAGE_PATH" >/dev/null 2>&1

# Run installation verification
source /home/testuser/test-scripts/verify-installation.sh

echo ""
echo "=== Phase 2: Memory Persistence Tests ==="

# Run memory persistence tests
source /home/testuser/test-scripts/test-memory-persistence.sh

echo ""
echo "=========================================="
echo "All tests PASSED on $OS_NAME"
echo "=========================================="
