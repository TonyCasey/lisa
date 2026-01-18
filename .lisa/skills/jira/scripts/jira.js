#!/usr/bin/env node
"use strict";
/**
 * Jira CLI - thin entry point.
 *
 * Commands:
 *   node jira.js create --type <type> --project <key> --summary "..." [--description "..."] [--parent KEY] [--assign me]
 *   node jira.js list [--project <key>] [--jql "..."] [--mine] [--limit N]
 *   node jira.js view <issue-key>
 *   node jira.js assign <issue-key> --to <user|me>
 *   node jira.js transition <issue-key> --to "Status Name"
 *   node jira.js change-type <issue-key> --to <epic|story|task|subtask|bug>
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
function parseArgs(argv) {
    const args = {};
    let command = null;
    const positional = [];
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            const next = argv[i + 1];
            if (next && !next.startsWith('--')) {
                args[key] = next;
                i++;
            }
            else {
                args[key] = true;
            }
        }
        else if (!command) {
            command = arg;
        }
        else {
            positional.push(arg);
        }
    }
    return { command, args, positional };
}
async function main() {
    const { createJiraClient, loadJiraConfig } = await Promise.resolve().then(() => __importStar(require('../../shared/services')));
    try {
        const { command, args, positional } = parseArgs(process.argv);
        if (!command) {
            console.log(JSON.stringify({
                status: 'error',
                error: 'No command specified',
                usage: 'jira.js <create|list|view|assign|transition|change-type> [options]',
            }));
            process.exit(1);
        }
        const config = loadJiraConfig();
        const client = createJiraClient(config);
        let result;
        switch (command) {
            case 'create':
                if (!args.type || !args.project || !args.summary) {
                    throw new Error('create requires --type, --project, --summary');
                }
                const issue = await client.createIssue({
                    type: args.type,
                    project: args.project,
                    summary: args.summary,
                    description: args.description,
                    parent: args.parent,
                    assign: args.assign,
                });
                result = { status: 'ok', action: 'create', issue };
                break;
            case 'list':
                const listResult = await client.listIssues({
                    project: args.project,
                    jql: args.jql,
                    mine: args.mine === true,
                    limit: args.limit ? parseInt(args.limit) : undefined,
                });
                result = { status: 'ok', action: 'list', ...listResult };
                break;
            case 'view':
                const issueKey = positional[0] || args.issue;
                if (!issueKey)
                    throw new Error('Issue key required');
                const viewResult = await client.viewIssue(issueKey);
                result = { status: 'ok', action: 'view', issue: viewResult };
                break;
            case 'assign':
                const assignKey = positional[0] || args.issue;
                if (!assignKey || !args.to)
                    throw new Error('assign requires issue key and --to');
                const assignResult = await client.assignIssue(assignKey, { to: args.to });
                result = { status: 'ok', action: 'assign', ...assignResult };
                break;
            case 'transition':
                const transKey = positional[0] || args.issue;
                if (!transKey || !args.to)
                    throw new Error('transition requires issue key and --to');
                const transResult = await client.transitionIssue(transKey, { to: args.to });
                result = { status: 'ok', action: 'transition', ...transResult };
                break;
            case 'change-type':
                const changeKey = positional[0] || args.issue;
                if (!changeKey || !args.to)
                    throw new Error('change-type requires issue key and --to');
                const changeResult = await client.changeIssueType(changeKey, { to: args.to });
                result = { status: 'ok', action: 'change-type', issue: changeResult };
                break;
            default:
                result = {
                    status: 'error',
                    error: `Unknown command: ${command}`,
                    available: ['create', 'list', 'view', 'assign', 'transition', 'change-type'],
                };
        }
        console.log(JSON.stringify(result, null, 2));
    }
    catch (error) {
        console.log(JSON.stringify({
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
        }));
        process.exit(1);
    }
}
main();
//# sourceMappingURL=jira.js.map