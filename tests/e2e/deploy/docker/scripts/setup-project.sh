#!/bin/bash
# Setup test project directories

echo "Setting up test projects..."

# Create projects directory
mkdir -p ~/projects/typescript
mkdir -p ~/projects/python

# Copy sample project files if available
if [ -d /home/testuser/sample-projects/typescript ]; then
    cp -r /home/testuser/sample-projects/typescript/* ~/projects/typescript/ 2>/dev/null || true
fi

if [ -d /home/testuser/sample-projects/python ]; then
    cp -r /home/testuser/sample-projects/python/* ~/projects/python/ 2>/dev/null || true
fi

echo "Test projects setup complete"
