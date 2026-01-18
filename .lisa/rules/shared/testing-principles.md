# Testing Principles

**Note:** These principles apply to ALL programming languages. See your language-specific rules for testing frameworks and syntax.

## Testing Pyramid

The testing pyramid guides how much testing to do at each level:

```
       /\
      /  \     E2E Tests (10%)
     /____\
    /      \   Integration Tests (20%)
   /________\
  /          \ Unit Tests (70%)
 /____________\
```

### Unit Tests (70%)

**What:** Test individual components in isolation

**Characteristics:**
- Fast (milliseconds)
- No external dependencies
- Test one thing at a time
- Use mocks/stubs for dependencies

**Examples:**
- Domain entity behavior
- Business logic in services
- Validation rules
- Utility functions

### Integration Tests (20%)

**What:** Test components working together

**Characteristics:**
- Slower (seconds)
- May use real dependencies (database, etc.)
- Test integration points
- Verify contracts between layers

**Examples:**
- Repository with real database
- Service with real repositories
- API endpoint with real database
- External service integration

### End-to-End Tests (10%)

**What:** Test complete user workflows

**Characteristics:**
- Slowest (minutes)
- Uses real system
- Tests critical user paths
- Brittle, expensive to maintain

**Examples:**
- User registration flow
- Checkout process
- Complete order workflow

## Testing Principles

### 1. Tests Should Be FIRST

- **Fast**: Run quickly (unit tests in milliseconds)
- **Independent**: Don't depend on other tests
- **Repeatable**: Same result every time
- **Self-Validating**: Pass or fail, no manual checking
- **Timely**: Written with or before the code

### 2. Arrange-Act-Assert Pattern

Structure tests in three clear phases:

```
// Arrange - Set up test data and dependencies
setup test data
create mocks
configure system

// Act - Execute the behavior being tested
result = systemUnderTest.method(input)

// Assert - Verify the outcome
assert result equals expected
assert mock was called correctly
```

### 3. Test Behavior, Not Implementation

**Good:** Test what the code does (public interface)
**Bad:** Test how it does it (internal details)

**Why:**
- Tests survive refactoring
- More maintainable
- Focus on contracts

### 4. One Assertion Per Test Concept

Each test should verify one logical concept.

**Not:** One assert statement per test
**Instead:** One logical verification per test

Multiple asserts are fine if they verify the same concept.

### 5. Meaningful Test Names

Test names should describe:
- What is being tested
- Under what conditions
- What the expected outcome is

**Patterns:**
- `methodName_givenCondition_shouldExpectedOutcome`
- `should_expectedOutcome_when_condition`
- `test_specificBehavior`

## Test Organization

### Test File Structure

Tests should mirror source code structure:

```
src/
└── domain/
    └── services/
        └── ProductService

tests/
└── unit/
    └── domain/
        └── services/
            └── ProductService.test
```

### Test Suite Organization

Group related tests with clear hierarchy:

```
describe ProductService
    describe getById
        test should return product when exists
        test should throw error when not found
        test should handle invalid ID format

    describe create
        test should create product with valid data
        test should validate required fields
        test should throw error for duplicate SKU
```

## Mocking Strategies

### When to Mock

**Mock:**
- External dependencies (database, API, file system)
- Dependencies in unit tests
- Slow or non-deterministic operations
- Components you don't control

**Don't mock:**
- The system under test
- Simple value objects
- Domain entities (usually)
- Trivial dependencies

### Types of Test Doubles

1. **Dummy**: Passed but never used
2. **Stub**: Returns predefined values
3. **Spy**: Records how it was called
4. **Mock**: Pre-programmed with expectations
5. **Fake**: Working implementation (e.g., in-memory database)

### Mock Verification

Verify mocks were called correctly:

```
// Verify method was called
assert mock.method was called

// Verify with specific arguments
assert mock.method was called with (arg1, arg2)

// Verify call count
assert mock.method was called exactly once

// Verify order
assert mock.methodA was called before mock.methodB
```

## Testing Repositories

### Unit Tests (Mocked)

Test services using repository interfaces:

**What to test:**
- Business logic using the repository
- Error handling
- Edge cases

**How:**
- Mock the repository interface
- Configure return values
- Verify correct calls

### Integration Tests (Real Database)

Test repository implementations:

**What to test:**
- CRUD operations work correctly
- Query methods return right data
- Constraints are enforced
- Transactions work

**How:**
- Use test database
- Clean up after each test
- Test with real data

## Testing Services

### Test with Mocked Dependencies

Services should be tested with mocked repositories:

**Setup:**
1. Create mock repositories
2. Configure mock responses
3. Inject mocks into service
4. Test service behavior

**Verify:**
- Service returns correct results
- Service calls repositories correctly
- Service handles errors
- Service implements business logic

### Test Error Handling

Every error path should be tested:

**Scenarios:**
- Invalid input
- Not found errors
- Constraint violations
- External service failures

## Test Data Management

### Test Fixtures

Reusable test data:

**Benefits:**
- Consistent test data
- DRY principle
- Easy to maintain

**Approaches:**
- Factory functions
- Builder pattern
- Fixture files

### Test Data Builders

Use builders for complex objects:

**Benefits:**
- Flexible test data creation
- Clear test setup
- Easy to customize

**Pattern:**
```
builder = EntityBuilder()
    .withProperty1(value1)
    .withProperty2(value2)

entity = builder.build()
```

### Data Cleanup

Clean up test data after tests:

**Why:**
- Tests remain independent
- Avoid side effects
- Fresh state for each test

**How:**
- Use setup/teardown hooks
- Clean database in integration tests
- Reset mocks in unit tests

## Test Coverage

### Coverage Goals

**Targets:**
- Critical business logic: 95%+
- Services and repositories: 90%+
- Utilities and helpers: 80%+
- Overall project: 80%+

### What NOT to Test

Don't waste time testing:
- Third-party libraries
- Framework code
- Generated code
- Simple getters/setters
- Configuration files

### Coverage vs Quality

**Remember:**
- 100% coverage doesn't mean bug-free
- Focus on meaningful tests
- Quality over quantity
- Test important paths first

## Testing Async Code

### Promises/Futures

Test asynchronous operations properly:

**Requirements:**
- Await async operations
- Handle rejections/errors
- Test timeout scenarios
- Verify async error handling

### Callbacks

If using callbacks:
- Use test framework support
- Mark test as async
- Call done/completion
- Handle timeouts

## Performance Testing

### Test Speed

**Unit tests:**
- Should run in milliseconds
- No I/O operations
- No network calls
- No database access

**Integration tests:**
- Should run in seconds
- Can use real dependencies
- Should still be reasonably fast

### Parallel Execution

Run tests in parallel:
- Speeds up test suite
- Tests must be independent
- No shared state
- Careful with database tests

## Common Anti-Patterns

### ❌ Testing Implementation Details

**Problem:** Tests break on refactoring

**Solution:** Test public interface and behavior

### ❌ One Giant Test

**Problem:** Hard to debug failures, tests multiple things

**Solution:** Split into focused tests

### ❌ Test Interdependence

**Problem:** Tests depend on each other's state

**Solution:** Make tests independent with setup/teardown

### ❌ Ignoring Failures

**Problem:** Commented out or skipped failing tests

**Solution:** Fix or delete, don't ignore

### ❌ No Assertions

**Problem:** Test runs but doesn't verify anything

**Solution:** Every test needs assertions

### ❌ Overuse of Mocks

**Problem:** Mocking everything, including trivial code

**Solution:** Only mock external dependencies

## Test-Driven Development (TDD)

### Red-Green-Refactor Cycle

1. **Red**: Write a failing test
2. **Green**: Write minimum code to pass
3. **Refactor**: Improve code while keeping tests green

### Benefits of TDD

- Better design (testable by default)
- Living documentation
- Confidence in changes
- Fewer bugs

### When to Use TDD

**Good for:**
- Well-understood requirements
- Complex business logic
- Critical functionality
- Learning new concepts

**Skip for:**
- Prototyping
- UI exploration
- Spike solutions
- Trivial code

## Testing Checklist

- [ ] Tests follow FIRST principles
- [ ] Test pyramid respected (70/20/10)
- [ ] Arrange-Act-Assert structure
- [ ] Meaningful test names
- [ ] Tests are independent
- [ ] One concept per test
- [ ] Appropriate use of mocks
- [ ] Error cases tested
- [ ] Test data cleaned up
- [ ] Tests run fast
- [ ] Coverage on critical paths
- [ ] Tests are maintainable

## Language-Specific Testing

For testing frameworks, assertion libraries, and syntax in your language:

- **TypeScript**: `languages/typescript/testing.md`
- **Python**: `languages/python/testing.md`
- **Go**: `languages/go/testing.md`
- **Java**: `languages/java/testing.md`
