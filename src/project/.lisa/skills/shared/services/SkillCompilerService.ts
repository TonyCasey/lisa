/**
 * Skill compiler service - merges SKILL.local.md extensions with base SKILL.md files.
 */
import fs from 'fs';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface IParsedMarkdown {
  frontmatter: Record<string, string>;
  body: string;
}

export interface IMergeResult {
  skill: string;
  status: 'merged' | 'skipped' | 'error';
  message: string;
}

export interface ICompileResult {
  status: 'ok';
  action: 'compile-skills';
  skillsDir: string;
  results: IMergeResult[];
  merged: number;
  skipped: number;
  errors: number;
}

export interface ISkillCompilerService {
  parseMarkdownWithFrontmatter(content: string): IParsedMarkdown;
  mergeSkillFiles(baseContent: string, localContent: string): string;
  findSkillLocalFiles(skillsDir: string): string[];
  compile(skillsDir: string): ICompileResult;
}

/**
 * Creates a skill compiler service instance.
 */
export function createSkillCompilerService(): ISkillCompilerService {
  return {
    parseMarkdownWithFrontmatter(content: string): IParsedMarkdown {
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
    },

    mergeSkillFiles(baseContent: string, localContent: string): string {
      const base = this.parseMarkdownWithFrontmatter(baseContent);
      const local = this.parseMarkdownWithFrontmatter(localContent);

      const mergedFrontmatter = { ...base.frontmatter };
      for (const [key, value] of Object.entries(local.frontmatter)) {
        if (key !== 'extends') {
          if (key === 'description' && mergedFrontmatter.description) {
            mergedFrontmatter.description = `${mergedFrontmatter.description} ${value}`;
          } else {
            mergedFrontmatter[key] = value;
          }
        }
      }

      let merged = '---\n';
      for (const [key, value] of Object.entries(mergedFrontmatter)) {
        merged += `${key}: "${value}"\n`;
      }
      merged += '---\n';
      merged += base.body;

      if (local.body.trim()) {
        merged += '\n\n<!-- Local Extensions (from SKILL.local.md) -->\n\n';
        merged += local.body;
      }

      return merged;
    },

    findSkillLocalFiles(skillsDir: string): string[] {
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
    },

    compile(skillsDir: string): ICompileResult {
      const results: IMergeResult[] = [];
      const skillsWithLocal = this.findSkillLocalFiles(skillsDir);

      for (const skillName of skillsWithLocal) {
        const basePath = path.join(skillsDir, skillName, 'SKILL.md');
        const localPath = path.join(skillsDir, skillName, 'SKILL.local.md');

        if (!fs.existsSync(basePath)) {
          results.push({ skill: skillName, status: 'skipped', message: 'No base SKILL.md found' });
          continue;
        }

        try {
          const baseContent = fs.readFileSync(basePath, 'utf8');
          const localContent = fs.readFileSync(localPath, 'utf8');

          if (baseContent.includes('<!-- Local Extensions (from SKILL.local.md) -->')) {
            results.push({ skill: skillName, status: 'skipped', message: 'Already merged' });
            continue;
          }

          const merged = this.mergeSkillFiles(baseContent, localContent);
          fs.writeFileSync(basePath, merged, 'utf8');

          results.push({ skill: skillName, status: 'merged', message: 'Successfully merged' });
        } catch (err: unknown) {
          results.push({
            skill: skillName,
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return {
        status: 'ok',
        action: 'compile-skills',
        skillsDir,
        results,
        merged: results.filter((r) => r.status === 'merged').length,
        skipped: results.filter((r) => r.status === 'skipped').length,
        errors: results.filter((r) => r.status === 'error').length,
      };
    },
  };
}
