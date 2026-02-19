# Testing Guidelines

## Main Commands

```bash
# Run all tests (inside Docker container against Postgres)
make test

# Run specific test module
make test ARGS='apps.module.tests.test_file'

# Run with additional options (e.g., keep database between runs)
make test ARGS='apps.module.tests.test_file --keepdb'
```

**Workflow**

IMPORTANT: Start SIMPLE! Write a single test that is simple and make an assertion. Keep adding more complexity to the test as needed but keep testing it until you figure out how to properly test end to end with the happy case. Then, you can start deviating from that as needed.

Every time you touch a test file, you MUST run it and verify that it works before moving on to the next. If it's a brand new test file or a brand new set of tests, you MUST run first code the entire happy case step by step. This is critical to prevent a bunch of wasted effort on tests that don't pass. You can only write multiple tests at once when you have proven the happy case.

**CRITICAL: Test One Before Fixing Many**: When fixing multiple similar test issues, ALWAYS fix ONE test first, verify it works, then apply the same fix to others. NEVER make bulk changes without testing the fix on a single case first.

ALL tests that you write MUST pass (unless you want to show a bug).

**CRITICAL: This file contains mandatory testing requirements. ALL testing must follow these guidelines exactly.**

## Core Testing Principles

### Test Development Approach

- **NO Test Driven Development**: We don't do TDD - write code first, then tests
- **Replace throwaway scripts with unit tests**: Instead of creating temporary test scripts that get deleted, write proper unit tests that will be run forever
- **CRITICAL: NEVER create new test files unless absolutely necessary**: Always add tests to existing test files when possible. Only create new test files if there's no logical existing file to extend.
- **Unit tests**: Add to the app's `tests/` folder with descriptive names like `test_member_api.py`

### Test Execution

- **Run tests via Docker**: `make test ARGS='apps.vet_portal.tests.test_members'`
- **Run all tests**: `make test`

### Test Isolation and Behavior

- **Test isolation**: Code must not detect/change behavior when running in tests
- **No test-aware code**: Avoid code like `if str(type(obj)).find('Mock') != -1:`
- **No temporary test scripts**: Don't create throwaway test files like `test_something.py` in the root
- **CRITICAL: Test Exception Messages**: All exception messages in tests MUST clearly indicate they are test scenarios, not real errors. Use format: `"TEST: Simulated [scenario description]"` (e.g., `"TEST: Simulated network timeout"`) to prevent confusion in logs.

### Test Naming Convention

- **Test naming represents END STATE, not current state**:
  - Test class and method names should describe what functionality they test, NOT the current state of coverage
  - NEVER use names like "MissingCoverage", "UncoveredLines", "ToBeAdded", etc.
  - Use descriptive names like "MemberApiDeactivationTestCase", "PartnerIsolationTestCase"
  - Once tests are written, they're not "missing" anymore - name them for what they test

### Test Base Classes

- Use `apps.web.tests.base.TestViewBase` for view tests (handles storage overrides)
- Use `apps.web.tests.base.TestLoginRequiredViewBase` for authenticated view tests (provides `self.authenticated_client` and `self.user`)
- Create partner/organization test setups as needed for vet portal tests

## CRITICAL: Deterministic Test Rules

### No Conditional Logic in Tests

- **NEVER EVER use conditional logic that allows tests to pass when they should fail**
- **FORBIDDEN PATTERNS**:

  ```python
  # BAD - test passes even if the request fails
  if response.status_code == 200:
      # only test success scenario

  # BAD - non-deterministic status code expectations
  self.assertIn(response.status_code, [200, 404, 500])
  ```

- **REQUIRED PATTERNS**:

  ```python
  # GOOD - assert exact expected behavior
  self.assertEqual(response.status_code, 200, "API call should succeed")

  # GOOD - fail fast if assumptions are wrong
  response_data = response.json()
  self.assertIn("data", response_data, "Response should contain data key")
  ```

### Deterministic Assertion Requirements

- **ZERO TOLERANCE**: Any conditional logic that allows tests to silently pass when behavior is wrong is absolutely forbidden
- **TEST ASSERTIONS MUST BE DETERMINISTIC**: Every test run should produce identical results with identical inputs

## CRITICAL: NEVER Use Comparison Operators in Test Assertions

- **ABSOLUTELY FORBIDDEN**: `assertGreater`, `assertGreaterEqual`, `assertLess`, `assertLessEqual`, and comparison operators `>`, `>=`, `<`, `<=` in test assertions
- **FORBIDDEN PATTERNS**:
  ```python
  # BAD - Non-deterministic assertions that hide actual values
  self.assertGreater(len(items), 0)  # Could be 1, 2, 100 - hides actual count!
  self.assertTrue(len(items) > 0)    # Same problem!
  self.assertGreaterEqual(count, 1)  # Not deterministic!
  ```
- **REQUIRED PATTERNS - Assert exact expected values**:
  ```python
  # GOOD - Deterministic assertions with exact expected values
  self.assertEqual(len(items), 3, "Should have exactly 3 items")
  self.assertEqual(count, 1, "Should have exactly 1 matching record")
  ```
- **WHY THIS MATTERS**: Comparison operators hide the actual values and make tests non-deterministic. If a test expects "at least 1" item but gets 50, that might indicate a bug that the comparison operator would hide. Always assert the exact expected value.

## CRITICAL: For-Loop Validation in Tests

- **NEVER use for-loops without validating the collection size first**
- **EVERY LINE of test code MUST execute on every test run**
- **FORBIDDEN PATTERN**:
  ```python
  # BAD - This for-loop might not execute if memberships is empty!
  memberships = OrganizationMembership.objects.filter(organization=org)
  for membership in memberships:
      self.assertEqual(membership.is_active, True)  # May never execute!
  ```
- **REQUIRED PATTERN**:
  ```python
  # GOOD - Assert the collection contains expected number of items
  memberships = OrganizationMembership.objects.filter(organization=org)
  self.assertEqual(memberships.count(), 2, "Should have exactly 2 memberships")
  for membership in memberships:
      self.assertEqual(membership.is_active, True)  # Guaranteed to execute
  ```

## CRITICAL: Tests MUST Verify Business Logic Success

- **NEVER write tests that only check HTTP status codes while ignoring operation failures**
- **ALWAYS verify that the actual business logic succeeded, not just that the endpoint returned 200**
- **Tests that pass while operations fail are WORSE than no tests - they provide false confidence**
- **FORBIDDEN PATTERN**:
  ```python
  # BAD - This test passes even though the update operation failed!
  response = client.patch(f"/vet-portal/api/members/{member_id}", data=data)
  self.assertEqual(response.status_code, 200)  # Passes even if update failed internally
  ```
- **REQUIRED PATTERN**:

  ```python
  # GOOD - Verify the operation succeeded
  response = client.patch(
      f"/vet-portal/api/members/{member_id}",
      data=json.dumps(data),
      content_type="application/json",
  )
  self.assertEqual(response.status_code, 200)

  # ALSO verify the actual result
  response_data = response.json()
  self.assertIn("data", response_data, "Response should contain data")
  self.assertEqual(response_data["data"]["role_name"], "Veterinarian", "Role should be updated")

  # OR verify through a separate query
  membership = OrganizationMembership.objects.get(id=membership.id)
  self.assertEqual(membership.role.name, "Veterinarian", "Database should reflect the update")
  ```

## Vet Portal API Testing

### Test Setup for Vet Portal

Vet portal API tests need a partner, user, and organization context. Create a base test class:

```python
import json

from django.test import Client, TestCase, override_settings

from apps.geography.models import Country
from apps.organizations.models import Organization, OrganizationMembership
from apps.organizations.utils import create_organization
from apps.partners.models import Partner
from apps.permissions.models import Role
from apps.users.models import CustomUser
from apps.web.tests.base import TEST_STORAGES


@override_settings(STORAGES=TEST_STORAGES)
class VetPortalTestBase(TestCase):
    """Base class for vet portal API tests"""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # Create partner
        cls.country = Country.objects.get_or_create(
            code="CO", defaults={"name": "Colombia", "is_active": True}
        )[0]
        cls.partner = Partner.objects.create(
            name="Test Clinic", primary_country=cls.country
        )
        # Create admin user with partner association
        cls.admin_user = CustomUser.objects.create_user(
            username="admin@test.com",
            email="admin@test.com",
            password="testpass123",
            partner=cls.partner,
        )
        # Create admin role with full permissions
        cls.admin_role = Role.objects.create(
            partner=cls.partner, name="Admin", is_superuser=True
        )
        # Create authenticated client
        cls.client = Client()
        cls.auth_client = Client()
        cls.auth_client.login(username="admin@test.com", password="testpass123")
```

### API Test Patterns

All vet portal endpoints use `ApiResponse` format with `data` or `error` keys:

```python
def test_list_members_returns_paginated_results(self):
    """GET /vet-portal/api/members/ returns paginated member list"""
    response = self.auth_client.get("/vet-portal/api/members/")
    self.assertEqual(response.status_code, 200)

    data = response.json()
    self.assertIn("data", data)
    self.assertIn("results", data["data"])
    self.assertIn("count", data["data"])
    self.assertEqual(data["data"]["count"], 2, "Should have exactly 2 members")


def test_create_member_sends_invitation(self):
    """POST /vet-portal/api/members/ creates user with unusable password"""
    payload = {
        "user_email": "new@test.com",
        "first_name": "New",
        "last_name": "User",
        "organization_public_id": self.org.public_id,
        "role_public_id": self.role.public_id,
    }
    response = self.auth_client.post(
        "/vet-portal/api/members/",
        data=json.dumps(payload),
        content_type="application/json",
    )
    self.assertEqual(response.status_code, 200)

    # Verify user was created with unusable password
    user = CustomUser.objects.get(email="new@test.com")
    self.assertFalse(user.has_usable_password(), "New user should not have usable password")
    self.assertEqual(user.partner, self.partner, "User should belong to partner")
```

### Multi-Tenancy / Partner Isolation Tests

**Partner isolation is critical.** Always test that one partner cannot access another partner's data:

```python
def test_cannot_access_other_partner_members(self):
    """Members from other partners should not be visible"""
    # Create another partner with its own member
    other_partner = Partner.objects.create(name="Other Clinic", primary_country=self.country)
    other_user = CustomUser.objects.create_user(
        username="other@test.com", email="other@test.com",
        password="pass", partner=other_partner,
    )

    response = self.auth_client.get("/vet-portal/api/members/")
    self.assertEqual(response.status_code, 200)

    member_emails = [m["user_email"] for m in response.json()["data"]["results"]]
    self.assertNotIn("other@test.com", member_emails, "Should not see other partner's members")


def test_cannot_delete_other_partner_member(self):
    """DELETE on another partner's member should return 404"""
    response = self.auth_client.delete(f"/vet-portal/api/members/{other_member.public_id}")
    self.assertEqual(response.status_code, 404, "Cross-tenant access should return 404")
```

### Cross-tenant isolation requirements

- **GET requests**: Should return 404 for cross-tenant resources (don't reveal existence)
- **POST/PUT/PATCH requests**: Should return 400/404 when referencing cross-tenant resources
- **List endpoints**: Should NEVER include cross-tenant data in results
- **Database queries**: Should be properly filtered by partner scope

## CRITICAL: Security Testing Guidelines

- **Security tests MUST fail immediately when vulnerabilities are detected** - no conditional logic, no reports, no warnings
- **Every security test failure indicates a real vulnerability** that must be investigated and fixed
- **NEVER assume test failures are bugs in the test** - always investigate the source code first
- **Always use `public_id` in API URLs**, never numeric PKs

## Best Practices

### Creating Test Data

- **Always use `create_organization()` utility** from `apps.organizations.utils` instead of `Organization.objects.create()` - it auto-generates slug, sets country/currency, and creates owner membership
- **Use `Model.objects.create()`** for simple models (users, roles, partners)
- **Use factories or helper methods** when setup is complex - put them in the test class or a shared base

### Testing Django Ninja Endpoints

- Send JSON payloads with `content_type="application/json"` and `json.dumps(data)`
- Check both the HTTP status code AND the response body
- Verify database state changes after mutations
- Test both success and error paths

### What to Test in the Vet Portal

- **API endpoints**: All CRUD operations for each resource
- **Permission checks**: Verify `@require_permission` decorators work correctly
- **Partner isolation**: Every endpoint must filter by partner
- **Input validation**: Bad data should return appropriate errors
- **Edge cases**: Deactivating yourself, duplicate memberships, reactivating users
