# TypeScript Coding Standards

**Note:** This document covers TypeScript-specific conventions. For universal architecture principles, see `shared/clean-architecture.md`.

---

## 📘 IMPORTANT: TypeScript Configuration

**Before writing TypeScript code, understand your project's configuration:**

See **[TypeScript Configuration Guide](./typescript-config-guide.md)** for:
- How to configure `tsconfig.json` for development vs. production
- Common configuration issues and solutions (300+ errors resolved)
- When to use relaxed vs. strict settings
- Monorepo configuration best practices
- When to use `@ts-nocheck` for examples and tests

**Key takeaways:**
- Start with **relaxed settings** during active development (`strict: false`)
- Enable **strict mode** when stabilizing for production
- Use separate `tsconfig.test.json` for tests
- Explicitly exclude examples, tests, and demo files

---

## 🚨 CRITICAL: Strict Null Checks

### ALWAYS Handle Undefined/Null Values

**TypeScript strict mode will cause compile errors if you don't explicitly handle `undefined` and `null`.**

This is the #1 source of TypeScript errors. Every value that might be undefined MUST be checked before use.

#### Common Errors and Fixes

**❌ ERROR: TS2532 "Object is possibly 'undefined'"**

```typescript
// ❌ BAD - Will cause TS2532 error
function processUser(user: User | undefined) {
  return user.name;  // ERROR: Object is possibly 'undefined'
}

// ✅ FIX #1 - Null check
function processUser(user: User | undefined) {
  if (!user) {
    throw new UserNotFoundError();
  }
  return user.name;  // ✅ TypeScript knows user is defined here
}

// ✅ FIX #2 - Optional chaining
function processUser(user: User | undefined): string | undefined {
  return user?.name;  // Returns undefined if user is undefined
}

// ✅ FIX #3 - Nullish coalescing
function processUser(user: User | undefined): string {
  return user?.name ?? 'Unknown';  // Returns 'Unknown' if undefined
}

// ✅ FIX #4 - Type guard
function processUser(user: User | undefined): string {
  if (user === undefined) {
    return 'Unknown';
  }
  return user.name;  // ✅ user is User here
}
```

**❌ ERROR: TS2345 "Type 'X | undefined' is not assignable to parameter of type 'X'"**

```typescript
// ❌ BAD - Passing possibly undefined to function expecting defined value
function sendEmail(email: string) { /* ... */ }

const user: User | undefined = await getUser(id);
sendEmail(user.email);  // ERROR: user is possibly undefined

// ✅ FIX #1 - Check before passing
const user = await getUser(id);
if (!user) {
  throw new UserNotFoundError(id);
}
sendEmail(user.email);  // ✅ TypeScript knows user is defined

// ✅ FIX #2 - Early return
const user = await getUser(id);
if (!user) return;
sendEmail(user.email);  // ✅ TypeScript knows user is defined

// ✅ FIX #3 - Guard clause
const user = await getUser(id);
if (user === undefined) {
  throw new UserNotFoundError(id);
}
sendEmail(user.email);  // ✅ TypeScript knows user is User
```

#### Array Operations

**❌ BAD - .find() returns undefined**
```typescript
const users: User[] = [/* ... */];
const user = users.find(u => u.id === targetId);
processUser(user);  // ERROR: user might be undefined

// ✅ GOOD - Check result
const user = users.find(u => u.id === targetId);
if (!user) {
  throw new UserNotFoundError(targetId);
}
processUser(user);  // ✅ user is User
```

#### Object Property Access

**❌ BAD - Accessing nested properties**
```typescript
const name = user.profile.name;  // ERROR: profile might be undefined

// ✅ GOOD - Optional chaining
const name = user.profile?.name;  // Returns undefined if profile is undefined
const name = user.profile?.name ?? 'Unknown';  // Default value
```

#### Function Return Values

**When repository methods return `T | null`, ALWAYS check the result:**

```typescript
// Repository method signature
interface IUserRepository {
  getById(id: string): Promise<User | null>;  // Can return null!
}

// ❌ BAD - Not checking for null
async function getUser(id: string): Promise<User> {
  const user = await userRepository.getById(id);
  return user;  // ERROR: Type 'User | null' is not assignable to 'User'
}

// ✅ GOOD - Check and throw
async function getUser(id: string): Promise<User> {
  const user = await userRepository.getById(id);
  if (!user) {
    throw new UserNotFoundError(id);
  }
  return user;  // ✅ TypeScript knows user is User, not null
}

// ✅ GOOD - Return nullable type
async function getUser(id: string): Promise<User | null> {
  return await userRepository.getById(id);  // Explicitly nullable return
}
```

### MANDATORY Checks for Every Potentially Undefined Value

**Before using ANY value that might be undefined, you MUST:**

1. **Check if it exists**: `if (!value) { ... }`
2. **Use optional chaining**: `value?.property`
3. **Provide a default**: `value ?? defaultValue`
4. **Use a type guard**: `if (value === undefined) { ... }`

**No exceptions. TypeScript will not compile otherwise.**

## Type Safety

### Strict Mode

**ALWAYS use TypeScript strict mode:**

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictPropertyInitialization": true
  }
}
```

### Never Use `any`

**NEVER use `any` type** - it defeats the purpose of TypeScript.

```typescript
// ❌ BAD
function processData(data: any): any {
  return data.something;
}

// ✅ GOOD
function processData(data: ProductData): ProcessedData {
  return {
    id: data.id,
    name: data.name
  };
}
```

**Alternatives to `any`:**
- `unknown` - for truly unknown types (with type guards)
- Generic types - `<T>` for reusable code
- Union types - `string | number`
- Specific interfaces - define the shape

### Explicit Return Types

Always specify return types for public functions:

```typescript
// ❌ BAD - inferred return type
export function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}

// ✅ GOOD - explicit return type
export function calculateTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}
```

### Type vs Interface

**Prefer `interface` for object shapes:**

```typescript
// ✅ GOOD - interface for objects
export interface IProduct {
  id: string;
  name: string;
  price: number;
}
```

**Use `type` for:**
- Unions: `type Status = 'active' | 'inactive'`
- Intersections: `type Combined = TypeA & TypeB`
- Mapped types: `type Readonly<T> = { readonly [P in keyof T]: T[P] }`
- Tuples: `type Point = [number, number]`

## Naming Conventions

### Interfaces

**Prefix interfaces with `I`:**

```typescript
// ✅ GOOD
export interface IProductService {
  getById(id: string): Promise<IProduct>;
}

export interface IProductRepository {
  save(product: IProduct): Promise<void>;
}

// ❌ BAD
export interface ProductService { ... }  // Missing 'I' prefix
```

### Classes

**PascalCase for classes:**

```typescript
// ✅ GOOD
export class ProductService implements IProductService {
  // ...
}

export class ProductRepository implements IProductRepository {
  // ...
}
```

### Files

**File names must match the primary export:**

```typescript
// File: IProductRepository.ts
export interface IProductRepository { ... }

// File: ProductRepository.ts
export class ProductRepository implements IProductRepository { ... }

// File: ProductService.ts
export class ProductService implements IProductService { ... }
```

### Constants

**UPPER_SNAKE_CASE for constants:**

```typescript
export const MAX_RETRY_ATTEMPTS = 3;
export const DEFAULT_TIMEOUT_MS = 5000;
export const API_BASE_URL = 'https://api.example.com';
```

### Variables and Functions

**camelCase for variables and functions:**

```typescript
const productList: IProduct[] = [];
const userId: string = '123';

function calculateDiscount(price: number): number {
  return price * 0.1;
}

async function fetchUserData(id: string): Promise<IUser> {
  // ...
}
```

## File Organization

### One Interface Per File

Each interface gets its own file:

```typescript
// ✅ GOOD
// File: IProductService.ts
export interface IProductService {
  getById(id: string): Promise<IProduct>;
}

// File: IOrderService.ts
export interface IOrderService {
  create(order: IOrder): Promise<string>;
}
```

```typescript
// ❌ BAD - multiple interfaces in one file
// File: Services.ts
export interface IProductService { ... }
export interface IOrderService { ... }
export interface IUserService { ... }
```

**Exception:** Small, related interfaces can be together:

```typescript
// File: IPaginationTypes.ts
export interface IPaginationRequest {
  page: number;
  pageSize: number;
}

export interface IPaginationResponse<T> {
  items: T[];
  total: number;
  page: number;
}
```

### Index Files for Clean Imports

Use `AgentEnums.ts` files to export from directories:

```typescript
// File: src/domain/interfaces/AgentEnums.ts
export { IProductRepository } from './IProductRepository';
export { IOrderRepository } from './IOrderRepository';
export { IUserRepository } from './IUserRepository';

// Now you can import as:
import { IProductRepository, IOrderRepository } from '@/domain/interfaces';
```

## Clean Architecture Implementation

### Repository Interface (Domain)

```typescript
// File: src/domain/interfaces/IProductRepository.ts
import { IProduct } from '../entities/IProduct';

export interface IProductRepository {
  getById(id: string): Promise<IProduct | null>;
  save(product: IProduct): Promise<void>;
  delete(id: string): Promise<void>;
  findByCategory(categoryId: string): Promise<IProduct[]>;
}
```

### Repository Implementation (Infrastructure)

```typescript
// File: src/infrastructure/repositories/ProductRepository.ts
import { IProductRepository } from '@/domain/interfaces/IProductRepository';
import { IProduct } from '@/domain/entities/IProduct';
import { IDatabaseService } from '../interfaces/IDatabaseService';
import { ProductNotFoundError } from '@/domain/errors/ProductNotFoundError';

export class ProductRepository implements IProductRepository {
  constructor(private readonly db: IDatabaseService) {}

  async getById(id: string): Promise<IProduct | null> {
    try {
      const doc = await this.db.readDocDataAtPath(`products/${id}`);
      return doc ? (doc as IProduct) : null;
    } catch (error) {
      throw new RepositoryError(`Failed to fetch product: ${id}`, { originalError: error });
    }
  }

  async save(product: IProduct): Promise<void> {
    await this.db.writeDocDataAtPath(`products/${product.id}`, product);
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteDocAtPath(`products/${id}`);
  }

  async findByCategory(categoryId: string): Promise<IProduct[]> {
    const docs = await this.db.queryCollection('products', {
      where: ['categoryId', '==', categoryId]
    });
    return docs as IProduct[];
  }
}
```

### Service (Application)

```typescript
// File: src/application/services/ProductService.ts
import { IProductService } from '../interfaces/IProductService';
import { IProductRepository } from '@/domain/interfaces/IProductRepository';
import { IProduct } from '@/domain/entities/IProduct';
import { ProductNotFoundError } from '@/domain/errors/ProductNotFoundError';

export class ProductService implements IProductService {
  constructor(
    private readonly productRepository: IProductRepository,
    private readonly logger: ILogger
  ) {}

  async getProduct(id: string): Promise<IProduct> {
    const product = await this.productRepository.getById(id);

    if (!product) {
      this.logger.warn('Product not found', { productId: id });
      throw new ProductNotFoundError(id);
    }

    this.logger.info('Product retrieved', { productId: id });
    return product;
  }

  async createProduct(data: CreateProductData): Promise<IProduct> {
    // Validation
    this.validateProductData(data);

    // Create entity
    const product: IProduct = {
      id: generateId(),
      ...data,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Save
    await this.productRepository.save(product);

    this.logger.info('Product created', { productId: product.id });
    return product;
  }

  private validateProductData(data: CreateProductData): void {
    if (!data.name || data.name.trim().length === 0) {
      throw new ValidationError('Product name is required');
    }
    if (data.price <= 0) {
      throw new ValidationError('Product price must be positive');
    }
  }
}
```

## Constructor Injection

**ALWAYS use constructor injection for dependencies:**

```typescript
// ✅ GOOD - Constructor injection
export class OrderService implements IOrderService {
  constructor(
    private readonly orderRepository: IOrderRepository,
    private readonly productRepository: IProductRepository,
    private readonly logger: ILogger
  ) {}

  async createOrder(data: CreateOrderData): Promise<IOrder> {
    // Use injected dependencies
    const products = await this.productRepository.findByIds(data.productIds);
    // ...
  }
}

// ❌ BAD - Direct instantiation
export class OrderService implements IOrderService {
  async createOrder(data: CreateOrderData): Promise<IOrder> {
    const orderRepo = new OrderRepository(); // Hard to test!
    // ...
  }
}
```

### Readonly Dependencies

Mark injected dependencies as `readonly`:

```typescript
constructor(
  private readonly orderRepository: IOrderRepository,  // ✅ readonly
  private readonly logger: ILogger                     // ✅ readonly
) {}
```

This prevents accidental reassignment.

## Error Handling

### Domain Errors

```typescript
// File: src/domain/errors/DomainError.ts
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly data?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

// File: src/domain/errors/ProductNotFoundError.ts
export class ProductNotFoundError extends DomainError {
  constructor(productId: string) {
    super(
      `Product not found: ${productId}`,
      404,
      { productId }
    );
  }
}
```

### Try-Catch with Proper Types

```typescript
// ✅ GOOD - Proper error handling
async function fetchProduct(id: string): Promise<IProduct> {
  try {
    const product = await productRepository.getById(id);
    if (!product) {
      throw new ProductNotFoundError(id);
    }
    return product;
  } catch (error) {
    if (error instanceof ProductNotFoundError) {
      throw error; // Re-throw domain errors
    }

    // Transform unknown errors
    logger.error('Unexpected error fetching product', {
      error,
      productId: id
    });

    throw new ServiceError(
      'Failed to fetch product',
      { productId: id, originalError: error }
    );
  }
}
```

## Async/Await

**ALWAYS use async/await over raw Promises:**

```typescript
// ✅ GOOD - async/await
async function getUser(id: string): Promise<IUser> {
  const user = await userRepository.getById(id);
  return user;
}

// ❌ BAD - raw promises
function getUser(id: string): Promise<IUser> {
  return userRepository.getById(id).then(user => {
    return user;
  });
}
```

### Parallel Operations

Use `Promise.all()` for parallel async operations:

```typescript
// ✅ GOOD - parallel execution
async function getUserWithOrders(userId: string): Promise<UserWithOrders> {
  const [user, orders] = await Promise.all([
    userRepository.getById(userId),
    orderRepository.findByUser(userId)
  ]);

  return { user, orders };
}

// ❌ BAD - sequential (slower)
async function getUserWithOrders(userId: string): Promise<UserWithOrders> {
  const user = await userRepository.getById(userId);
  const orders = await orderRepository.findByUser(userId);
  return { user, orders };
}
```

## Generics

Use generics for reusable, type-safe code:

```typescript
// Generic repository interface
export interface IRepository<T> {
  getById(id: string): Promise<T | null>;
  save(entity: T): Promise<void>;
  delete(id: string): Promise<void>;
}

// Specific implementations
export interface IProductRepository extends IRepository<IProduct> {
  findByCategory(categoryId: string): Promise<IProduct[]>;
}

// Generic function
function findById<T extends { id: string }>(
  items: T[],
  id: string
): T | undefined {
  return items.find(item => item.id === id);
}
```

## Utility Types

Use TypeScript utility types:

```typescript
// Make all properties optional
type PartialProduct = Partial<IProduct>;

// Make all properties required
type RequiredProduct = Required<IProduct>;

// Make all properties readonly
type ReadonlyProduct = Readonly<IProduct>;

// Pick specific properties
type ProductSummary = Pick<IProduct, 'id' | 'name' | 'price'>;

// Omit specific properties
type ProductWithoutId = Omit<IProduct, 'id'>;

// Extract return type of function
type ProductData = ReturnType<typeof getProduct>;

// Extract parameters of function
type GetProductParams = Parameters<typeof getProduct>;
```

## Code Quality Checklist

- [ ] TypeScript strict mode enabled
- [ ] No `any` types used
- [ ] Explicit return types on public functions
- [ ] Interfaces prefixed with 'I'
- [ ] File names match primary export
- [ ] One interface per file
- [ ] Constructor injection used
- [ ] Dependencies marked as readonly
- [ ] Proper error handling with domain errors
- [ ] async/await preferred over raw promises
- [ ] Generics used where appropriate
- [ ] Index files for clean imports

## Tooling

### Recommended Tools

- **Compiler**: `tsc` - TypeScript compiler
- **Linter**: `ESLint` with TypeScript plugin
- **Formatter**: `Prettier`
- **Testing**: `Jest` with `ts-jest`
- **Build**: `tsc` or bundlers (webpack, rollup, esbuild)

### ESLint Configuration

```javascript
// .eslintrc.js
module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/explicit-function-return-type': 'warn',
    '@typescript-eslint/no-unused-vars': 'error',
  }
};
```

### Pre-commit Checks

```bash
# Run TypeScript compiler
npx tsc --noEmit

# Run linter
npx eslint "src/**/*.ts"

# Run formatter
npx prettier --check "src/**/*.ts"

# Run tests
npm test
```

For testing specifics, see `languages/typescript/testing.md`.
For universal architecture principles, see `shared/clean-architecture.md`.
