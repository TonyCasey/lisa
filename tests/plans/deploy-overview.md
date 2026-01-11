# Deployment Test Plan

This guide is about testing the lisa package install into different projects.

## Project test steps...
1. bump the appropiate version number
2. build the project in the main repo ~/Repos/lisa
2. publish the package to the local Verdaccio server
3. open a terminal to the destination project
    4. run npm install @tonycasey/lisa@xx.xx.xx (version)
    5. check lisa is accessible
    6. check lisa loaded memories
    7. check memories are specific to the destination project & sub folders
    8. add a test memory
    9. open a new terminal in the destination project
    10. load claude
    11. as lisa for recent memories
    12. check the test memory from step 8 exists
13. Repeat the 1-12 steps for tasks

For any issues found, return to the the ~/Repos/lisa terminal and do the following...

1. tell lisa to add a task about the bugs
2. for each bug
    3. find fix and apply it to the source code
    4. commit the fix
5. loop steps 2-4 until all bugs have been fixed.

Once all bugs have been fixed, go back to step 1 of the "project test steps" above and go through the steps..
i.e. build, publish, switch console, install, test