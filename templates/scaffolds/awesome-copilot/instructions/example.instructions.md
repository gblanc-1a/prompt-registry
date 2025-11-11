
Best practices and coding guidelines for this project.

## Purpose

These instructions help maintain code quality and consistency across the project.

## Coding Standards

### General Principles

- **Clarity**: Write code that is easy to read and understand
- **Consistency**: Follow established patterns and conventions
- **Simplicity**: Keep solutions simple and maintainable
- **Documentation**: Comment complex logic and public APIs

### TypeScript/JavaScript

\`\`\`typescript
// Good: Clear function with JSDoc
/**
 * Calculate the total price including tax
 * @param price - Base price
 * @param taxRate - Tax rate as decimal (e.g., 0.1 for 10%)
 * @returns Total price with tax
 */
function calculateTotal(price: number, taxRate: number): number {
    return price * (1 + taxRate);
}

// Bad: Unclear and undocumented
function calc(p: number, t: number) {
    return p * (1 + t);
}
\`\`\`

### Error Handling

- Always handle errors gracefully
- Provide meaningful error messages
- Log errors for debugging
- Don't swallow exceptions silently

### Testing

- Write unit tests for all business logic
- Test edge cases and error conditions
- Use descriptive test names
- Maintain test coverage above 80%

## File Organization

- Group related code together
- Use clear, descriptive file names
- Keep files focused and single-purpose
- Avoid files longer than 300 lines

## Git Commit Messages

Follow conventional commits format:
\`\`\`
feat: add user authentication
fix: resolve memory leak in cache
docs: update API documentation
test: add tests for payment processing
\`\`\`

## Code Review Guidelines

- Review for logic correctness first
- Check for potential bugs and edge cases
- Ensure tests are comprehensive
- Verify documentation is updated
- Be constructive and respectful

## Resources

- [Clean Code](https://www.amazon.com/Clean-Code-Handbook-Software-Craftsmanship/dp/0132350882)
- [Effective TypeScript](https://effectivetypescript.com/)
- [Test Driven Development](https://martinfowler.com/bliki/TestDrivenDevelopment.html)
