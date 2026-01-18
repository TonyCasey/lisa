"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSkillCompilerService = createSkillCompilerService;
/**
 * Skill compiler service - merges SKILL.local.md extensions with base SKILL.md files.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/**
 * Creates a skill compiler service instance.
 */
function createSkillCompilerService() {
    return {
        parseMarkdownWithFrontmatter(content) {
            const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
            if (!match) {
                return { frontmatter: {}, body: content };
            }
            const frontmatter = {};
            const yamlLines = match[1].split(/\r?\n/);
            for (const line of yamlLines) {
                const kvMatch = line.match(/^(\w+):\s*"?([^"]*)"?$/);
                if (kvMatch) {
                    frontmatter[kvMatch[1]] = kvMatch[2];
                }
            }
            return { frontmatter, body: match[2] };
        },
        mergeSkillFiles(baseContent, localContent) {
            const base = this.parseMarkdownWithFrontmatter(baseContent);
            const local = this.parseMarkdownWithFrontmatter(localContent);
            const mergedFrontmatter = { ...base.frontmatter };
            for (const [key, value] of Object.entries(local.frontmatter)) {
                if (key !== 'extends') {
                    if (key === 'description' && mergedFrontmatter.description) {
                        mergedFrontmatter.description = `${mergedFrontmatter.description} ${value}`;
                    }
                    else {
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
        findSkillLocalFiles(skillsDir) {
            const results = [];
            if (!fs_1.default.existsSync(skillsDir)) {
                return results;
            }
            const entries = fs_1.default.readdirSync(skillsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const localPath = path_1.default.join(skillsDir, entry.name, 'SKILL.local.md');
                    if (fs_1.default.existsSync(localPath)) {
                        results.push(entry.name);
                    }
                }
            }
            return results;
        },
        compile(skillsDir) {
            const results = [];
            const skillsWithLocal = this.findSkillLocalFiles(skillsDir);
            for (const skillName of skillsWithLocal) {
                const basePath = path_1.default.join(skillsDir, skillName, 'SKILL.md');
                const localPath = path_1.default.join(skillsDir, skillName, 'SKILL.local.md');
                if (!fs_1.default.existsSync(basePath)) {
                    results.push({ skill: skillName, status: 'skipped', message: 'No base SKILL.md found' });
                    continue;
                }
                try {
                    const baseContent = fs_1.default.readFileSync(basePath, 'utf8');
                    const localContent = fs_1.default.readFileSync(localPath, 'utf8');
                    if (baseContent.includes('<!-- Local Extensions (from SKILL.local.md) -->')) {
                        results.push({ skill: skillName, status: 'skipped', message: 'Already merged' });
                        continue;
                    }
                    const merged = this.mergeSkillFiles(baseContent, localContent);
                    fs_1.default.writeFileSync(basePath, merged, 'utf8');
                    results.push({ skill: skillName, status: 'merged', message: 'Successfully merged' });
                }
                catch (err) {
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
//# sourceMappingURL=SkillCompilerService.js.map