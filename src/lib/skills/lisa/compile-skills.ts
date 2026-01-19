#!/usr/bin/env node
/**
 * Compile Skills CLI - thin entry point.
 *
 * Merges SKILL.local.md extensions with base SKILL.md files.
 *
 * Usage: node compile-skills.js [--dir <skills-dir>]
 */

export {};

import path from 'path';

async function main(): Promise<void> {
  const { createSkillCompilerService } = await import('../shared/services');

  const service = createSkillCompilerService();

  // Parse --dir argument
  const args = process.argv.slice(2);
  let skillsDir = path.join(process.cwd(), '.lisa', 'skills');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) {
      skillsDir = path.resolve(args[i + 1]);
      i++;
    }
  }

  const result = service.compile(skillsDir);

  console.log(JSON.stringify(result, null, 2));

  // Human-readable summary
  if (result.results.length === 0) {
    console.error('No SKILL.local.md files found.');
  } else {
    console.error(`\nCompiled ${result.merged} skill(s), skipped ${result.skipped}, errors ${result.errors}`);
    for (const r of result.results) {
      const icon = r.status === 'merged' ? '✓' : r.status === 'skipped' ? '⊘' : '✗';
      console.error(`  ${icon} ${r.skill}: ${r.message}`);
    }
  }
}

main();
