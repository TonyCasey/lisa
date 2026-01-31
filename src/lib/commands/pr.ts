/**
 * PR Command Module
 *
 * PR workflow operations including:
 * - create, review, checks, comments, address
 * - watch, unwatch, link, remember, watching, status, poll
 * - cron management (install, uninstall, status)
 */

import type {Command} from 'commander';
import chalk from 'chalk';
import {withCorrelation} from '../infrastructure';
import type {Neo4jConnectionManager} from '../infrastructure/dal/connections';
import type {IPrPollOptions, IPrPollResult} from '../application/handlers';
import type {ILogger} from '../domain';
import {runPrWatchLoop} from './cli-utils';

/**
 * Format a poll result for console display.
 * Shared between pr create (watch loop) and pr poll.
 */
function printPollResult(result: IPrPollResult): void {
  console.log(chalk.bold(result.message));

  if (result.items.length > 0) {
    console.log('');
    for (const item of result.items) {
      if (item.error) {
        console.log(chalk.red(`  ❌ ${item.repo}#${item.number}: ${item.error}`));
      } else if (item.changes.length > 0) {
        for (const change of item.changes) {
          console.log(chalk.yellow(`  📢 ${item.repo}#${item.number}: ${change.description}`));
        }
        if (item.unwatched) {
          console.log(chalk.dim('     (unwatched)'));
        }
      } else {
        console.log(chalk.dim(`  ✓ ${item.repo}#${item.number}: no changes`));
      }
    }
  }

  if (result.logPath) {
    console.log('');
    console.log(chalk.dim(`Log: ${result.logPath}`));
  }

  if (result.addressOutput && result.addressOutput.length > 0) {
    console.log('');
    console.log(chalk.bold.cyan('--- Auto-Address Output ---'));
    for (const addr of result.addressOutput) {
      console.log('');
      console.log(addr.formattedOutput);
    }
  }
}

export function registerPrCommands(prCmd: Command, cliLogger: ILogger): void {
  prCmd
    .command('create')
    .description('Create a PR with auto-generated body and issue linking')
    .option('-i, --issue <numbers...>', 'Issue number(s) to link (comma-separated)')
    .option('-b, --base <branch>', 'Target branch (default: main/master)')
    .option('-t, --title <title>', 'PR title (default: from issue or first commit)')
    .option('-d, --draft', 'Create as draft PR')
    .option('--no-watch', 'Skip auto-watching the PR')
    .option('--no-comment', 'Skip commenting on linked issues')
    .option('--no-poll', 'Skip auto polling after PR creation')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      await withCorrelation(async () => {
        const log = cliLogger.child({ command: 'pr create' });
        log.info('Creating PR', { issues: opts.issue, base: opts.base, draft: opts.draft });

        let neo4jConnection: Neo4jConnectionManager | undefined;
        try {
          const { GithubClient, Neo4jPullRequestRepository, createNeo4jConnectionManager, McpClient, MemoryService } = await import('../infrastructure');
          const { PrCreateHandler, PrPollHandler } = await import('../application/handlers');

          const githubClient = new GithubClient();
          neo4jConnection = createNeo4jConnectionManager();
          const prRepository = new Neo4jPullRequestRepository(neo4jConnection);

          // Parse issue numbers
          let issues: number[] | undefined;
          if (opts.issue) {
            issues = opts.issue.flatMap((i: string) =>
              i.split(',').map((n: string) => parseInt(n.trim(), 10))
            ).filter((n: number) => !isNaN(n));
          }

          const handler = new PrCreateHandler(githubClient, prRepository);
          const result = await handler.execute({
            issues,
            base: opts.base,
            title: opts.title,
            draft: opts.draft,
            noWatch: opts.watch === false,
            noComment: opts.comment === false,
          });

          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
            if (!result.success) {
              process.exit(1);
            }
          } else if (result.success) {
            console.log(chalk.green(`✓ ${result.message}`));
            if (result.linkedIssues && result.linkedIssues.length > 0) {
              console.log(chalk.dim(`  Linked issues: ${result.linkedIssues.map((i: number) => `#${i}`).join(', ')}`));
            }
            if (result.pr) {
              console.log('');
              console.log(chalk.bold('PR Body:'));
              console.log(chalk.dim('─'.repeat(60)));
              console.log(result.body);
              console.log(chalk.dim('─'.repeat(60)));
            }
          } else {
            console.error(chalk.red(`✗ ${result.message}`));
            process.exit(1);
          }

          const shouldPoll = result.success
            && result.pr
            && opts.poll !== false
            && opts.watch !== false;

          if (shouldPoll && result.pr) {
            const { getCurrentGroupId } = await import('../skills/common/group-id');
            const mcpEndpoint = process.env.MCP_ENDPOINT || process.env.GRAPHITI_ENDPOINT || 'http://localhost:8000/mcp/';
            const mcpClient = new McpClient(mcpEndpoint, process.env.GRAPHITI_API_KEY);
            const memoryService = new MemoryService(mcpClient);
            const groupId = getCurrentGroupId();
            const pollHandler = new PrPollHandler(githubClient, prRepository, undefined, memoryService, groupId);
            const pollOptions: IPrPollOptions = {
              autoUnwatch: true,
              logToFile: true,
              autoAddress: true,
              prNumber: result.pr.number,
              repo: result.pr.repo,
              useLocalCache: true,
            };

            if (!opts.json) {
              console.log(chalk.cyan(`Starting PR watch for ${result.pr.repo}#${result.pr.number}...`));
            }

            await runPrWatchLoop({
              handler: pollHandler,
              pollOptions,
              intervalMinutes: 1,
              json: opts.json,
              printResult: printPollResult,
              stopOnResolved: false,
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error('Failed to create PR', { error: message });
          console.error(chalk.red(`Failed to create PR: ${message}`));
          process.exit(1);
        } finally {
          if (neo4jConnection) {
            await neo4jConnection.disconnect();
          }
        }
      });
    });

  prCmd
    .command('review')
    .description('Run local AI code review on current branch diff')
    .option('-b, --base <branch>', 'Base branch to diff against (default: main/master)')
    .option('--block', 'Exit non-zero if critical issues found')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      await withCorrelation(async () => {
        const log = cliLogger.child({ command: 'pr review' });
        log.info('Running PR review', { base: opts.base, block: opts.block });

        try {
          const { PrReviewHandler } = await import('../application/handlers');

          const handler = new PrReviewHandler();
          const result = await handler.execute({
            base: opts.base,
            block: opts.block,
            json: opts.json,
          });

          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
            if (result.shouldBlock) {
              process.exit(1);
            }
          } else {
            // Header
            console.log('');
            console.log(chalk.bold(`Reviewing changes: ${result.base}...HEAD (${result.filesChanged} files changed)`));
            console.log('');

            if (result.reviewError) {
              console.log(chalk.yellow(`⚠ ${result.reviewError}`));
              console.log(chalk.dim('Using fallback heuristic review...'));
              console.log('');
            }

            if (result.issues.length === 0 && result.passed.length === 0) {
              console.log(chalk.green('✓ No issues found'));
            } else {
              console.log(chalk.bold('## Review Summary'));
              console.log('');

              // Critical issues
              const critical = result.issues.filter((i: { severity: string }) => i.severity === 'critical');
              if (critical.length > 0) {
                console.log(chalk.red.bold(`### 🔴 Critical (must fix) - ${critical.length}`));
                for (const issue of critical) {
                  const location = issue.line ? `${issue.file}:${issue.line}` : issue.file;
                  console.log(chalk.red(`- ${location} - ${issue.message}`));
                }
                console.log('');
              }

              // Warnings
              const warnings = result.issues.filter((i: { severity: string }) => i.severity === 'warning');
              if (warnings.length > 0) {
                console.log(chalk.yellow.bold(`### 🟡 Warnings (should fix) - ${warnings.length}`));
                for (const issue of warnings) {
                  const location = issue.line ? `${issue.file}:${issue.line}` : issue.file;
                  console.log(chalk.yellow(`- ${location} - ${issue.message}`));
                }
                console.log('');
              }

              // Suggestions
              const suggestions = result.issues.filter((i: { severity: string }) => i.severity === 'suggestion');
              if (suggestions.length > 0) {
                console.log(chalk.cyan.bold(`### 🟢 Suggestions (nice to have) - ${suggestions.length}`));
                for (const issue of suggestions) {
                  const location = issue.line ? `${issue.file}:${issue.line}` : issue.file;
                  console.log(chalk.cyan(`- ${location} - ${issue.message}`));
                }
                console.log('');
              }

              // Passed checks
              if (result.passed.length > 0) {
                console.log(chalk.green.bold('### ✅ Passed'));
                for (const check of result.passed) {
                  console.log(chalk.green(`- ${check}`));
                }
                console.log('');
              }
            }

            // Summary line
            console.log(chalk.dim('─'.repeat(60)));
            console.log(`Result: ${chalk.red(`${result.counts.critical} critical`)}, ${chalk.yellow(`${result.counts.warning} warning`)}, ${chalk.cyan(`${result.counts.suggestion} suggestion`)}`);

            if (result.shouldBlock) {
              console.log('');
              console.log(chalk.red.bold('✗ Review failed: critical issues must be fixed before merge'));
              process.exit(1);
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error('Failed to run review', { error: message });
          console.error(chalk.red(`Failed to run review: ${message}`));
          process.exit(1);
        }
      });
    });

  prCmd
    .command('checks <pr-number>')
    .description('Get CI check status for a PR')
    .option('-r, --repo <repo>', 'Repository (owner/repo format)')
    .option('--json', 'Output as JSON')
    .option('--no-save', 'Do not save results to Neo4j')
    .action(async (prNumber: string, opts) => {
      await withCorrelation(async () => {
        const log = cliLogger.child({ command: 'pr checks' });
        log.info('Fetching PR checks', { prNumber, repo: opts.repo });

        let neo4jConnection: Neo4jConnectionManager | undefined;
        try {
          const { GithubClient, Neo4jPullRequestRepository, createNeo4jConnectionManager } = await import('../infrastructure');
          const { PrChecksHandler } = await import('../application/handlers');

          const githubClient = new GithubClient();
          neo4jConnection = createNeo4jConnectionManager();
          const prRepository = new Neo4jPullRequestRepository(neo4jConnection);

          const handler = new PrChecksHandler(githubClient, prRepository);
          const result = await handler.execute({
            prNumber: parseInt(prNumber, 10),
            repo: opts.repo,
            saveToNeo4j: opts.save !== false,
          });

          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(chalk.bold(`PR #${result.prNumber} Checks`));
            if (result.title) {
              console.log(chalk.dim(result.title));
            }
            console.log('');
            console.log(result.summary);
            console.log('');

            for (const check of result.checks) {
              const statusSymbol = {
                success: chalk.green('✓'),
                failure: chalk.red('✗'),
                pending: chalk.yellow('○'),
                cancelled: chalk.gray('○'),
                skipped: chalk.gray('-'),
              };
              console.log(`  ${statusSymbol[check.status]} ${check.name}`);
              if (check.detailsUrl && check.status === 'failure') {
                console.log(`    ${chalk.dim(check.detailsUrl)}`);
              }
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error('Failed to fetch PR checks', { error: message });
          console.error(chalk.red(`Failed to fetch checks: ${message}`));
          process.exit(1);
        } finally {
          if (neo4jConnection) {
            await neo4jConnection.disconnect();
          }
        }
      });
    });

  prCmd
    .command('comments <pr-number>')
    .description('Fetch and display PR review comments')
    .option('-r, --repo <repo>', 'Repository (owner/repo format)')
    .option('-f, --filter <status>', 'Filter by status (pending, addressed, resolved)')
    .option('--json', 'Output as JSON')
    .option('--no-save', 'Do not save results to Neo4j')
    .action(async (prNumber: string, opts) => {
      await withCorrelation(async () => {
        const log = cliLogger.child({ command: 'pr comments' });
        log.info('Fetching PR comments', { prNumber, repo: opts.repo, filter: opts.filter });

        let neo4jConnection: Neo4jConnectionManager | undefined;
        try {
          const { GithubClient, Neo4jPullRequestRepository, createNeo4jConnectionManager } = await import('../infrastructure');
          const { PrCommentsHandler } = await import('../application/handlers');

          const githubClient = new GithubClient();
          neo4jConnection = createNeo4jConnectionManager();
          const prRepository = new Neo4jPullRequestRepository(neo4jConnection);

          const handler = new PrCommentsHandler(githubClient, prRepository);
          const result = await handler.execute({
            prNumber: parseInt(prNumber, 10),
            repo: opts.repo,
            filter: opts.filter,
            saveToNeo4j: opts.save !== false,
          });

          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(result.formattedOutput);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error('Failed to fetch PR comments', { error: message });
          console.error(chalk.red(`Failed to fetch comments: ${message}`));
          process.exit(1);
        } finally {
          if (neo4jConnection) {
            await neo4jConnection.disconnect();
          }
        }
      });
    });

  prCmd
    .command('address <pr-number>')
    .description('Fetch pending comments and prepare them for addressing')
    .option('-r, --repo <repo>', 'Repository (owner/repo format)')
    .option('--include-resolved', 'Include already resolved comments')
    .option('-c, --context <lines>', 'Lines of code context (default: 10)', '10')
    .option('--json', 'Output as JSON')
    .action(async (prNumber: string, opts) => {
      await withCorrelation(async () => {
        const log = cliLogger.child({ command: 'pr address' });
        log.info('Preparing PR comments for addressing', { prNumber, repo: opts.repo });

        let neo4jConnection: Neo4jConnectionManager | undefined;
        try {
          const { GithubClient, Neo4jPullRequestRepository, createNeo4jConnectionManager } = await import('../infrastructure');
          const { PrAddressHandler } = await import('../application/handlers');

          const githubClient = new GithubClient();
          neo4jConnection = createNeo4jConnectionManager();
          const prRepository = new Neo4jPullRequestRepository(neo4jConnection);

          const handler = new PrAddressHandler(githubClient, prRepository);
          const result = await handler.execute({
            prNumber: parseInt(prNumber, 10),
            repo: opts.repo,
            includeResolved: opts.includeResolved,
            codeContextLines: parseInt(opts.context, 10),
          });

          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(result.formattedOutput);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error('Failed to prepare PR comments', { error: message });
          console.error(chalk.red(`Failed to prepare comments: ${message}`));
          process.exit(1);
        } finally {
          if (neo4jConnection) {
            await neo4jConnection.disconnect();
          }
        }
      });
    });

  prCmd
    .command('watch <pr-number>')
    .description('Start watching a PR for updates')
    .option('-r, --repo <repo>', 'Repository (owner/repo format)')
    .action(async (prNumber: string, opts) => {
      await withCorrelation(async () => {
        const log = cliLogger.child({ command: 'pr watch' });
        log.info('Watching PR', { prNumber, repo: opts.repo });

        let neo4jConnection: Neo4jConnectionManager | undefined;
        try {
          const { GithubClient, Neo4jPullRequestRepository, createNeo4jConnectionManager } = await import('../infrastructure');
          const { PrWatchHandler } = await import('../application/handlers');

          const githubClient = new GithubClient();
          neo4jConnection = createNeo4jConnectionManager();
          const prRepository = new Neo4jPullRequestRepository(neo4jConnection);

          const handler = new PrWatchHandler(githubClient, prRepository);
          const result = await handler.watch({
            prNumber: parseInt(prNumber, 10),
            repo: opts.repo,
          });

          if (result.success) {
            console.log(chalk.green(result.message));
          } else {
            console.error(chalk.red(result.message));
            process.exit(1);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error('Failed to watch PR', { error: message });
          console.error(chalk.red(`Failed to watch PR: ${message}`));
          process.exit(1);
        } finally {
          if (neo4jConnection) {
            await neo4jConnection.disconnect();
          }
        }
      });
    });

  prCmd
    .command('unwatch <pr-number>')
    .description('Stop watching a PR')
    .option('-r, --repo <repo>', 'Repository (owner/repo format)')
    .action(async (prNumber: string, opts) => {
      await withCorrelation(async () => {
        const log = cliLogger.child({ command: 'pr unwatch' });
        log.info('Unwatching PR', { prNumber, repo: opts.repo });

        let neo4jConnection: Neo4jConnectionManager | undefined;
        try {
          const { GithubClient, Neo4jPullRequestRepository, createNeo4jConnectionManager } = await import('../infrastructure');
          const { PrWatchHandler } = await import('../application/handlers');

          const githubClient = new GithubClient();
          neo4jConnection = createNeo4jConnectionManager();
          const prRepository = new Neo4jPullRequestRepository(neo4jConnection);

          const handler = new PrWatchHandler(githubClient, prRepository);
          const result = await handler.unwatch({
            prNumber: parseInt(prNumber, 10),
            repo: opts.repo,
          });

          if (result.success) {
            console.log(chalk.green(result.message));
          } else {
            console.error(chalk.red(result.message));
            process.exit(1);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error('Failed to unwatch PR', { error: message });
          console.error(chalk.red(`Failed to unwatch PR: ${message}`));
          process.exit(1);
        } finally {
          if (neo4jConnection) {
            await neo4jConnection.disconnect();
          }
        }
      });
    });

  prCmd
    .command('link <pr-number> <issue-number>')
    .description('Link a PR to an issue (creates CLOSES relationship)')
    .option('-r, --repo <repo>', 'Repository (owner/repo format)')
    .option('--no-comment', 'Skip commenting on the GitHub issue')
    .option('--json', 'Output as JSON')
    .action(async (prNumber: string, issueNumber: string, opts) => {
      await withCorrelation(async () => {
        const log = cliLogger.child({ command: 'pr link' });

        // Validate PR and issue numbers before proceeding
        const parsedPrNumber = parseInt(prNumber, 10);
        const parsedIssueNumber = parseInt(issueNumber, 10);
        if (!Number.isFinite(parsedPrNumber) || parsedPrNumber <= 0 ||
            !Number.isFinite(parsedIssueNumber) || parsedIssueNumber <= 0) {
          console.error(chalk.red('PR and Issue numbers must be positive integers.'));
          process.exit(1);
        }

        log.info('Linking PR to issue', { prNumber: parsedPrNumber, issueNumber: parsedIssueNumber, repo: opts.repo });

        let neo4jConnection: Neo4jConnectionManager | undefined;
        try {
          const { GithubClient, Neo4jPullRequestRepository, createNeo4jConnectionManager } = await import('../infrastructure');
          const { PrLinkHandler } = await import('../application/handlers');

          const githubClient = new GithubClient();
          neo4jConnection = createNeo4jConnectionManager();
          const prRepository = new Neo4jPullRequestRepository(neo4jConnection);

          const handler = new PrLinkHandler(githubClient, prRepository);
          const result = await handler.execute({
            prNumber: parsedPrNumber,
            issueNumber: parsedIssueNumber,
            repo: opts.repo,
            noComment: opts.comment === false,
          });

          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
            if (!result.success) {
              process.exit(1);
            }
          } else if (result.success) {
            if (result.alreadyLinked) {
              console.log(chalk.yellow(`⚠ PR #${prNumber} is already linked to Issue #${issueNumber}`));
            } else {
              console.log(chalk.green(`✓ Linked PR #${prNumber} to Issue #${issueNumber}`));
              if (result.pr) {
                console.log(chalk.dim(`  PR: ${result.pr.url}`));
              }
              if (result.issue) {
                console.log(chalk.dim(`  Issue: ${result.issue.url}`));
              }
            }
          } else {
            console.error(chalk.red(`✗ ${result.message}`));
            process.exit(1);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error('Failed to link PR to issue', { error: message });
          console.error(chalk.red(`Failed to link: ${message}`));
          process.exit(1);
        } finally {
          if (neo4jConnection) {
            await neo4jConnection.disconnect();
          }
        }
      });
    });

  prCmd
    .command('remember <pr-number> <note>')
    .description('Save a note about a PR to memory')
    .option('-r, --repo <repo>', 'Repository (owner/repo format)')
    .option('--json', 'Output as JSON')
    .action(async (prNumber: string, note: string, opts) => {
      await withCorrelation(async () => {
        const log = cliLogger.child({ command: 'pr remember' });

        const parsedPrNumber = parseInt(prNumber, 10);
        if (!Number.isFinite(parsedPrNumber) || parsedPrNumber <= 0) {
          console.error(chalk.red('PR number must be a positive integer.'));
          process.exit(1);
        }

        log.info('Saving PR note', { prNumber: parsedPrNumber, repo: opts.repo });

        try {
          const { GithubClient, MemoryService, McpClient } = await import('../infrastructure');
          const { PrRememberHandler } = await import('../application/handlers');
          const { getCurrentGroupId } = await import('../skills/common/group-id');

          const githubClient = new GithubClient();
          const mcpEndpoint = process.env.MCP_ENDPOINT || process.env.GRAPHITI_ENDPOINT || 'http://localhost:8000/mcp/';
          const mcpClient = new McpClient(mcpEndpoint, process.env.GRAPHITI_API_KEY);
          const memoryService = new MemoryService(mcpClient);
          const groupId = getCurrentGroupId();

          const handler = new PrRememberHandler(githubClient, memoryService, groupId);
          const result = await handler.execute({
            prNumber: parsedPrNumber,
            repo: opts.repo,
            note,
          });

          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
            if (!result.success) {
              process.exit(1);
            }
          } else if (result.success) {
            console.log(chalk.green(`✓ ${result.message}`));
            if (result.fact) {
              console.log(chalk.dim(`  Fact: ${result.fact}`));
            }
            if (result.tags) {
              console.log(chalk.dim(`  Tags: ${result.tags.join(', ')}`));
            }
          } else {
            console.error(chalk.red(`✗ ${result.message}`));
            process.exit(1);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error('Failed to save PR note', { error: message });
          console.error(chalk.red(`Failed to save PR note: ${message}`));
          process.exit(1);
        }
      });
    });

  prCmd
    .command('watching')
    .description('List all PRs being watched')
    .option('-r, --repo <repo>', 'Filter by repository (owner/repo format)')
    .option('-l, --limit <n>', 'Max results', '20')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      await withCorrelation(async () => {
        const log = cliLogger.child({ command: 'pr watching' });
        log.info('Listing watched PRs', { repo: opts.repo });

        let neo4jConnection: Neo4jConnectionManager | undefined;
        try {
          const { GithubClient, Neo4jPullRequestRepository, createNeo4jConnectionManager } = await import('../infrastructure');
          const { PrWatchHandler } = await import('../application/handlers');

          const githubClient = new GithubClient();
          neo4jConnection = createNeo4jConnectionManager();
          const prRepository = new Neo4jPullRequestRepository(neo4jConnection);

          const handler = new PrWatchHandler(githubClient, prRepository);
          const result = await handler.list({
            repo: opts.repo,
            limit: parseInt(opts.limit, 10),
          });

          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(chalk.bold(result.message));
            console.log('');

            if (result.watchedPrs && result.watchedPrs.length > 0) {
              for (const pr of result.watchedPrs) {
                const statusEmoji = {
                  open: '🟢',
                  merged: '🟣',
                  closed: '⚪',
                };
                const checksEmoji = {
                  success: '✅',
                  failure: '❌',
                  pending: '⏳',
                  cancelled: '⚪',
                  skipped: '⚪',
                };

                console.log(`${statusEmoji[pr.status]} #${pr.number} ${pr.title}`);
                console.log(`   ${chalk.dim(pr.repo)} ${checksEmoji[pr.checksStatus]} ${pr.unresolvedComments > 0 ? `💬${pr.unresolvedComments}` : ''}`);
              }
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error('Failed to list watched PRs', { error: message });
          console.error(chalk.red(`Failed to list watched PRs: ${message}`));
          process.exit(1);
        } finally {
          if (neo4jConnection) {
            await neo4jConnection.disconnect();
          }
        }
      });
    });

  prCmd
    .command('status')
    .description('Show status summary of all watched PRs')
    .option('-r, --repo <repo>', 'Filter by repository (owner/repo format)')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      await withCorrelation(async () => {
        const log = cliLogger.child({ command: 'pr status' });
        log.info('Getting PR status summary', { repo: opts.repo });

        let neo4jConnection: Neo4jConnectionManager | undefined;
        try {
          const { Neo4jPullRequestRepository, createNeo4jConnectionManager } = await import('../infrastructure');
          const { PrStatusHandler } = await import('../application/handlers');

          neo4jConnection = createNeo4jConnectionManager();
          const prRepository = new Neo4jPullRequestRepository(neo4jConnection);

          const handler = new PrStatusHandler(prRepository);
          const result = await handler.execute({
            repo: opts.repo,
          });

          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
            if (!result.success) {
              process.exit(1);
            }
          } else if (result.success) {
            console.log(result.formattedOutput);
          } else {
            console.error(chalk.red(result.message));
            process.exit(1);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error('Failed to get PR status', { error: message });
          console.error(chalk.red(`Failed to get PR status: ${message}`));
          process.exit(1);
        } finally {
          if (neo4jConnection) {
            await neo4jConnection.disconnect();
          }
        }
      });
    });

  prCmd
    .command('poll')
    .description('Poll all watched PRs for state changes (for cron)')
    .option('--no-auto-unwatch', 'Do not auto-unwatch merged/closed PRs')
    .option('--no-log', 'Do not write to log file')
    .option('-c, --concurrency <n>', 'Max concurrent GitHub API calls', '5')
    .option('--notify', 'Send desktop notifications for state changes')
    .option('--no-auto-address', 'Do not auto-address new comments')
    .option('--watch', 'Watch a single PR in the foreground')
    .option('--pr <number>', 'Poll a specific PR number')
    .option('--current', 'Use current PR from branch')
    .option('-i, --interval <minutes>', 'Polling interval in minutes', '1')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      await withCorrelation(async () => {
        const log = cliLogger.child({ command: 'pr poll' });
        log.info('Polling watched PRs');

        let neo4jConnection: Neo4jConnectionManager | undefined;
        try {
          const { GithubClient, Neo4jPullRequestRepository, createNeo4jConnectionManager, MemoryService, McpClient } = await import('../infrastructure');
          const { PrPollHandler } = await import('../application/handlers');
          const { NotificationService } = await import('../infrastructure/notifications');
          const { getCurrentGroupId } = await import('../skills/common/group-id');

          const githubClient = new GithubClient();
          neo4jConnection = createNeo4jConnectionManager();
          const prRepository = new Neo4jPullRequestRepository(neo4jConnection);

          const parsedConcurrency = parseInt(opts.concurrency, 10);
          const parsedInterval = parseInt(opts.interval, 10);
          const prNumber = opts.pr ? parseInt(opts.pr, 10) : undefined;

          if (opts.pr && !Number.isFinite(prNumber)) {
            console.error(chalk.red('Invalid PR number. Must be a number.'));
            process.exit(1);
          }

          if (opts.watch && !Number.isFinite(parsedInterval)) {
            console.error(chalk.red('Invalid interval. Must be a number of minutes.'));
            process.exit(1);
          }

          if (opts.watch && parsedInterval < 1) {
            console.error(chalk.red('Invalid interval. Must be at least 1 minute.'));
            process.exit(1);
          }

          if (opts.pr && opts.current) {
            console.error(chalk.red('Use either --pr or --current, not both.'));
            process.exit(1);
          }

          if (opts.watch && !opts.pr && !opts.current) {
            console.error(chalk.red('Watch mode requires --pr <number> or --current.'));
            process.exit(1);
          }

          // Create notification service if --notify flag is set (disabled in watch mode)
          const notificationService = opts.notify && !opts.watch ? new NotificationService() : undefined;

          // Create memory service for auto-capture of merged PRs
          const mcpEndpoint = process.env.MCP_ENDPOINT || process.env.GRAPHITI_ENDPOINT || 'http://localhost:8000/mcp/';
          const mcpClient = new McpClient(mcpEndpoint, process.env.GRAPHITI_API_KEY);
          const memoryService = new MemoryService(mcpClient);
          const groupId = getCurrentGroupId();

          const handler = new PrPollHandler(githubClient, prRepository, notificationService, memoryService, groupId);
          const pollOptions = {
            autoUnwatch: opts.autoUnwatch,
            logToFile: opts.log,
            concurrency: Number.isFinite(parsedConcurrency) ? parsedConcurrency : 5,
            notify: opts.notify && !opts.watch,
            autoAddress: opts.autoAddress,
            prNumber: prNumber,
            current: opts.current,
            useLocalCache: opts.watch,
          };

          if (opts.watch) {
            await runPrWatchLoop({
              handler,
              pollOptions,
              intervalMinutes: parsedInterval,
              json: opts.json,
              printResult: printPollResult,
              stopOnResolved: true,
            });
          } else {
            const result = await handler.poll(pollOptions);

            if (opts.json) {
              console.log(JSON.stringify(result, null, 2));
            } else {
              printPollResult(result);
            }

            if (!result.success) {
              process.exit(1);
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error('Failed to poll PRs', { error: message });
          console.error(chalk.red(`Failed to poll PRs: ${message}`));
          process.exit(1);
        } finally {
          if (neo4jConnection) {
            await neo4jConnection.disconnect();
          }
        }
      });
    });

  // Subcommand: lisa pr cron
  const prCronCmd = prCmd
    .command('cron')
    .description('Manage PR polling cron job');

  prCronCmd
    .command('install')
    .description('Install cron job for PR polling')
    .option('--notify', 'Enable desktop notifications', true)
    .option('--no-notify', 'Disable desktop notifications')
    .option('-i, --interval <minutes>', 'Polling interval in minutes', '5')
    .action(async (opts) => {
      await withCorrelation(async () => {
        const log = cliLogger.child({ command: 'pr cron install' });
        log.info('Installing PR polling cron job');

        try {
          const { CronService } = await import('../infrastructure/cron');
          const cronService = new CronService();

          const intervalMinutes = parseInt(opts.interval, 10);
          if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) {
            console.error(chalk.red('Invalid interval. Must be at least 1 minute.'));
            process.exit(1);
          }

          const result = await cronService.install({
            name: 'lisa-pr-poll',
            command: 'lisa pr poll',
            intervalMinutes,
            notify: opts.notify,
          });

          if (result.success) {
            const notifyStr = opts.notify ? ' --notify' : '';
            console.log(chalk.green(`Installed ${result.platform} job: lisa pr poll${notifyStr}`));
            console.log(chalk.green(`Polling every ${intervalMinutes} minute(s).`));
            console.log('');
            console.log(chalk.cyan('PR monitoring is now active.'));
            console.log(chalk.cyan('Use `lisa pr watch <number>` to start tracking PRs.'));
          } else {
            console.error(chalk.red(`Failed to install: ${result.error}`));
            if (result.manualInstructions) {
              console.log('');
              console.log(chalk.cyan('Manual installation:'));
              console.log(result.manualInstructions);
            }
            process.exit(1);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error('Failed to install cron job', { error: message });
          console.error(chalk.red(`Failed to install: ${message}`));
          process.exit(1);
        }
      });
    });

  prCronCmd
    .command('uninstall')
    .description('Remove PR polling cron job')
    .action(async () => {
      await withCorrelation(async () => {
        const log = cliLogger.child({ command: 'pr cron uninstall' });
        log.info('Uninstalling PR polling cron job');

        try {
          const { CronService } = await import('../infrastructure/cron');
          const cronService = new CronService();

          const result = await cronService.uninstall();

          if (result.success) {
            console.log(chalk.green('PR polling cron job removed.'));
          } else {
            console.error(chalk.red(`Failed to uninstall: ${result.error}`));
            process.exit(1);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error('Failed to uninstall cron job', { error: message });
          console.error(chalk.red(`Failed to uninstall: ${message}`));
          process.exit(1);
        }
      });
    });

  prCronCmd
    .command('status')
    .description('Check PR polling cron job status')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      await withCorrelation(async () => {
        const log = cliLogger.child({ command: 'pr cron status' });
        log.info('Checking PR polling cron job status');

        try {
          const { CronService } = await import('../infrastructure/cron');
          const cronService = new CronService();

          const platform = cronService.getPlatform();
          const status = await cronService.isInstalled();
          const config = await cronService.getConfig();

          if (opts.json) {
            console.log(JSON.stringify({ platform, status, config }, null, 2));
          } else {
            console.log(`Platform: ${platform}`);
            console.log(`Status: ${status}`);
            if (config) {
              console.log(`Enabled: ${config.enabled}`);
              console.log(`Interval: ${config.intervalMinutes} minutes`);
              console.log(`Notifications: ${config.notify ? 'enabled' : 'disabled'}`);
              console.log(`Setup: ${config.setupAt}`);
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.error('Failed to check status', { error: message });
          console.error(chalk.red(`Failed to check status: ${message}`));
          process.exit(1);
        }
      });
    });
}
