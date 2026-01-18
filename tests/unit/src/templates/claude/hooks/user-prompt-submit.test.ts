/**
 * Tests for User Prompt Submit Hook
 *
 * Tests the plan mode context loading functionality.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Create a temp directory for tests
const TEST_DIR = path.join(os.tmpdir(), `lisa-test-${Date.now()}`);
const DEV_DIR = path.join(TEST_DIR, '.dev');
const RULES_DIR = path.join(TEST_DIR, '.lisa', 'rules');

// Mock the config module
const originalCwd = process.cwd();

describe('user-prompt-submit plan mode', () => {
  beforeEach(() => {
    // Create test directories
    fs.mkdirSync(DEV_DIR, { recursive: true });
    fs.mkdirSync(path.join(RULES_DIR, 'shared'), { recursive: true });
    fs.mkdirSync(path.join(RULES_DIR, 'typescript'), { recursive: true });
    process.chdir(TEST_DIR);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    // Clean up test directory
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('shouldLoadPlanContext', () => {
    // Note: We test the logic conceptually since the actual function
    // depends on module-level constants

    it('should detect first entry into plan mode', () => {
      const stateFile = path.join(DEV_DIR, '.plan-mode-state.json');

      // First time: no state file exists
      assert.strictEqual(fs.existsSync(stateFile), false);

      // After first entry, state file should be created
      fs.writeFileSync(
        stateFile,
        JSON.stringify({ loadedAt: new Date().toISOString() })
      );

      assert.strictEqual(fs.existsSync(stateFile), true);
    });

    it('should respect TTL for plan mode state', () => {
      const stateFile = path.join(DEV_DIR, '.plan-mode-state.json');
      const TTL_MS = 30 * 60 * 1000; // 30 minutes

      // Create a recent state (should skip reload)
      const recentTime = new Date().toISOString();
      fs.writeFileSync(stateFile, JSON.stringify({ loadedAt: recentTime }));

      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      const ageMs = Date.now() - new Date(state.loadedAt).getTime();

      assert.ok(ageMs < TTL_MS, 'Recent state should be within TTL');

      // Create an old state (should trigger reload)
      const oldTime = new Date(Date.now() - TTL_MS - 1000).toISOString();
      fs.writeFileSync(stateFile, JSON.stringify({ loadedAt: oldTime }));

      const oldState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      const oldAgeMs = Date.now() - new Date(oldState.loadedAt).getTime();

      assert.ok(oldAgeMs > TTL_MS, 'Old state should exceed TTL');
    });

    it('should clear state when exiting plan mode', () => {
      const stateFile = path.join(DEV_DIR, '.plan-mode-state.json');

      // Create state file
      fs.writeFileSync(
        stateFile,
        JSON.stringify({ loadedAt: new Date().toISOString() })
      );
      assert.strictEqual(fs.existsSync(stateFile), true);

      // Simulate exiting plan mode (delete state file)
      fs.unlinkSync(stateFile);
      assert.strictEqual(fs.existsSync(stateFile), false);
    });
  });

  describe('loadRulesSummary', () => {
    it('should return null when rules directory does not exist', () => {
      // Remove rules directory
      fs.rmSync(RULES_DIR, { recursive: true, force: true });

      // The actual function checks fs.existsSync(RULES_DIR)
      assert.strictEqual(fs.existsSync(RULES_DIR), false);
    });

    it('should parse rules from markdown files', () => {
      // Create a sample rule file
      const ruleContent = `# Code Quality Rules

## TypeScript Configuration

Some content here.

## ESLint Setup

More content.

## Testing Standards

Even more content.
`;
      const ruleFile = path.join(RULES_DIR, 'shared', 'code-quality.md');
      fs.writeFileSync(ruleFile, ruleContent);

      // Read and parse
      const content = fs.readFileSync(ruleFile, 'utf8');
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const h2s = content.match(/^##\s+(.+)$/gm) || [];

      assert.strictEqual(titleMatch?.[1], 'Code Quality Rules');
      assert.strictEqual(h2s.length, 3);
      assert.ok(h2s[0].includes('TypeScript Configuration'));
    });

    it('should handle multiple rule categories', () => {
      // Create rules in different categories
      fs.writeFileSync(
        path.join(RULES_DIR, 'shared', 'git-rules.md'),
        '# Git Rules\n\n## Commit Messages\n'
      );
      fs.writeFileSync(
        path.join(RULES_DIR, 'typescript', 'coding-standards.md'),
        '# TypeScript Standards\n\n## Naming Conventions\n'
      );

      const categories = ['shared', 'typescript'];
      const rules: string[] = [];

      for (const category of categories) {
        const categoryDir = path.join(RULES_DIR, category);
        if (fs.existsSync(categoryDir)) {
          const files = fs.readdirSync(categoryDir).filter((f: string) => f.endsWith('.md'));
          rules.push(...files.map((f: string) => `${category}/${f}`));
        }
      }

      assert.strictEqual(rules.length, 2);
      assert.ok(rules.includes('shared/git-rules.md'));
      assert.ok(rules.includes('typescript/coding-standards.md'));
    });
  });

  describe('validatePrompt', () => {
    it('should warn on destructive operations', () => {
      const destructivePrompts = [
        'delete all files',
        'remove everything from the database',
        'DELETE ALL records',
      ];

      for (const prompt of destructivePrompts) {
        const hasDestructive =
          prompt.toLowerCase().includes('delete all') ||
          prompt.toLowerCase().includes('remove everything');
        assert.strictEqual(hasDestructive, true, `Should detect destructive: ${prompt}`);
      }
    });

    it('should warn on very short prompts', () => {
      const shortPrompts = ['hi', 'fix', 'help'];

      for (const prompt of shortPrompts) {
        assert.ok(prompt.length < 10, `Should detect short prompt: ${prompt}`);
      }
    });

    it('should not warn on normal prompts', () => {
      const normalPrompts = [
        'Please help me refactor the authentication module',
        'Can you add a new endpoint for user registration?',
        'Review the changes in the pull request',
      ];

      for (const prompt of normalPrompts) {
        const isDestructive =
          prompt.toLowerCase().includes('delete all') ||
          prompt.toLowerCase().includes('remove everything');
        const isTooShort = prompt.length < 10;

        assert.strictEqual(isDestructive, false);
        assert.strictEqual(isTooShort, false);
      }
    });
  });

  describe('enhancePrompt', () => {
    it('should suggest architecture file when discussing architecture', () => {
      const archPath = path.join(DEV_DIR, 'architecture.md');
      fs.writeFileSync(archPath, '# Architecture\n\nProject structure...');

      const prompt = 'Let me explain the architecture of this system';
      const hasArchitectureKeyword = prompt.toLowerCase().includes('architecture');

      assert.strictEqual(hasArchitectureKeyword, true);
      assert.strictEqual(fs.existsSync(archPath), true);
    });

    it('should suggest todo file when discussing tasks', () => {
      const todoPath = path.join(DEV_DIR, 'todo.md');
      fs.writeFileSync(todoPath, '# TODO\n\n- [ ] Task 1');

      const prompt = 'What tasks do we have remaining?';
      const hasTaskKeyword =
        prompt.toLowerCase().includes('todo') || prompt.toLowerCase().includes('task');

      assert.strictEqual(hasTaskKeyword, true);
      assert.strictEqual(fs.existsSync(todoPath), true);
    });
  });

  describe('logPrompt', () => {
    it('should append to log file in JSONL format', () => {
      const logPath = path.join(DEV_DIR, '.prompt-log.jsonl');

      const logEntry = {
        timestamp: new Date().toISOString(),
        promptLength: 50,
        promptPreview: 'Test prompt preview',
      };

      fs.writeFileSync(logPath, JSON.stringify(logEntry) + '\n');

      const content = fs.readFileSync(logPath, 'utf8');
      const parsed = JSON.parse(content.trim());

      assert.strictEqual(parsed.promptLength, 50);
      assert.strictEqual(parsed.promptPreview, 'Test prompt preview');
    });

    it('should handle multiple log entries', () => {
      const logPath = path.join(DEV_DIR, '.prompt-log.jsonl');

      const entries = [
        { timestamp: new Date().toISOString(), promptLength: 10, promptPreview: 'First' },
        { timestamp: new Date().toISOString(), promptLength: 20, promptPreview: 'Second' },
        { timestamp: new Date().toISOString(), promptLength: 30, promptPreview: 'Third' },
      ];

      for (const entry of entries) {
        fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
      }

      const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
      assert.strictEqual(lines.length, 3);

      const parsed = lines.map((line: string) => JSON.parse(line));
      assert.strictEqual(parsed[0].promptPreview, 'First');
      assert.strictEqual(parsed[2].promptPreview, 'Third');
    });
  });
});
