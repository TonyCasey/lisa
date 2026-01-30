/**
 * Skill Passthrough Command Module
 *
 * Simple passthrough commands that delegate to skill scripts:
 * jira, github, prompt, bump-version, init-review, compile-skills
 */

import type {Command} from 'commander';
import path from 'path';
import {spawnAndWait} from './cli-utils';

export function registerSkillCommands(program: Command): void {
  // Subcommand: lisa jira
  program
    .command('jira')
    .description('Jira operations')
    .allowUnknownOption()
    .action(async (_opts, cmd) => {
      const args = cmd.args || [];
      const scriptPath = path.join(__dirname, '..', 'skills', 'jira', 'jira.js');
      await spawnAndWait(scriptPath, args);
    });

  // Subcommand: lisa github
  program
    .command('github')
    .description('GitHub Issues and Projects operations')
    .allowUnknownOption()
    .action(async (_opts, cmd) => {
      const args = cmd.args || [];
      const scriptPath = path.join(__dirname, '..', 'skills', 'github', 'github.js');
      await spawnAndWait(scriptPath, args);
    });

  // Subcommand: lisa prompt
  program
    .command('prompt')
    .description('Prompt operations')
    .allowUnknownOption()
    .action(async (_opts, cmd) => {
      const args = cmd.args || [];
      const scriptPath = path.join(__dirname, '..', 'skills', 'prompt', 'prompt.js');
      await spawnAndWait(scriptPath, args);
    });

  // Subcommand: lisa bump-version
  program
    .command('bump-version')
    .description('Bump package version')
    .allowUnknownOption()
    .action(async (_opts, cmd) => {
      const args = cmd.args || [];
      const scriptPath = path.join(__dirname, '..', 'skills', 'git', 'bump-version.js');
      await spawnAndWait(scriptPath, args);
    });

  // Subcommand: lisa init-review
  program
    .command('init-review')
    .description('Run initial codebase review')
    .allowUnknownOption()
    .action(async (_opts, cmd) => {
      const args = cmd.args || [];
      const scriptPath = path.join(__dirname, '..', 'skills', 'init-review', 'init-review.js');
      await spawnAndWait(scriptPath, args);
    });

  // Subcommand: lisa compile-skills
  program
    .command('compile-skills')
    .description('Compile skill extensions')
    .allowUnknownOption()
    .action(async (_opts, cmd) => {
      const args = cmd.args || [];
      const scriptPath = path.join(__dirname, '..', 'skills', 'lisa', 'compile-skills.js');
      await spawnAndWait(scriptPath, args);
    });
}
