Please write a formal specification for this in @specifications/ within a folder whose name must resemble the feature that we're working on so that I can reset your context and you can pick up the implementation without missing any details. The spec MUST be a single `SPEC.md` file.

Guidelines

1. Be thorough with your specs explaining the WHY, WHAT and HOW.
2. Include thorough TypeScript code samples that you can reference during implementation.
3. Remind yourself to check @CLAUDE.md, @docs/research.md, and @docs/phases-index.md and add the relevant pieces to the spec.
4. **Use Zod schemas for runtime validation, TypeScript interfaces/types for static typing**:
   - Use Zod 4.x for config schemas, API payloads, and any data crossing trust boundaries
   - Use TypeScript `interface` / `type` for internal data shapes that don't need runtime validation
   - Infer types from Zod schemas with `z.infer<typeof MySchema>` — don't duplicate types
   - Example:

     ```typescript
     import { z } from "zod/v4";

     export const SessionConfigSchema = z.object({
       project: z.string().min(1),
       path: z.string(),
       mode: z.enum(["confirm", "plan", "auto"]).default("confirm"),
       output: z.enum(["verbose", "summary", "silent"]).default("verbose"),
     });

     export type SessionConfig = z.infer<typeof SessionConfigSchema>;
     ```

5. **Fail loud and hard with proper error definitions**:
   - NEVER silently swallow errors or return `undefined`/fallback values when something goes wrong
   - NEVER catch generic `Error` — always catch specific error types or narrow with `instanceof`
   - Define custom error classes for each error case, extending `JorchBotError` (see `src/errors/index.ts`)
   - When an error occurs, throw a specific error with a clear message — let it bubble up
   - Always chain the original cause with `{ cause: err }`
   - If a function can fail, document it with `@throws` in JSDoc
   - Example of what NOT to do:
     ```typescript
     // BAD - silent failure
     try {
       const result = await externalApi.fetch(id);
       return result;
     } catch (err) {
       logger.warn("Failed:", err);
       return undefined; // Silent failure - caller won't know something went wrong
     }
     ```
   - Example of what TO do:

     ```typescript
     // GOOD - fail loud with specific error class
     export class DataFetchError extends JorchBotError {
       constructor(id: string, cause?: unknown) {
         super(`Failed to fetch data for ${id}`, { cause });
       }
     }

     /**
      * Fetch data from external API.
      * @throws {DataFetchError} If the API call fails
      */
     async function fetchData(id: string): Promise<Data> {
       try {
         return await externalApi.fetch(id);
       } catch (err) {
         throw new DataFetchError(id, err);
       }
     }
     ```

6. **Be explicit with assertions — no ambiguous checks** (Vitest):
   - ALWAYS use `expect(x).toBe(y)` for exact value comparisons — never `toContain` for single expected values
   - Know exactly what response you expect and assert for that specific value
   - Ambiguous assertions like `expect([401, 403]).toContain(status)` hide bugs — you should know if it's 401 or 403
   - NEVER use comparison matchers (`toBeGreaterThan`, `toBeLessThan`) when the exact value is known
   - When iterating over a collection in a test, ALWAYS assert the collection length first
   - Example of what NOT to do:

     ```typescript
     // BAD - ambiguous assertion
     expect([401, 403]).toContain(response.status);

     // BAD - hides actual count
     expect(items.length).toBeGreaterThan(0);
     ```

   - Example of what TO do:

     ```typescript
     // GOOD - explicit assertion
     expect(response.status).toBe(401); // Unauthenticated = 401

     // GOOD - deterministic count
     expect(items).toHaveLength(3);
     ```

7. **Testing conventions** (from `vitest.config.ts` and CLAUDE.md):
   - Tests colocated as `*.test.ts` next to source files
   - Use Vitest 4.x with `describe`, `it`, `expect`, `vi`
   - Test isolation: use `JORCHBOT_DB_PATH` and `JORCHBOT_CONFIG_DIR` env vars
   - Run single file: `pnpm test:fast -- src/path/to/file.test.ts`
   - Run pattern: `pnpm test:fast -- -t "pattern name"`
   - ONE test file at a time — fix completely before moving on
   - Start with the happy path, then add error cases
   - Mock external dependencies, never real filesystems or networks in unit tests

8. **Code conventions** (from CLAUDE.md):
   - Always use `.js` suffix in imports (ESM requirement)
   - Use `import type { X }` for type-only imports
   - No `any` — `typescript/no-explicit-any` is an error in oxlint
   - Keep files under ~700 LOC
   - All JorchBot errors extend `JorchBotError` from `src/errors/index.ts`
   - Disabled OpenClaw modules are excluded via config, NOT deleted

9. **NEVER assume — always ask**. If anything is ambiguous, unclear, or has multiple valid interpretations, STOP and ask the user before proceeding. It's better to ask a "dumb" question than to spec something wrong. This applies to: naming choices, architectural decisions, scope boundaries, edge cases, integration points, and anything where you're tempted to guess.

10. **Be DRY, SOLID, STUPID, and KISS**:
    - **DRY**: Don't Repeat Yourself — extract shared logic, avoid duplicated schemas/types/constants
    - **SOLID**: Single responsibility, Open/closed, Liskov substitution, Interface segregation, Dependency inversion
    - **STUPID**: Avoid Singleton abuse, Tight coupling, Untestability, Premature optimization, Indescriptive naming, Duplication
    - **KISS**: Keep It Simple, Stupid — the simplest solution that works is the right one. No over-engineering, no abstractions for hypothetical future needs
    - When in doubt between clever and simple, choose simple

Once you're done and the user has approved, add a TODO.md file with the set of tasks required to complete this split into phases. Be thorough.

Additional guidelines:
$ARGUMENTS
