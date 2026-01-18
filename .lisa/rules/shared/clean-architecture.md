# Clean Architecture Principles

**Note:** These principles apply to ALL programming languages. See your language-specific rules for implementation details.

## Overview

Clean Architecture is a software design philosophy that emphasizes separation of concerns and dependency management. The core idea is to organize code into layers, with dependencies flowing inward toward the core business logic.

## Layer Structure

```
src/
├── domain/              # Core business entities and rules
│   ├── entities/        # Business entities
│   ├── errors/          # Domain-specific errors
│   └── interfaces/      # Contracts (interfaces/protocols/traits)
├── application/         # Business logic and use cases
│   ├── interfaces/      # Application service contracts
│   └── services/        # Use case implementations
└── infrastructure/      # External concerns
    ├── repositories/    # Data access implementations
    └── services/        # External API integrations
```

## Layer Responsibilities

### 1. Domain Layer (`src/domain/`)

**Purpose:** Contains the core business rules and entities with zero dependencies on external frameworks or libraries.

**What belongs here:**
- Core business entities (Product, Order, User, etc.)
- Business rules and validation logic
- Domain errors and exceptions
- Repository interfaces (contracts for data access)
- Core service interfaces (business logic contracts)

**Dependencies:** NONE - Domain depends on nothing else

**Examples across languages:**
- Entities: `Product`, `Order`, `Customer`
- Interfaces: Repository contracts, service contracts
- Errors: `ProductNotFoundError`, `InvalidOrderStateError`

### 2. Application Layer (`src/application/`)

**Purpose:** Orchestrates the domain layer and coordinates infrastructure to implement use cases.

**What belongs here:**
- Use case implementations
- Application service interfaces
- Application-specific logic
- Coordination between domain and infrastructure

**Dependencies:** Can depend on Domain layer ONLY

**Examples:**
- Services: `OrderService`, `CartService`, `CheckoutService`
- Use cases: `CreateOrderUseCase`, `ProcessPaymentUseCase`
- Configurations: `CheckoutConfig`, `PaymentConfig`

### 3. Infrastructure Layer (`src/infrastructure/`)

**Purpose:** Handles all interactions with external systems, databases, APIs, and frameworks.

**What belongs here:**
- Repository implementations (database access)
- External API clients
- Framework-specific code
- Database connections
- Third-party service integrations

**Dependencies:** Can depend on both Application and Domain layers

**Examples:**
- Repositories: `ProductRepository`, `OrderRepository`
- Services: `DatabaseService`, `PaymentGatewayService`
- Clients: `EmailServiceClient`, `SMSServiceClient`

## Dependency Rules

### The Dependency Rule

**Dependencies MUST point inward:**

```
Infrastructure → Application → Domain
                              ↑
                           Core Business
```

- **Domain** has NO dependencies
- **Application** depends on Domain only
- **Infrastructure** depends on Application and Domain

### Why This Matters

1. **Testability**: Domain can be tested without databases or external services
2. **Flexibility**: Swap infrastructure without changing business logic
3. **Maintainability**: Changes to external systems don't affect core business rules
4. **Independence**: Business logic is independent of frameworks and tools

## Dependency Inversion Principle

The key to Clean Architecture is **Dependency Inversion**:

- High-level modules should not depend on low-level modules
- Both should depend on abstractions (interfaces/contracts)
- Abstractions should not depend on details
- Details should depend on abstractions

### Example Flow

```
OrderService (Application)
    ↓ depends on
IOrderRepository (Domain interface)
    ↑ implemented by
OrderRepository (Infrastructure)
```

The service depends on the interface, not the implementation. The implementation depends on the interface.

## Repository Pattern

The Repository pattern mediates between the domain and data mapping layers.

### Key Concepts

1. **Interface in Domain**: Repository contracts live in domain layer
2. **Implementation in Infrastructure**: Actual data access in infrastructure
3. **Services use Interfaces**: Application services depend on interfaces, not implementations
4. **Centralized Data Access**: All data operations go through repositories

### Why Use Repositories

- Decouples business logic from data storage
- Makes testing easier (mock repositories)
- Enables swapping data sources (SQL → NoSQL)
- Centralizes data access patterns
- Provides clear separation of concerns

## Dependency Injection

All dependencies should be injected, not instantiated.

### Constructor Injection

Dependencies are provided through the constructor, making them explicit and testable.

**Benefits:**
- Explicit dependencies
- Easy to test (inject mocks)
- Promotes loose coupling
- Enables swapping implementations

### Registration

All services and repositories must be registered in a dependency injection container.

**Location:** `src/infrastructure/di/`

## SOLID Principles

### Single Responsibility Principle (SRP)

**Definition:** Each class should have only one reason to change.

**Application:**
- Each repository handles one entity
- Each service handles one use case or related group
- Keep classes focused and cohesive

### Open/Closed Principle (OCP)

**Definition:** Open for extension, closed for modification.

**Application:**
- Use interfaces to allow extension
- Compose behavior rather than modifying existing code
- Use dependency injection to swap implementations

### Liskov Substitution Principle (LSP)

**Definition:** Derived classes must be substitutable for their base classes.

**Application:**
- Implementations must honor interface contracts
- No unexpected behavior in derived classes
- Maintain consistent semantics

### Interface Segregation Principle (ISP)

**Definition:** Clients should not depend on interfaces they don't use.

**Application:**
- Create small, focused interfaces
- Split large interfaces into smaller ones
- Each interface should represent one capability

### Dependency Inversion Principle (DIP)

**Definition:** Depend on abstractions, not concretions.

**Application:**
- Services depend on repository interfaces
- Use dependency injection
- Infrastructure implements domain interfaces

## Common Violations

### ❌ Layer Violations

**Problem:** Domain importing from infrastructure

```
// BAD - Domain importing infrastructure
// In: src/domain/services/ProductService
import { Database } from '../../infrastructure/database';
```

**Solution:** Domain should only define interfaces

```
// GOOD - Domain defines interface
// In: src/domain/interfaces/
export interface IDatabase { ... }

// Infrastructure implements it
// In: src/infrastructure/
export class Database implements IDatabase { ... }
```

### ❌ Application Importing Infrastructure

**Problem:** Application layer importing infrastructure implementations

```
// BAD - Application importing infrastructure
// In: src/application/services/OrderService
import { ProductRepository } from '../../infrastructure/repositories/ProductRepository';
```

**Solution:** Application should depend on domain interfaces

```
// GOOD - Application depends on interface
// In: src/application/services/OrderService
import { IProductRepository } from '../../domain/interfaces/IProductRepository';

// Infrastructure is injected via DI
constructor(private readonly productRepo: IProductRepository) {}
```

### ❌ Direct Database Access in Services

**Problem:** Services accessing database directly

**Solution:** Always use repository abstractions

### ❌ Business Logic in Infrastructure

**Problem:** Business rules in repository implementations

**Solution:** Keep repositories focused on data access, move logic to domain/application

## Testing Strategy

### Domain Layer Tests

- Test business logic in isolation
- No mocking needed (pure logic)
- Fast, deterministic tests

### Application Layer Tests

- Mock repository interfaces
- Test use case orchestration
- Verify correct repository calls

### Infrastructure Layer Tests

- Integration tests with real dependencies
- Test data access patterns
- Verify error handling

## Benefits of Clean Architecture

1. **Independent of Frameworks**: Business rules don't depend on external libraries
2. **Testable**: Business logic can be tested without UI, database, or external services
3. **Independent of UI**: Can change UI without changing business rules
4. **Independent of Database**: Can swap databases without changing business logic
5. **Independent of External Services**: Business rules don't know about external APIs

## Migration Path

### Legacy Code

If you have existing code that doesn't follow Clean Architecture:

1. Start with new features following the pattern
2. Gradually extract interfaces from existing code
3. Move business logic to domain/application
4. Create repository interfaces for data access
5. Refactor incrementally, don't rewrite everything

### Red Flags

- Circular dependencies
- Business logic in infrastructure
- Direct database access in services
- Framework coupling in domain
- God classes (too many responsibilities)

## Language-Specific Details

For language-specific implementation details (naming conventions, syntax, idioms), see your language-specific rules:

- **TypeScript**: `languages/typescript/coding-standards.md`
- **Python**: `languages/python/coding-standards.md`
- **Go**: `languages/go/coding-standards.md`
- **Java**: `languages/java/coding-standards.md`

## Summary Checklist

- [ ] Domain layer has no dependencies
- [ ] Application layer depends on domain only
- [ ] Infrastructure implements domain interfaces
- [ ] All data access through repositories
- [ ] Dependencies injected, not instantiated
- [ ] Each class has single responsibility
- [ ] Interfaces are small and focused
- [ ] Business logic is testable in isolation
