# Code Quality Rules & Error Prevention Guide

This document outlines the rules and configurations that prevent common errors from creeping into the codebase during development.

## Table of Contents
- [TypeScript Compiler Rules](#typescript-compiler-rules)
- [ESLint Rules](#eslint-rules)
- [Development Workflow](#development-workflow)
- [Error Categories Prevented](#error-categories-prevented)

---

## TypeScript Compiler Rules

### Location: `tsconfig.json`

These TypeScript compiler options catch errors at compile time:

### Type Safety Rules

```typescript
"noImplicitAny": true
```
**Prevents:** Using `any` type implicitly
**Example Error Caught:** Function parameters without types

```typescript
"strictNullChecks": true
```
**Prevents:** Null/undefined reference errors
**Example Error Caught:** Accessing properties on potentially null values

```typescript
"strictFunctionTypes": true
```
**Prevents:** Function type mismatch errors
**Example Error Caught:** Passing incompatible function signatures

```typescript
"noUncheckedIndexedAccess": true
```
**Prevents:** Array/object access without null checks
**Example Error Caught:** `array[0]` without checking if array has elements

### Code Quality Rules

```typescript
"noUnusedLocals": true
"noUnusedParameters": true
```
**Prevents:** Dead code and unused imports
**Example Error Caught:** Imported but never used variables

```typescript
"noImplicitReturns": true
```
**Prevents:** Functions missing return statements in some code paths
**Example Error Caught:** If/else blocks where only one returns a value

```typescript
"noFallthroughCasesInSwitch": true
```
**Prevents:** Unintentional fall-through in switch statements
**Example Error Caught:** Missing `break` statements in case blocks

---

## ESLint Rules

### Location: `.eslintrc.json`

These rules catch errors and enforce best practices:

### Type Safety Enforcement

```json
"@typescript-eslint/no-explicit-any": "error"
```
**Prevents:** Using `any` type (forces proper typing)
**Example Error Caught:**
```typescript
// ❌ Bad
function processData(data: any) { ... }

// ✅ Good
function processData(data: IMemoryItem) { ... }
```

```json
"@typescript-eslint/no-unsafe-assignment": "warn"
"@typescript-eslint/no-unsafe-member-access": "warn"
"@typescript-eslint/no-unsafe-call": "warn"
```
**Prevents:** Unsafe operations on `any` typed values
**Example Error Caught:** Calling methods on variables typed as `any`

### Async/Promise Safety

```json
"@typescript-eslint/no-floating-promises": "error"
```
**Prevents:** Forgetting to await promises
**Example Error Caught:**
```typescript
// ❌ Bad
async function getData() {
  fetchData(); // Promise not awaited
}

// ✅ Good
async function getData() {
  await fetchData();
}
```

```json
"@typescript-eslint/await-thenable": "error"
```
**Prevents:** Using await on non-promise values
**Example Error Caught:** `await someNumber`

```json
"@typescript-eslint/no-misused-promises": "error"
```
**Prevents:** Using promises in places that expect synchronous values
**Example Error Caught:** Passing async function to array.filter()

### Naming Conventions

```json
"@typescript-eslint/naming-convention": [
  "error",
  {
    "selector": "interface",
    "format": ["PascalCase"],
    "prefix": ["I"]
  }
]
```
**Prevents:** Inconsistent interface naming
**Example Error Caught:**
```typescript
// ❌ Bad
interface MemoryItem { ... }

// ✅ Good
interface IMemoryItem { ... }
```

### Code Quality

```json
"no-case-declarations": "error"
```
**Prevents:** Variable declarations in switch case blocks without braces
**Example Error Caught:**
```typescript
// ❌ Bad
switch (type) {
  case 'memory':
    const item = getMemory();
    break;
}

// ✅ Good
switch (type) {
  case 'memory': {
    const item = getMemory();
    break;
  }
}
```

```json
"prefer-rest-params": "error"
```
**Prevents:** Using `arguments` object instead of rest parameters
**Example Error Caught:**
```typescript
// ❌ Bad
function log() {
  console.log(arguments);
}

// ✅ Good
function log(...args: unknown[]) {
  console.log(args);
}
```

### Test File Overrides

Test files have relaxed rules for `any` usage:
```json
"overrides": [
  {
    "files": ["**/*.test.ts", "**/*.spec.ts", "**/tests/**/*.ts"],
    "rules": {
      "@typescript-eslint/no-explicit-any": "warn"
    }
  }
]
```

---

## Development Workflow

### Pre-Commit Checks

Run before every commit:
```bash
npm run pre-commit
```

This runs:
1. Type checking (`tsc --noEmit`)
2. Linting with auto-fix (`eslint --fix`)
3. Code formatting (`prettier --write`)

### Continuous Validation

Run to validate everything:
```bash
npm run validate
```

This runs:
1. Type checking
2. Linting
3. All tests

### Individual Commands

```bash
# Type check only
npm run type-check

# Lint only
npm run lint

# Lint with auto-fix
npm run lint:fix

# Format code
npm run format

# Build with type check
npm run build:check
```

---

## Error Categories Prevented

### 1. Import/Export Errors

**Problem:** Types imported but not re-exported from interface files

**Prevention:**
- Type checking catches missing exports
- ESLint catches unused imports

**Example:**
```typescript
// IGuardrail.ts
import { GuardrailType } from './IGuardrailService';

// Must re-export for other files to use
export { GuardrailType };
```

### 2. Missing Properties

**Problem:** Interface properties not provided in fixtures/mocks

**Prevention:**
- `strictPropertyInitialization` catches missing required properties
- Type checking enforces complete object literals

**Example:**
```typescript
interface IMemoryPattern {
  id: string;
  frequency: number;  // Required!
  metrics: { ... };   // Required!
}

// ❌ TypeScript error: Missing 'frequency' and 'metrics'
const pattern: IMemoryPattern = {
  id: '123'
};
```

### 3. Type Mismatches

**Problem:** Wrong types passed to functions

**Prevention:**
- `strictFunctionTypes` catches parameter type mismatches
- `noImplicitAny` forces explicit typing

**Example:**
```typescript
// ❌ Error caught at compile time
createSimpleTask({ type: 'test' }); // expects string, got object

// ✅ Correct
createSimpleTask('test');
```

### 4. Incomplete Mocks

**Problem:** Mock objects missing required methods

**Prevention:**
- Type checking against interface definitions
- `@typescript-eslint/no-unsafe-call` warns on missing methods

**Example:**
```typescript
// Interface defines 18 methods
interface IGuardrailService {
  analyzePatterns(...): Promise<...>;
  generateGuardrails(...): Promise<...>;
  // ... 16 more
}

// Mock must implement all methods or TypeScript error
const mock: IGuardrailService = {
  // Must include all 18 methods
};
```

### 5. Array/Object Safety

**Problem:** Accessing array elements or object properties that might not exist

**Prevention:**
- `noUncheckedIndexedAccess` forces null checks

**Example:**
```typescript
// With noUncheckedIndexedAccess
const items: string[] = [];
const first = items[0];  // Type: string | undefined

// Must check before using
if (first !== undefined) {
  console.log(first.toUpperCase());
}
```

### 6. Async/Promise Errors

**Problem:** Forgetting to await promises or misusing async functions

**Prevention:**
- `no-floating-promises` catches unawaited promises
- `await-thenable` catches invalid await usage

**Example:**
```typescript
// ❌ Error: Promise not handled
async function getData() {
  fetchData();  // ESLint error: floating promise
}

// ✅ Correct
async function getData() {
  await fetchData();
}
```

---

## IDE Integration

### VS Code Settings (`.vscode/settings.json`)

The project includes VS Code settings that:

1. **Auto-fix on save**: Runs ESLint fixes when you save
2. **Format on save**: Runs Prettier formatting
3. **Organize imports**: Removes unused imports automatically
4. **Type checking**: Shows TypeScript errors in real-time
5. **Hide generated files**: Excludes `.d.ts` files from explorer

### Required VS Code Extensions

- ESLint (`dbaeumer.vscode-eslint`)
- Prettier (`esbenp.prettier-vscode`)
- TypeScript and JavaScript Language Features (built-in)

---

## Git Hooks (Optional Setup)

To automatically run checks before commits, install husky:

```bash
npm install --save-dev husky lint-staged
npx husky init
```

Create `.husky/pre-commit`:
```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npm run pre-commit
```

---

## CI/CD Pipeline

For GitHub Actions, add `.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run type-check
      - run: npm run lint
      - run: npm test
```

---

## Summary Checklist

Before committing code, ensure:

- [ ] TypeScript compiles without errors (`npm run type-check`)
- [ ] ESLint passes without errors (`npm run lint`)
- [ ] All tests pass (`npm test`)
- [ ] Code is formatted (`npm run format`)
- [ ] No `any` types in production code
- [ ] All interfaces start with `I`
- [ ] All promises are awaited
- [ ] No unused variables or imports
- [ ] Switch cases use block scope `{ }`
- [ ] Mock objects include all required methods

---

## Quick Reference

| Error Type | Prevention Rule | Location |
|------------|----------------|----------|
| Missing exports | Type checking | tsconfig.json |
| Any types | `no-explicit-any` | .eslintrc.json |
| Missing properties | `strictPropertyInitialization` | tsconfig.json |
| Type mismatches | `strictFunctionTypes` | tsconfig.json |
| Unawaited promises | `no-floating-promises` | .eslintrc.json |
| Unused code | `noUnusedLocals` | tsconfig.json |
| Null safety | `strictNullChecks` | tsconfig.json |
| Array bounds | `noUncheckedIndexedAccess` | tsconfig.json |
| Switch declarations | `no-case-declarations` | .eslintrc.json |
| Arguments object | `prefer-rest-params` | .eslintrc.json |
