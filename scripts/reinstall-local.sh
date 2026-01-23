#!/bin/bash
# Reinstall Lisa globally from local build
# Usage: ./scripts/reinstall-local.sh [--skip-init]
#
# This script:
# 1. Builds the project (npm run build)
# 2. Creates a .tgz package (npm run package)
# 3. Uninstalls existing global lisa
# 4. Installs the new package globally
# 5. Runs lisa init in the current directory (unless --skip-init)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASES_DIR="$PROJECT_ROOT/releases"

# Parse arguments
SKIP_INIT=false
for arg in "$@"; do
  case $arg in
    --skip-init)
      SKIP_INIT=true
      shift
      ;;
  esac
done

echo "=== Lisa Local Reinstall ==="
echo ""

# Step 1: Build
echo "1. Building project..."
cd "$PROJECT_ROOT"
npm run build

# Step 2: Package
echo ""
echo "2. Creating package..."
npm run package

# Find the latest .tgz file
PACKAGE_FILE=$(ls -t "$RELEASES_DIR"/*.tgz 2>/dev/null | head -1)
if [ -z "$PACKAGE_FILE" ]; then
  echo "Error: No .tgz file found in $RELEASES_DIR"
  exit 1
fi
echo "   Package: $PACKAGE_FILE"

# Step 3: Uninstall existing
echo ""
echo "3. Uninstalling existing global lisa..."
npm uninstall -g @tonycasey/lisa 2>/dev/null || true

# Step 4: Install new package
echo ""
echo "4. Installing new package globally..."
npm install -g "$PACKAGE_FILE"

# Step 5: Verify installation
echo ""
echo "5. Verifying installation..."
INSTALLED_VERSION=$(lisa --version 2>/dev/null || echo "unknown")
echo "   Installed version: $INSTALLED_VERSION"

# Step 6: Run init (unless skipped)
if [ "$SKIP_INIT" = false ]; then
  echo ""
  echo "6. Running lisa init..."
  cd "$PROJECT_ROOT"
  lisa init -y
else
  echo ""
  echo "6. Skipping lisa init (--skip-init flag)"
fi

echo ""
echo "=== Done ==="
echo ""
echo "Lisa $INSTALLED_VERSION installed globally from local build."
