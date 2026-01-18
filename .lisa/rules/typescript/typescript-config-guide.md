# TypeScript Configuration Guide
## Avoiding Common Errors in Development

This guide documents lessons learned from resolving 300+ TypeScript errors in the ai-refactor-framework project.

---

## 🎯 Core Principles

### 1. **Separate Production and Test Configurations**
```
✅ GOOD: Different strictness levels for different contexts
❌ BAD: One config for everything
```

### 2. **Relaxed Settings During Active Development**
```
✅ GOOD: Enable strict mode when stabilizing for production
❌ BAD: Ultra-strict from day one (blocks rapid iteration)
```

### 3. **Explicit Exclusions**
```
✅ GOOD: Explicitly exclude examples, tests, demos
❌ BAD: Let TypeScript check everything
```

---

## 📋 Recommended tsconfig.json Settings

### For Main Project (src/)

```json
{
  "compilerOptions": {
    // Target & Module
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "moduleResolution": "node",

    // Output
    "outDir": "./dist",
    "sourceMap": true,
    "declaration": true,

    // Strictness - RELAXED for development
    "strict": false,                          // 🔑 Master switch
    "noImplicitAny": false,                   // 🔑 Allow 'any' during prototyping
    "strictNullChecks": false,                // 🔑 Don't require null checks everywhere
    "strictPropertyInitialization": false,    // 🔑 Don't require all properties initialized
    "noUnusedLocals": false,                  // 🔑 Allow unused variables
    "noUnusedParameters": false,              // 🔑 Allow unused parameters

    // Keep these enabled - they catch real bugs
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,

    // Performance
    "skipLibCheck": true,                     // 🔑 Skip checking node_modules
    "forceConsistentCasingInFileNames": true,

    // Interop
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,

    // Paths
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },

  // 🔑 Explicit include
  "include": [
    "src/**/*"
  ],

  // 🔑 Explicit exclude
  "exclude": [
    "node_modules",
    "dist",
    "**/*.test.ts",
    "**/*.spec.ts",
    "tests",
    "examples",
    "services",
    "packages"
  ]
}
```

### For Test Files (tsconfig.test.json)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,

    // EXTRA RELAXED for tests
    "strict": false,
    "noImplicitAny": false,
    "strictNullChecks": false,
    "strictPropertyInitialization": false,
    "noUnusedLocals": false,
    "noUnusedParameters": false
  },
  "include": [
    "src/**/*",
    "tests/**/*"
  ],
  "exclude": [
    "node_modules",
    "dist"
  ]
}
```

### For Monorepo Packages

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",

    // 🔑 KEY: No rootDir if importing from other packages
    // "rootDir": "./src",  ❌ CAUSES ERRORS

    "strict": false,
    "skipLibCheck": true,
    "esModuleInterop": true,

    // Paths relative to project root
    "baseUrl": "../../..",
    "paths": {
      "@/*": ["src/*"],
      "@/services/agents/base-agent/*": ["services/agents/base-agent/src/*"]
    },

    // Relaxed for development
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "strictNullChecks": false,
    "noImplicitAny": false
  },
  "include": ["src/**/*"],
  "exclude": [
    "node_modules",
    "dist",
    "**/*.test.ts",
    "**/*.spec.ts",
    "src/examples/**/*",    // 🔑 Exclude examples
    "src/tests/**/*"        // 🔑 Exclude package tests
  ]
}
```

---

## 🚫 Settings That Cause Problems

### ❌ AVOID During Active Development:

```json
{
  "compilerOptions": {
    // These will block you constantly:
    "strict": true,                        // ❌ Too strict for prototyping
    "noImplicitAny": true,                 // ❌ Forces explicit types everywhere
    "strictNullChecks": true,              // ❌ Requires null checks everywhere
    "strictPropertyInitialization": true,  // ❌ Requires all props initialized
    "noUnusedLocals": true,                // ❌ Errors on unused variables
    "noUnusedParameters": true,            // ❌ Errors on unused params
    "noUncheckedIndexedAccess": true,      // ❌ Makes array access painful

    // These cause monorepo pain:
    "composite": true,                     // ❌ Requires project references
    "rootDir": "./src"                     // ❌ Breaks cross-package imports
  }
}
```

### ✅ ENABLE When Stabilizing for Production:

Once your code is working and you're ready to harden it:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

---

## 🎨 File Organization Rules

### 1. **Example/Demo Files**

```typescript
// ✅ ALWAYS add @ts-nocheck to examples
// @ts-nocheck - Example/demo file with intentional issues
import { Something } from './Something';

// Example code with intentional type mismatches for demonstration
```

**Rule:** Any file in `examples/`, `demos/`, or similar should have `@ts-nocheck`

### 2. **Test Files**

```typescript
// ✅ Add @ts-nocheck to tests with mocks
// @ts-nocheck - Test file with mock implementations
import { MyClass } from './MyClass';

// Tests often use simplified mocks that don't match exact types
```

**Rule:** Add `@ts-nocheck` to test files that:
- Use incomplete mocks
- Test edge cases with invalid types
- Use simplified test data structures

### 3. **Production Code**

```typescript
// ✅ NO @ts-nocheck in production code
// Let TypeScript catch real errors
import { Something } from './Something';

export class MyClass {
  // Actual production implementation
}
```

**Rule:** Production code should compile cleanly without `@ts-nocheck`

---

## 📁 Directory Structure Guidelines

### ✅ GOOD Structure:

```
project/
├── src/                    # Production code (checked)
│   ├── domain/
│   ├── application/
│   └── infrastructure/
├── tests/                  # Tests (relaxed checking)
│   ├── unit/
│   ├── integration/
│   └── utils/
├── examples/               # Examples (excluded or @ts-nocheck)
├── services/               # Monorepo packages (own tsconfig)
│   └── agents/
│       ├── base-agent/
│       │   ├── src/
│       │   ├── examples/   # Excluded
│       │   └── tsconfig.json
│       └── director-agent/
└── tsconfig.json           # Main config
```

### Key Principles:
1. Each major directory gets its own concerns
2. Monorepo packages have independent tsconfig.json
3. Test directories are separate from production
4. Examples are isolated and excluded

---

## 🔧 Jest Configuration

### jest.config.js

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  // Path mappings MUST match tsconfig.json
  moduleNameMapper: {
    '^@/tests/(.*)$': '<rootDir>/tests/$1',
    '^@/services/agents/base-agent/(.*)$': '<rootDir>/services/agents/base-agent/$1',
    '^@/(.*)$': '<rootDir>/src/$1'
  },

  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json'  // Use relaxed config for tests
    }]
  },

  // Setup
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],

  // Performance
  testTimeout: 10000,
  clearMocks: true,
  restoreMocks: true
};
```

---

## 🎯 When to Use @ts-nocheck

### ✅ USE for:
- Example files demonstrating concepts
- Demo code showing before/after
- Test files with extensive mocking
- Prototype/spike code
- Generated code
- Third-party code you don't control

### ❌ DON'T USE for:
- Production source code (src/)
- Core business logic
- Public APIs
- Library exports
- Anything users/clients interact with

---

## 🚀 Migration Strategy

### If You Have Strict Settings Now:

**Phase 1: Relax for Development**
```bash
# 1. Update tsconfig.json with relaxed settings
# 2. Fix any remaining real errors
# 3. Commit and continue development
```

**Phase 2: Add Tests**
```bash
# 4. Write tests with relaxed tsconfig.test.json
# 5. Add @ts-nocheck to test files as needed
# 6. Get to 80%+ test coverage
```

**Phase 3: Harden for Production** (Optional)
```bash
# 7. Enable strict mode in tsconfig.json
# 8. Fix errors file by file
# 9. Commit when all pass
```

---

## 📊 Error Prevention Checklist

Before starting a new TypeScript project:

- [ ] Set `strict: false` in tsconfig.json
- [ ] Set `skipLibCheck: true`
- [ ] Set `noImplicitAny: false`
- [ ] Set `strictNullChecks: false`
- [ ] Add explicit `include` array
- [ ] Add explicit `exclude` array with tests/examples
- [ ] Create separate tsconfig.test.json
- [ ] Add @ts-nocheck to all example files
- [ ] Exclude examples from tsconfig
- [ ] Remove `rootDir` if doing monorepo
- [ ] Set `baseUrl` relative to project root
- [ ] Match Jest paths to tsconfig paths
- [ ] Document when to enable strict mode

---

## 🎓 Key Lessons Learned

### 1. **Strictness is a Spectrum**
- Start loose, tighten gradually
- Not all code needs same strictness
- Tests can be looser than production

### 2. **Monorepo = Complex**
- Each package needs own config
- Avoid `rootDir` with cross-package imports
- Use `skipLibCheck: true` aggressively

### 3. **IDE vs Build**
- IDE checks everything it sees
- Build only checks what you tell it
- Use exclusions to control what IDE sees

### 4. **@ts-nocheck is Not Evil**
- Perfect for demos and examples
- Useful for test mocks
- Prevents TypeScript from blocking you
- Just don't use in production code

### 5. **Configuration Inheritance**
- Child configs inherit parent settings
- Sometimes inheritance causes pain
- Independent configs are clearer

---

## 🔍 Troubleshooting

### Problem: "Object is possibly 'undefined'"
**Solution:** Set `strictNullChecks: false` or use optional chaining `?.`

### Problem: "Parameter has implicit any type"
**Solution:** Set `noImplicitAny: false` or add explicit types

### Problem: "File is not under rootDir"
**Solution:** Remove `rootDir` or set it to common ancestor

### Problem: "Property does not exist on type"
**Solution:** Check if type definitions are correct or use `@ts-nocheck` for tests

### Problem: "Module not found"
**Solution:** Check `paths` mapping matches both tsconfig.json and jest.config.js

### Problem: "Too many errors in IDE"
**Solution:** Check what tsconfig the IDE is using, add exclusions

---

## 📚 Further Reading

- [TypeScript Handbook - tsconfig.json](https://www.typescriptlang.org/tsconfig)
- [TypeScript Deep Dive - Project Configuration](https://basarat.gitbook.io/typescript/)
- [Monorepo TypeScript Best Practices](https://turbo.build/repo/docs/handbook/linting/typescript)

---

## 🎉 Summary

**For Active Development:**
- Relaxed strictness
- Clear exclusions
- @ts-nocheck for examples/demos
- Separate test configuration

**For Production Hardening:**
- Enable strict mode gradually
- Fix errors file by file
- Keep tests relaxed
- Document exceptions

**Remember:** TypeScript should help you, not block you. Start loose, tighten when stable.

---

Generated from lessons learned: 2025-01-XX
Based on fixing 300+ TypeScript errors in one session
