#!/bin/bash
set -e

OS_NAME=${1:-"unknown"}
PACKAGE_PATH=$(ls /home/testuser/tonycasey-lisa-*.tgz 2>/dev/null | head -1)
SAMPLE_PROJECTS="/home/testuser/sample-projects"
WORK_DIR="/home/testuser/projects"

echo "=========================================="
echo "Testing lisa package on: $OS_NAME"
echo "Package: $PACKAGE_PATH"
echo "=========================================="

if [ -z "$PACKAGE_PATH" ]; then
    echo "ERROR: No lisa package found!"
    exit 1
fi

# Create work directory
mkdir -p "$WORK_DIR"

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

    # Install lisa package
    echo "Installing lisa package..."
    npm install "$PACKAGE_PATH"

    # Run verification
    source /home/testuser/test-scripts/verify-installation.sh

    echo "--- $PROJECT: PASSED ---"
done

echo ""
echo "=========================================="
echo "All tests PASSED on $OS_NAME"
echo "=========================================="
