# Repository Pattern

**Note:** This pattern applies to ALL programming languages. See your language-specific rules for syntax and implementation details.

## What is the Repository Pattern?

The Repository pattern mediates between the domain and data mapping layers, acting like an in-memory collection of domain objects.

### Key Concepts

- **Abstraction over data access**: Business logic doesn't know about databases
- **Collection-like interface**: Repositories feel like working with collections
- **Domain-centric**: Repositories work with domain entities, not database records
- **Single source of truth**: All data access for an entity goes through its repository

## Benefits

### 1. Separation of Concerns
- Business logic separated from data access
- Domain layer doesn't know about databases
- Easy to change data storage without affecting business logic

### 2. Testability
- Mock repositories in tests
- Test business logic without a database
- Fast, isolated unit tests

### 3. Centralized Data Access
- All database queries in one place
- Consistent error handling
- Easier to optimize and monitor

### 4. Flexibility
- Swap SQL for NoSQL
- Add caching layer
- Change ORMs without affecting business logic

## Structure

### Interface in Domain Layer

Repository interfaces (contracts) belong in the domain layer because they define what the business needs.

**Location:** `src/domain/interfaces/`

**Responsibilities:**
- Define data operations (CRUD)
- Use domain entities as parameters/returns
- Define business-oriented methods

### Implementation in Infrastructure Layer

Repository implementations belong in infrastructure because they deal with external systems.

**Location:** `src/infrastructure/repositories/`

**Responsibilities:**
- Implement domain interface
- Handle database connections
- Map between database and domain entities
- Handle data access errors

## Common Operations

### Basic CRUD Operations

Repositories typically provide these operations:

1. **Create**: Add new entities
2. **Read**: Retrieve entities by ID or criteria
3. **Update**: Modify existing entities
4. **Delete**: Remove entities

### Query Methods

Beyond CRUD, repositories can provide domain-specific queries:

- `findByEmail(email)`
- `findActiveOrders(userId)`
- `findProductsByCategory(categoryId)`
- `searchByName(query)`

### Pagination

For large collections:

- `findAll(page, pageSize)`
- `findByCriteria(criteria, offset, limit)`

## Design Guidelines

### 1. One Repository Per Aggregate Root

Each domain aggregate gets one repository.

**Good:**
- `ProductRepository` (for Product aggregate)
- `OrderRepository` (for Order aggregate)
- `CustomerRepository` (for Customer aggregate)

**Bad:**
- `DataRepository` (too generic)
- `ProductAndOrderRepository` (handles multiple aggregates)

### 2. Use Domain Entities

Repositories work with domain entities, not DTOs or database models.

**Input:** Domain entities
**Output:** Domain entities
**Internal:** Database models (hidden from domain)

### 3. Keep Interfaces Focused

Repositories should be focused on data access, not business logic.

**Good methods:**
- `getById(id)`
- `save(entity)`
- `delete(id)`
- `findByStatus(status)`

**Bad methods:**
- `calculateOrderTotal(id)` (business logic)
- `sendEmailToCustomer(id)` (side effect)
- `validateProduct(product)` (validation)

### 4. Handle Errors Appropriately

Repositories should translate data access errors into domain errors.

**Responsibilities:**
- Catch database exceptions
- Transform to domain-specific errors
- Provide meaningful error messages
- Include relevant context

## Common Patterns

### 1. Generic Repository Base

Create a base interface for common operations:

**Benefits:**
- Reduces code duplication
- Consistent interface across repositories
- Easy to add new repositories

**When to use:**
- Most repositories need similar operations
- You want consistency

**When to avoid:**
- Repositories have very different operations
- Forces unnecessary methods

### 2. Specification Pattern

Encapsulate query logic in reusable specifications:

**Benefits:**
- Reusable query logic
- Composable criteria
- Testable query logic

**When to use:**
- Complex queries
- Reusable criteria combinations
- Dynamic query building

### 3. Unit of Work Pattern

Coordinate multiple repository operations in a transaction:

**Benefits:**
- Transactional consistency
- Batch operations
- Rollback on failure

**When to use:**
- Multi-repository operations
- Transactional boundaries
- Coordinated changes

## Error Handling

### Not Found Scenarios

Two approaches:

**1. Return null/None/nil:**
```
// Returns null if not found
entity = repository.getById(id)
if entity is null:
    handle not found
```

**2. Throw exception:**
```
// Throws NotFoundError if not found
try:
    entity = repository.getById(id)
catch NotFoundError:
    handle not found
```

**Recommendation:** Be consistent across all repositories

### Database Errors

Transform database errors to domain errors:

1. Catch database-specific exceptions
2. Log error details for debugging
3. Throw domain-specific error
4. Include relevant context (entity ID, operation)

## Testing Repositories

### Unit Tests (with mocks)

Test business logic with mocked repositories:

**Benefits:**
- Fast tests
- No database needed
- Test edge cases easily

**What to test:**
- Business logic using the repository
- Error handling
- Edge cases

### Integration Tests (with real database)

Test repository implementations:

**Benefits:**
- Verify actual data access
- Test query correctness
- Catch SQL errors

**What to test:**
- CRUD operations
- Query methods
- Error scenarios (connection failures, constraint violations)
- Transaction handling

## Common Anti-Patterns

### ❌ Business Logic in Repository

**Problem:** Repository performs calculations or business rules

**Solution:** Keep repositories focused on data access

### ❌ Repository Calling Another Repository

**Problem:** Creates tight coupling and hidden dependencies

**Solution:** Services orchestrate multiple repositories

### ❌ Leaking Database Details

**Problem:** Repository interface exposes SQL, ORM, or database concepts

**Solution:** Use domain language in interface

### ❌ Generic Repository with Unused Methods

**Problem:** Repository forced to implement methods it doesn't need

**Solution:** Use focused interfaces or optional methods

### ❌ Anemic Repository

**Problem:** Repository is just a thin wrapper with no value

**Solution:** If it's just pass-through, you might not need the pattern

## When NOT to Use Repository Pattern

The repository pattern isn't always necessary:

**Skip it when:**
- Very simple CRUD with no business logic
- Direct ORM usage is simpler
- Over-engineering for small projects
- Adds complexity without benefit

**Use it when:**
- Separation of concerns is important
- Business logic needs to be testable
- May need to swap data sources
- Complex querying logic
- Team needs consistent data access patterns

## Dependency Injection

Repositories should be injected, not instantiated:

**Why:**
- Loose coupling
- Easy to test (inject mocks)
- Configuration flexibility
- Dependency clarity

**How:**
- Register repositories in DI container
- Inject interface, not implementation
- Constructor injection preferred

## Summary Checklist

- [ ] Repository interface in domain layer
- [ ] Repository implementation in infrastructure layer
- [ ] One repository per aggregate root
- [ ] Methods use domain entities
- [ ] Error handling transforms to domain errors
- [ ] Registered in DI container
- [ ] Services depend on interface, not implementation
- [ ] Tests cover both unit (mocked) and integration (real DB)
- [ ] No business logic in repository
- [ ] Consistent error handling across repositories

## Language-Specific Examples

For implementation syntax and idioms in your language:

- **TypeScript**: `languages/typescript/coding-standards.md`
- **Python**: `languages/python/coding-standards.md`
- **Go**: `languages/go/coding-standards.md`
- **Java**: `languages/java/coding-standards.md`
