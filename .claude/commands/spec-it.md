Please write a formal specification for this in @specifications/ within a folder whose name must ressemble the feature that we're working on so that I can reset your context and you can pick up the implementation without missing any details. The spec MUST be a single `SPEC.md` file.

Guidelines

1. Be thorough with your specs explaining the WHY, WHAT and HOW
2. Include thorough code samples that you can reference
3. Remind yourself to check @CLAUDE.md, @/claude/testing.md and @/claude/frontend-testing.md (if Frontend code is required) and add the relevant pieces to the spec.
4. Prefer Pydantic models over Dicts / dataclasses.
5. **Fail loud and hard with proper error definitions**:
   - NEVER silently swallow errors or return None/fallback values when something goes wrong
   - NEVER catch generic `Exception` - always catch specific exception types
   - Define custom exception classes for each error case (e.g., `BotDetailFetchError`, `RecordingNotFoundError`)
   - When an error occurs, raise a specific exception with a clear message - let it bubble up
   - If a function can fail, document it in the docstring with `Raises:` section
   - Example of what NOT to do:
     ```python
     # BAD - silent failure
     try:
         result = external_api.fetch(id)
         return result
     except Exception as e:
         logger.warning("Failed: %s", e)
         return None  # Silent failure - caller won't know something went wrong
     ```
   - Example of what TO do:

     ```python
     # GOOD - fail loud with specific exception
     class DataFetchError(ServiceError):
         """Raised when fetching data from external API fails"""
         pass

     def fetch_data(self, id: str) -> Data:
         """
         Fetch data from external API.

         Raises:
             DataFetchError: If the API call fails
         """
         try:
             return external_api.fetch(id)
         except ExternalAPIError as e:
             raise DataFetchError(f"Failed to fetch data for {id}") from e
     ```

6. **Be explicit with assertions - no ambiguous checks**:
   - ALWAYS use `assertEqual` instead of `assertIn` for status codes
   - Know exactly what response you expect and assert for that specific value
   - Ambiguous assertions like `assertIn(status, [401, 403])` hide bugs - you should know if it's 401 or 403
   - Example of what NOT to do:
     ```python
     # BAD - ambiguous assertion
     self.assertIn(response.status_code, [401, 403])
     ```
   - Example of what TO do:
     ```python
     # GOOD - explicit assertion
     self.assertEqual(response.status_code, 401)  # Unauthenticated = 401
     ```

Once you're done and the user has approved, add a TODO.md file with the set of tasks required to complete this split into phases. Be thorough.

Additional guidelines:
$ARGUMENTS
