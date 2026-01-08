# TypeScript Testing Standards

**Note:** For universal testing principles, see `shared/testing-principles.md`. This document covers TypeScript and Jest-specific practices.

## Testing Framework

We use **Jest** with **ts-jest** for TypeScript projects.

### Setup

```bash
npm install --save-dev jest ts-jest @types/jest
npx ts-jest config:init
```

### Configuration

```javascript
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};
```

## Test Structure

### File Naming

```
tests/
├── unit/
│   ├── domain/
│   │   └── services/
│   │       └── ProductService.test.ts
│   └── application/
│       └── services/
│           └── OrderService.test.ts
└── integration/
    └── repositories/
        └── ProductRepository.integration.test.ts
```

### Describe/It Blocks

```typescript
describe('ProductService', () => {
  describe('getProductById', () => {
    it('should return product when it exists', async () => {
      // Test implementation
    });

    it('should throw ProductNotFoundError when product does not exist', async () => {
      // Test implementation
    });

    it('should log warning when product not found', async () => {
      // Test implementation
    });
  });

  describe('createProduct', () => {
    it('should create product with valid data', async () => {
      // Test implementation
    });

    it('should throw ValidationError for invalid data', async () => {
      // Test implementation
    });
  });
});
```

## Unit Testing

### Testing Services with Mocked Dependencies

```typescript
import { ProductService } from '@/application/services/ProductService';
import { IProductRepository } from '@/domain/interfaces/IProductRepository';
import { ILogger } from '@/domain/interfaces/ILogger';
import { ProductNotFoundError } from '@/domain/errors/ProductNotFoundError';

describe('ProductService', () => {
  let service: ProductService;
  let mockProductRepository: jest.Mocked<IProductRepository>;
  let mockLogger: jest.Mocked<ILogger>;

  beforeEach(() => {
    // Create mocks
    mockProductRepository = {
      getById: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      findByCategory: jest.fn()
    } as jest.Mocked<IProductRepository>;

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    } as jest.Mocked<ILogger>;

    // Create service with mocked dependencies
    service = new ProductService(mockProductRepository, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getProduct', () => {
    it('should return product when it exists', async () => {
      // Arrange
      const mockProduct = {
        id: '123',
        name: 'Test Product',
        price: 99.99
      };
      mockProductRepository.getById.mockResolvedValue(mockProduct);

      // Act
      const result = await service.getProduct('123');

      // Assert
      expect(result).toEqual(mockProduct);
      expect(mockProductRepository.getById).toHaveBeenCalledWith('123');
      expect(mockProductRepository.getById).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Product retrieved',
        { productId: '123' }
      );
    });

    it('should throw ProductNotFoundError when product does not exist', async () => {
      // Arrange
      mockProductRepository.getById.mockResolvedValue(null);

      // Act & Assert
      await expect(service.getProduct('999')).rejects.toThrow(ProductNotFoundError);
      expect(mockProductRepository.getById).toHaveBeenCalledWith('999');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Product not found',
        { productId: '999' }
      );
    });
  });
});
```

### Testing with Type-Safe Mocks

```typescript
// Helper to create type-safe mocks
function createMock<T>(): jest.Mocked<T> {
  return {} as jest.Mocked<T>;
}

// Usage
const mockRepository = createMock<IProductRepository>();
mockRepository.getById = jest.fn().mockResolvedValue(mockProduct);
```

## Integration Testing

### Testing Repositories

```typescript
import { ProductRepository } from '@/infrastructure/repositories/ProductRepository';
import { IDatabaseService } from '@/infrastructure/interfaces/IDatabaseService';
import { IProduct } from '@/domain/entities/IProduct';

describe('ProductRepository Integration', () => {
  let repository: ProductRepository;
  let db: IDatabaseService;

  beforeAll(async () => {
    // Set up test database
    db = await createTestDatabase();
    repository = new ProductRepository(db);
  });

  afterAll(async () => {
    // Clean up
    await db.disconnect();
  });

  beforeEach(async () => {
    // Clear database before each test
    await db.clearCollection('products');
  });

  describe('save and getById', () => {
    it('should save and retrieve product', async () => {
      // Arrange
      const product: IProduct = {
        id: '123',
        name: 'Test Product',
        price: 99.99,
        categoryId: 'cat1'
      };

      // Act
      await repository.save(product);
      const retrieved = await repository.getById('123');

      // Assert
      expect(retrieved).toEqual(product);
    });
  });

  describe('findByCategory', () => {
    it('should return products in category', async () => {
      // Arrange
      const products: IProduct[] = [
        { id: '1', name: 'Product 1', price: 10, categoryId: 'cat1' },
        { id: '2', name: 'Product 2', price: 20, categoryId: 'cat1' },
        { id: '3', name: 'Product 3', price: 30, categoryId: 'cat2' }
      ];

      for (const product of products) {
        await repository.save(product);
      }

      // Act
      const results = await repository.findByCategory('cat1');

      // Assert
      expect(results).toHaveLength(2);
      expect(results.map(p => p.id)).toEqual(['1', '2']);
    });
  });
});
```

## Assertions

### Jest Matchers

```typescript
// Equality
expect(value).toBe(expected);                    // Strict equality (===)
expect(value).toEqual(expected);                 // Deep equality
expect(value).toStrictEqual(expected);           // Strict deep equality

// Truthiness
expect(value).toBeTruthy();
expect(value).toBeFalsy();
expect(value).toBeNull();
expect(value).toBeUndefined();
expect(value).toBeDefined();

// Numbers
expect(value).toBeGreaterThan(3);
expect(value).toBeGreaterThanOrEqual(3);
expect(value).toBeLessThan(5);
expect(value).toBeLessThanOrEqual(5);
expect(value).toBeCloseTo(0.3, 5);              // Floating point

// Strings
expect(value).toMatch(/pattern/);
expect(value).toContain('substring');

// Arrays
expect(array).toContain(item);
expect(array).toHaveLength(3);
expect(array).toContainEqual(object);

// Objects
expect(obj).toHaveProperty('key');
expect(obj).toHaveProperty('key', value);
expect(obj).toMatchObject({ key: value });

// Exceptions
expect(() => fn()).toThrow();
expect(() => fn()).toThrow(Error);
expect(() => fn()).toThrow('error message');
expect(async () => await fn()).rejects.toThrow();

// Mock functions
expect(mockFn).toHaveBeenCalled();
expect(mockFn).toHaveBeenCalledTimes(1);
expect(mockFn).toHaveBeenCalledWith(arg1, arg2);
expect(mockFn).toHaveBeenLastCalledWith(arg1, arg2);
expect(mockFn).toHaveReturnedWith(value);
```

## Mocking

### Mock Functions

```typescript
// Create mock function
const mockFn = jest.fn();

// Mock return value
mockFn.mockReturnValue(42);
mockFn.mockReturnValueOnce(42);

// Mock resolved value (Promise)
mockFn.mockResolvedValue(data);
mockFn.mockResolvedValueOnce(data);

// Mock rejected value (Promise)
mockFn.mockRejectedValue(new Error('Failed'));
mockFn.mockRejectedValueOnce(new Error('Failed'));

// Mock implementation
mockFn.mockImplementation((arg) => arg * 2);
mockFn.mockImplementationOnce((arg) => arg * 2);

// Check calls
expect(mockFn).toHaveBeenCalled();
expect(mockFn).toHaveBeenCalledWith(arg1, arg2);
expect(mockFn.mock.calls).toHaveLength(2);
expect(mockFn.mock.calls[0][0]).toBe(arg1);
expect(mockFn.mock.results[0].value).toBe(returnValue);
```

### Mocking Modules

```typescript
// Mock entire module
jest.mock('@/infrastructure/database/FirebaseService');

// Mock specific function
jest.mock('@/utils/helpers', () => ({
  generateId: jest.fn(() => 'test-id'),
  formatDate: jest.fn((date) => date.toISOString())
}));

// Partial mock (keep some real implementations)
jest.mock('@/utils/helpers', () => ({
  ...jest.requireActual('@/utils/helpers'),
  generateId: jest.fn(() => 'test-id')
}));
```

### Spy on Methods

```typescript
// Spy on method
const spy = jest.spyOn(object, 'method');

// Spy and mock implementation
const spy = jest.spyOn(object, 'method').mockImplementation(() => 'mocked');

// Restore original implementation
spy.mockRestore();
```

## Test Data

### Fixtures

```typescript
// tests/fixtures/products.ts
export const mockProduct: IProduct = {
  id: '123',
  name: 'Test Product',
  price: 99.99,
  categoryId: 'cat1',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01')
};

export const mockProducts: IProduct[] = [
  mockProduct,
  {
    id: '456',
    name: 'Another Product',
    price: 49.99,
    categoryId: 'cat2',
    createdAt: new Date('2024-01-02'),
    updatedAt: new Date('2024-01-02')
  }
];
```

### Test Builders

```typescript
// tests/builders/ProductBuilder.ts
export class ProductBuilder {
  private product: Partial<IProduct> = {
    id: '123',
    name: 'Test Product',
    price: 10.00,
    categoryId: 'cat1'
  };

  withId(id: string): ProductBuilder {
    this.product.id = id;
    return this;
  }

  withName(name: string): ProductBuilder {
    this.product.name = name;
    return this;
  }

  withPrice(price: number): ProductBuilder {
    this.product.price = price;
    return this;
  }

  build(): IProduct {
    return this.product as IProduct;
  }
}

// Usage in tests
const product = new ProductBuilder()
  .withId('custom-id')
  .withName('Custom Product')
  .withPrice(99.99)
  .build();
```

## Async Testing

### Testing Promises

```typescript
it('should handle async operations', async () => {
  // Using async/await
  const result = await service.getData();
  expect(result).toBeDefined();
});

it('should handle promise rejections', async () => {
  // Expect rejection
  await expect(service.failingMethod()).rejects.toThrow(Error);
  await expect(service.failingMethod()).rejects.toThrow('Specific message');
});
```

### Testing Callbacks

```typescript
it('should handle callbacks', (done) => {
  service.methodWithCallback((error, result) => {
    expect(error).toBeNull();
    expect(result).toBeDefined();
    done();
  });
});
```

## Coverage

### Running Coverage

```bash
# Run tests with coverage
npm test -- --coverage

# Coverage for specific files
npm test -- --coverage --collectCoverageFrom='src/services/**/*.ts'

# Watch mode
npm test -- --watch

# Update snapshots
npm test -- -u
```

### Coverage Reports

```bash
# HTML report
npm test -- --coverage --coverageReporters=html
open coverage/index.html

# Text report
npm test -- --coverage --coverageReporters=text

# LCOV for CI
npm test -- --coverage --coverageReporters=lcov
```

## Best Practices

### Do's

- ✅ Use `async/await` for async tests
- ✅ Clear mocks between tests (`afterEach`)
- ✅ Use type-safe mocks
- ✅ Test error cases
- ✅ Use descriptive test names
- ✅ Arrange-Act-Assert pattern
- ✅ One concept per test
- ✅ Use builders for complex objects

### Don'ts

- ❌ Don't use `any` in tests
- ❌ Don't test implementation details
- ❌ Don't share state between tests
- ❌ Don't mock everything
- ❌ Don't ignore failing tests
- ❌ Don't skip assertions
- ❌ Don't test third-party code

## Example: Complete Test Suite

```typescript
import { OrderService } from '@/application/services/OrderService';
import { IOrderRepository } from '@/domain/interfaces/IOrderRepository';
import { IProductRepository } from '@/domain/interfaces/IProductRepository';
import { ILogger } from '@/domain/interfaces/ILogger';
import { OrderBuilder } from '@/tests/builders/OrderBuilder';
import { ProductBuilder } from '@/tests/builders/ProductBuilder';

describe('OrderService', () => {
  let service: OrderService;
  let mockOrderRepository: jest.Mocked<IOrderRepository>;
  let mockProductRepository: jest.Mocked<IProductRepository>;
  let mockLogger: jest.Mocked<ILogger>;

  beforeEach(() => {
    mockOrderRepository = {
      save: jest.fn(),
      getById: jest.fn(),
      findByUser: jest.fn()
    } as jest.Mocked<IOrderRepository>;

    mockProductRepository = {
      getById: jest.fn(),
      findByIds: jest.fn()
    } as jest.Mocked<IProductRepository>;

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    } as jest.Mocked<ILogger>;

    service = new OrderService(
      mockOrderRepository,
      mockProductRepository,
      mockLogger
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createOrder', () => {
    it('should create order with valid data', async () => {
      // Arrange
      const products = [
        new ProductBuilder().withId('p1').withPrice(10).build(),
        new ProductBuilder().withId('p2').withPrice(20).build()
      ];

      mockProductRepository.findByIds.mockResolvedValue(products);
      mockOrderRepository.save.mockResolvedValue(undefined);

      const orderData = {
        userId: 'user1',
        productIds: ['p1', 'p2']
      };

      // Act
      const order = await service.createOrder(orderData);

      // Assert
      expect(order).toBeDefined();
      expect(order.userId).toBe('user1');
      expect(order.total).toBe(30);
      expect(mockProductRepository.findByIds).toHaveBeenCalledWith(['p1', 'p2']);
      expect(mockOrderRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user1',
          total: 30
        })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Order created',
        expect.objectContaining({ orderId: order.id })
      );
    });

    it('should throw ValidationError for empty product list', async () => {
      // Arrange
      const orderData = {
        userId: 'user1',
        productIds: []
      };

      // Act & Assert
      await expect(service.createOrder(orderData)).rejects.toThrow(ValidationError);
      expect(mockOrderRepository.save).not.toHaveBeenCalled();
    });
  });
});
```

## Checklist

- [ ] Tests use TypeScript with proper types
- [ ] Mocks are type-safe (`jest.Mocked<T>`)
- [ ] async/await used for async tests
- [ ] Arrange-Act-Assert pattern followed
- [ ] Mocks cleared between tests
- [ ] Error cases tested
- [ ] Test names are descriptive
- [ ] Coverage meets thresholds (80%+)
- [ ] No `any` types in tests
- [ ] Test data uses builders or fixtures

For universal testing principles, see `shared/testing-principles.md`.
