/**
 * Issue Command Module
 *
 * GitHub issue management with auto-labeling:
 * - create: Create issues with automatic label inference
 * - labels: Infer labels for content analysis
 */

import type {Command} from 'commander';
import chalk from 'chalk';
import {createLabelInferenceService} from '../infrastructure/services';

export function registerIssueCommands(issueCmd: Command): void {
  issueCmd
    .command('create')
    .description('Create a GitHub issue with automatic label inference')
    .requiredOption('-t, --title <title>', 'Issue title')
    .option('-b, --body <body>', 'Issue body')
    .option('-l, --label <labels...>', 'Explicit labels (skips auto-labeling for type)')
    .option('--no-auto-label', 'Disable automatic label inference')
    .option('-y, --yes', 'Skip confirmation, apply inferred labels automatically')
    .option('--dry-run', 'Show what would be created without creating')
    .action(async (opts) => {
      const title = opts.title;
      const body = opts.body || '';
      const explicitLabels: string[] = opts.label || [];
      const autoLabel = opts.autoLabel !== false;
      const skipConfirm = opts.yes || false;
      const dryRun = opts.dryRun || false;

      // Collect all labels
      const allLabels = [...explicitLabels];
      let inferredLabels: string[] = [];
      let reasons: Record<string, string> = {};

      // Auto-label if enabled and no explicit type labels provided
      if (autoLabel) {
        const service = createLabelInferenceService();
        const result = service.inferLabels(title, body);
        inferredLabels = result.labels;
        reasons = result.reasons;

        // Filter out labels that conflict with explicit labels
        const explicitTypes = explicitLabels.filter(l =>
          ['bug', 'enhancement', 'documentation', 'refactor', 'testing'].includes(l)
        );

        if (explicitTypes.length > 0) {
          // User specified a type label, don't override it
          inferredLabels = inferredLabels.filter(l =>
            !['bug', 'enhancement', 'documentation', 'refactor', 'testing'].includes(l)
          );
        }

        // Add non-duplicate inferred labels
        for (const label of inferredLabels) {
          if (!allLabels.includes(label)) {
            allLabels.push(label);
          }
        }
      }

      // Show what will be created
      console.log(chalk.bold('Issue to create:'));
      console.log(`  Title: ${chalk.cyan(title)}`);
      if (body) {
        const bodyPreview = body.length > 100 ? body.slice(0, 100) + '...' : body;
        console.log(`  Body: ${chalk.dim(bodyPreview)}`);
      }
      console.log('');

      if (explicitLabels.length > 0) {
        console.log(chalk.bold('Explicit labels:'));
        for (const label of explicitLabels) {
          console.log(`  ${chalk.green('+')} ${label}`);
        }
        console.log('');
      }

      if (inferredLabels.length > 0) {
        console.log(chalk.bold('Inferred labels:'));
        for (const label of inferredLabels) {
          const reason = reasons[label] || 'Pattern match';
          console.log(`  ${chalk.yellow('~')} ${label} ${chalk.dim(`(${reason})`)}`);
        }
        console.log('');
      }

      if (allLabels.length > 0) {
        console.log(chalk.bold('Final labels:'));
        console.log(`  ${allLabels.join(', ')}`);
        console.log('');
      }

      if (dryRun) {
        console.log(chalk.yellow('Dry run - no issue created'));
        return;
      }

      // Confirm if not skipping
      if (!skipConfirm && inferredLabels.length > 0) {
        const { confirm } = await import('@inquirer/prompts');
        const confirmed = await confirm({
          message: 'Create issue with these labels?',
          default: true,
        });

        if (!confirmed) {
          console.log(chalk.yellow('Cancelled'));
          return;
        }
      }

      // Build gh command
      const ghArgs = ['issue', 'create', '--title', title];

      if (body) {
        ghArgs.push('--body', body);
      }

      for (const label of allLabels) {
        ghArgs.push('--label', label);
      }

      // Execute gh command using spawnSync to avoid shell injection
      try {
        const { spawnSync } = await import('child_process');
        const result = spawnSync('gh', ghArgs, {
          encoding: 'utf8',
          stdio: ['inherit', 'pipe', 'inherit'],
          shell: false,
        });

        if (result.error) {
          throw result.error;
        }

        if (result.status !== 0) {
          throw new Error(`gh exited with code ${result.status}`);
        }

        console.log(chalk.green('Issue created:'), (result.stdout || '').trim());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red('Failed to create issue:'), message);
        process.exit(1);
      }
    });

  issueCmd
    .command('labels')
    .description('Infer labels for content without creating an issue')
    .requiredOption('-t, --title <title>', 'Issue title to analyze')
    .option('-b, --body <body>', 'Issue body to analyze')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      const service = createLabelInferenceService();
      const result = service.inferLabels(opts.title, opts.body || '');

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.labels.length === 0) {
          console.log(chalk.yellow('No labels inferred'));
        } else {
          console.log(chalk.bold('Inferred labels:'));
          for (const label of result.labels) {
            const reason = result.reasons[label] || 'Pattern match';
            console.log(`  ${chalk.green('+')} ${label}`);
            console.log(`    ${chalk.dim(reason)}`);
          }
          console.log('');
          console.log(`Confidence: ${(result.confidence * 100).toFixed(0)}%`);
        }
      }
    });
}
