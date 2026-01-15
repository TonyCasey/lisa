#!/usr/bin/env node
/**
 * Compile Skills - Merge SKILL.local.md extensions with base SKILL.md files
 *
 * Usage:
 *   node compile-skills.js [--dir <skills-dir>]
 *
 * This script:
 * 1. Finds all SKILL.local.md files in the skills directory
 * 2. Merges each with its corresponding SKILL.md
 * 3. Preserves the original SKILL.local.md for future updates
 *
 * Run this after creating or modifying SKILL.local.md files.
 */

export {}; // ensure module scope

const fs = require('fs');
const path = require('path');

interface ParsedMarkdown {
  frontmatter: Record<string, string>;
  body: string;
}

interface MergeResult {
  skill: string;
  status: 'merged' | 'skipped' | 'error';
  message: string;
}

/**
 * Parse YAML frontmatter from a markdown file.
 */
function parseMarkdownWithFrontmatter(content: string): ParsedMarkdown {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatter: Record<string, string> = {};
  const yamlLines = match[1].split(/\r?\n/);
  for (const line of yamlLines) {
    const kvMatch = line.match(/^(\w+):\s*"?([^"]*)"?$/);
    if (kvMatch) {
      frontmatter[kvMatch[1]] = kvMatch[2];
    }
  }

  return { frontmatter, body: match[2] };
}

/**
 * Merge a base SKILL.md with a SKILL.local.md extension.
 */
function mergeSkillFiles(baseContent: string, localContent: string): string {
  const base = parseMarkdownWithFrontmatter(baseContent);
  const local = parseMarkdownWithFrontmatter(localContent);

  // Merge frontmatter (local overrides base, except for 'extends')
  const mergedFrontmatter = { ...base.frontmatter };
  for (const [key, value] of Object.entries(local.frontmatter)) {
    if (key !== 'extends') {
      // Append to description if both have it
      if (key === 'description' && mergedFrontmatter.description) {
        mergedFrontmatter.description = `${mergedFrontmatter.description} ${value}`;
      } else {
        mergedFrontmatter[key] = value;
      }
    }
  }

  // Build merged content
  let merged = '---\n';
  for (const [key, value] of Object.entries(mergedFrontmatter)) {
    merged += `${key}: "${value}"\n`;
  }
  merged += '---\n';

  // Add base body
  merged += base.body;

  // Add separator and local body
  if (local.body.trim()) {
    merged += '\n\n<!-- Local Extensions (from SKILL.local.md) -->\n\n';
    merged += local.body;
  }

  return merged;
}

/**
 * Find all directories containing SKILL.local.md files
 */
function findSkillLocalFiles(skillsDir: string): string[] {
  const results: string[] = [];

  if (!fs.existsSync(skillsDir)) {
    return results;
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const localPath = path.join(skillsDir, entry.name, 'SKILL.local.md');
      if (fs.existsSync(localPath)) {
        results.push(entry.name);
      }
    }
  }

  return results;
}

/**
 * Compile (merge) all skill extensions
 */
function compileSkills(skillsDir: string): MergeResult[] {
  const results: MergeResult[] = [];
  const skillsWithLocal = findSkillLocalFiles(skillsDir);

  if (skillsWithLocal.length === 0) {
    return results;
  }

  for (const skillName of skillsWithLocal) {
    const basePath = path.join(skillsDir, skillName, 'SKILL.md');
    const localPath = path.join(skillsDir, skillName, 'SKILL.local.md');

    if (!fs.existsSync(basePath)) {
      results.push({
        skill: skillName,
        status: 'skipped',
        message: `No base SKILL.md found`,
      });
      continue;
    }

    try {
      const baseContent = fs.readFileSync(basePath, 'utf8');
      const localContent = fs.readFileSync(localPath, 'utf8');

      // Check if already merged (contains the marker comment)
      if (baseContent.includes('<!-- Local Extensions (from SKILL.local.md) -->')) {
        // Need to restore original base before re-merging
        // For now, skip if already merged
        results.push({
          skill: skillName,
          status: 'skipped',
          message: `Already merged (run after lisa update to re-merge)`,
        });
        continue;
      }

      const merged = mergeSkillFiles(baseContent, localContent);
      fs.writeFileSync(basePath, merged, 'utf8');

      results.push({
        skill: skillName,
        status: 'merged',
        message: `Successfully merged SKILL.local.md`,
      });
    } catch (err: any) {
      results.push({
        skill: skillName,
        status: 'error',
        message: err.message,
      });
    }
  }

  return results;
}

function main(): void {
  // Parse arguments
  const args = process.argv.slice(2);
  let skillsDir = path.join(process.cwd(), '.agents', 'skills');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) {
      skillsDir = path.resolve(args[i + 1]);
      i++;
    }
  }

  // Run compilation
  const results = compileSkills(skillsDir);

  // Output JSON for scripting
  const output = {
    status: 'ok',
    action: 'compile-skills',
    skillsDir,
    results,
    merged: results.filter((r) => r.status === 'merged').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    errors: results.filter((r) => r.status === 'error').length,
  };

  console.log(JSON.stringify(output, null, 2));

  // Human-readable summary to stderr
  if (results.length === 0) {
    console.error('No SKILL.local.md files found.');
  } else {
    console.error(`\nCompiled ${output.merged} skill(s), skipped ${output.skipped}, errors ${output.errors}`);
    for (const r of results) {
      const icon = r.status === 'merged' ? '✓' : r.status === 'skipped' ? '⊘' : '✗';
      console.error(`  ${icon} ${r.skill}: ${r.message}`);
    }
  }
}

main();
