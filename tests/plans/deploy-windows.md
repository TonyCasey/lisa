Deployment Test Plan - Windows (.tgz)

Overview

Test the lisa package changes by building a .tgz and installing in a destination project.

Steps

1. Bump Version

- Example: Update version in package.json from 0.5.11 to 0.5.12

2. Build & Pack

cd C:/dev/lisa
npm run build
npm pack
Creates: tonycasey-lisa-0.5.12.tgz

3. Destination Projects Folder

Target: C:/dev/lisa-tests/

Create a test folder for each language type (if they don't already exist).

 - C:/dev/lisa-tests/typescript
 - C:/dev/lisa-tests/python
 - C:/dev/lisa-tests/javascript
 - C:/dev/lisa-tests/go
 - C:/dev/lisa-tests/java
 - C:/dev/lisa-tests/csharp

Populate each folder with a sample boilerplate project related to the language type.

--- 

4. For each folder in C:/dev/lisa-tests/

   1. Install @tonycasey/lisa npm package
        npm install C:/dev/lisa/tonycasey-lisa-x.x.xx.tgz

   2. Verification Checklist

      - lisa CLI is accessible (lisa --help)
        - .agents/ folder created with skills
        - .claude/ folder created with hooks
        - Docker containers start (or show a setup message)
        - Port checking works
        - Memory loads for the destination project
        - Memory is project-specific (not shared with other projects)
        - Initial folder review is conducted if the folder is a codebase
        - Initial review is saved to memory

   3. Test Memory Persistence

      - Add a test memory
      - Open a new terminal
      - Load Claude
      - Ask lisa for recent memories
      - Verify test memory exists

   4. Test Tasks (if applicable)

      - Repeat steps 2 & 3 for "tasks" feature

---

