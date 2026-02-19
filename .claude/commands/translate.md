We are going to focus on translating the app. Follow the instructions in @CLAUDE.md regarding translations.

Your workflow should look like the following:

1. Run `make translations`
2. Run the command `uv run python scripts/run.py python manage.py check_translations --show-missing --show-fuzzy` to understand which translations are missing.
3. Select a file to translate and translate them to the relevant language. Make sure you reuse wording around other translations to keep things consistent.
4. Run `uv run python scripts/run.py python manage.py check_translations --show-missing --show-fuzzy` again to see if you missed anything and fix those.
5. Go back to step 1.

Once you're done, we have a unit test for verifying that translations are done (@test_translation_completeness.py). If the tests don't pass, you MUST go back to the workflow. Once the test passes, run `make translations` one last time.

Notes:

- **Dealing with many translations across multiple files**: Use sub-agents! Assign a file to each sub-agent and divide and conquer.
- **Check translation status**: `uv run python scripts/run.py python manage.py check_translations --show-missing --show-fuzzy` (or use `make check-translations`)
- **Compile translations**: `make translations` (handles both Django and JavaScript translations)
- **Translation files**: Located in `locale/<lang>/LC_MESSAGES/`
  - `django.po` - Django/Python translations
  - `djangojs.po` - JavaScript translations
- **Requirements**:
  - No fuzzy translations allowed (all must be reviewed and completed)
  - All strings must be properly translated in target language
  - Unit tests will fail if translations are incomplete
