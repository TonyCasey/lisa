/**
 * Architectural tests to prevent handler duplication outside canonical locations.
 * 
 * These tests enforce the Single Handler Implementation Pattern (ADR-001).
 * All event handlers must live in src/lib/application/handlers/.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { globSync } from 'glob';
import fs from 'fs';

describe('Handler Architecture', () => {
  it('should not have handler implementations in hooks/ folder', () => {
    // Check for any *Handler.ts files in a hooks/ directory under src/lib
    const forbidden = globSync('src/lib/**/hooks/**/*Handler.ts');
    assert.strictEqual(
      forbidden.length,
      0,
      `Found forbidden handler files: ${forbidden.join(', ')}\n` +
      'Handlers must live in src/lib/application/handlers/ only.\n' +
      'See ADR-001-single-handler-pattern.md for details.'
    );
  });

  it('should not have duplicate handler class names', () => {
    const handlerFiles = globSync('src/lib/**/*Handler.ts');
    const classNames = new Map<string, string[]>();

    for (const file of handlerFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const matches = content.match(/export class (\w+Handler)/g) || [];
      
      for (const match of matches) {
        const className = match.replace('export class ', '');
        const existing = classNames.get(className) || [];
        existing.push(file);
        classNames.set(className, existing);
      }
    }

    const duplicates = Array.from(classNames.entries())
      .filter(([, files]) => files.length > 1);

    assert.strictEqual(
      duplicates.length,
      0,
      `Found duplicate handler classes:\n${
        duplicates.map(([name, files]) => `  ${name}: ${files.join(', ')}`).join('\n')
      }\n` +
      'Each handler should have exactly one implementation.\n' +
      'See ADR-001-single-handler-pattern.md for details.'
    );
  });

  it('should only have handlers in application layer', () => {
    // Find all *Handler.ts files not under application/
    const allHandlers = globSync('src/lib/**/*Handler.ts');
    const handlersOutsideApplication = allHandlers.filter(
      f => !f.includes('/application/')
    );

    assert.strictEqual(
      handlersOutsideApplication.length,
      0,
      `Found handlers outside application layer: ${handlersOutsideApplication.join(', ')}\n` +
      'Handlers belong in src/lib/application/handlers/\n' +
      'See ADR-001-single-handler-pattern.md for details.'
    );
  });

  it('should not have hook utilities duplicating handler logic', () => {
    // Check for common patterns that indicate handler logic in utility files
    const utilityFiles = globSync('src/lib/**/utils/**/*.ts');
    const suspiciousPatterns = [
      /class.*Handler/,
      /implements.*IRequestHandler/,
      /async handle\(/
    ];
    
    const violations: string[] = [];
    
    for (const file of utilityFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const pattern of suspiciousPatterns) {
        if (pattern.test(content)) {
          violations.push(`${file}: matches ${pattern}`);
          break; // Only report once per file
        }
      }
    }

    assert.strictEqual(
      violations.length,
      0,
      `Found utility files with handler-like patterns:\n${violations.join('\n')}\n` +
      'Utilities should not contain handler implementations.\n' +
      'Move handler logic to src/lib/application/handlers/'
    );
  });
});
