# Frontend Testing Guidelines (Vitest + React Testing Library)

## Quick Reference

- **Framework**: Vitest + React Testing Library + TypeScript
- **State Management**: React Context (PermissionContext)
- **Component Testing**: Test user interactions, not implementation details
- **Run Tests**: `npm run test` (in `frontend/vet-portal/`)
- **Run Single File**: `npx vitest run src/features/members/MemberList.test.tsx`
- **Query Priority**: `getByRole` > `getByLabelText` > `getByText` > `getByTestId`
- **Global Mocks**: `gettext` and `interpolate` for Django JS i18n catalog

## CRITICAL: AI Agent Instructions

### Multiple Test File Generation Workflow

**ABSOLUTELY FORBIDDEN: Creating multiple test files simultaneously**

**REQUIRED WORKFLOW when generating multiple test files:**

1. **Create ONLY ONE test file**
2. **Immediately run the test**: `npx vitest run ComponentName.test.tsx`
3. **Fix ALL failing tests** in that single file
4. **CRITICAL: Check for warnings/errors even if tests pass**
   - Look for "unhandled promise rejection"
   - Look for "unhandled error"
   - Look for console warnings/errors
   - Look for act() warnings
   - **ALERT USER immediately if ANY warnings/errors exist**
5. **Verify ALL tests pass AND no warnings/errors** before proceeding
6. **Only after complete success, create the next test file**
7. **Repeat this process** for each subsequent test file

**Why this matters for AI agents:**

- Multiple files = multiple points of failure = debugging nightmare
- Each file has unique mocking requirements
- Dependencies between tests are unpredictable
- Error messages become unclear when multiple files fail
- **Passing tests with errors = false confidence and future bugs**

### Snapshot Testing Rules

**Snapshots are valid but insufficient for complete testing:**

**DO use snapshots for:**

- Structural regression testing
- HTML output verification

**DO NOT rely only on snapshots because:**

- They don't test component behavior
- They don't verify user interactions
- They don't test state changes

**REQUIRED: Always combine snapshots with behavior tests.**

## Core Testing Principles

### 1. Test Structure

**CRITICAL: Always use fresh mocks in beforeEach to ensure test isolation**

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { ComponentName } from "./ComponentName";

// Mock dependencies
vi.mock("@/api/client", () => ({
  apiClient: {
    listMembers: vi.fn(),
    getMember: vi.fn(),
  },
}));

describe("ComponentName", () => {
  let mockListMembers: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Initialize fresh mock data for each test
    mockListMembers = vi.fn().mockResolvedValue({
      data: {
        results: [{ public_id: "mem_1", user_display_name: "John Doe" }],
        count: 1,
        total_pages: 1,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Tests go here
});
```

### 2. Context Provider Pattern (REQUIRED)

The vet portal uses `PermissionContext`. Always wrap components that need it:

```typescript
import { PermissionContext } from '@/contexts/PermissionContext';

const defaultPermissions = {
  is_superuser: false,
  modules: {
    users: { create: true, read: true, edit: true, delete: true },
    settings: { create: false, read: true, edit: true, delete: false },
  },
};

const renderWithPermissions = (
  ui: React.ReactElement,
  permissions = defaultPermissions
) => {
  const can = (module: string, action: string) => {
    if (permissions.is_superuser) return true;
    return permissions.modules[module]?.[action] ?? false;
  };

  return render(
    <PermissionContext.Provider value={{ ...permissions, can }}>
      {ui}
    </PermissionContext.Provider>
  );
};
```

### 3. Query Priority and Best Practices

Follow this query priority (most accessible to least):

1. **`getByRole`** - Primary choice for accessibility

```typescript
screen.getByRole("button", { name: /save/i });
screen.getByRole("textbox", { name: /email/i });
screen.getByRole("tab", { name: /members/i });
```

2. **`getByLabelText`** - Best for form fields

```typescript
screen.getByLabelText(/email/i);
screen.getByLabelText("First Name");
```

3. **`getByPlaceholderText`** - When no label exists

```typescript
screen.getByPlaceholderText(/select branch/i);
```

4. **`getByText`** - For non-interactive elements

```typescript
screen.getByText(/no members yet/i);
screen.getByText("Team Members");
```

5. **`getByTestId`** - Last resort only

### 4. Common Global Mocks

Most vet portal tests require these standard mocks:

```typescript
// Django JS i18n catalog (required for most components)
// These are global functions provided by Django's JavaScript catalog
vi.stubGlobal("gettext", (text: string) => text);
vi.stubGlobal("interpolate", (fmt: string, args: any[]) => {
  let result = fmt;
  args.forEach((arg, i) => {
    result = result.replace("%s", String(arg));
  });
  return result;
});

// React Router mocks (when testing routed components)
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ id: "test_123" }),
  };
});

// Icon mocks (when using lucide-react, optional)
vi.mock("lucide-react", async () => {
  const actual = await vi.importActual("lucide-react");
  return { ...actual };
});
```

### 5. User Interaction Testing

**Use `userEvent` for realistic interactions (preferred):**

```typescript
import userEvent from '@testing-library/user-event';

it('should submit form with valid data', async () => {
  const user = userEvent.setup();

  renderWithPermissions(<MemberDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />);

  await user.type(screen.getByLabelText(/first name/i), 'Jane');
  await user.type(screen.getByLabelText(/last name/i), 'Doe');
  await user.type(screen.getByLabelText(/email/i), 'jane@example.com');

  await user.click(screen.getByRole('button', { name: /save/i }));

  await waitFor(() => {
    expect(apiClient.createMember).toHaveBeenCalledWith(
      expect.objectContaining({
        user_email: 'jane@example.com',
        first_name: 'Jane',
        last_name: 'Doe',
      })
    );
  });
});
```

**Use `fireEvent` for simple interactions:**

```typescript
import { fireEvent } from '@testing-library/react';

it('should filter by organization', () => {
  render(<MemberList />);

  const select = screen.getByRole('combobox');
  fireEvent.change(select, { target: { value: 'org_123' } });

  expect(apiClient.listMembers).toHaveBeenCalledWith(1, 20, 'org_123', 'active');
});
```

## Testing Patterns

### 1. Testing API-Connected Components

```typescript
import { apiClient } from '@/api/client';

vi.mock('@/api/client', () => ({
  apiClient: {
    listMembers: vi.fn(),
    listOrganizations: vi.fn(),
  },
}));

describe('MemberList', () => {
  beforeEach(() => {
    vi.mocked(apiClient.listMembers).mockResolvedValue({
      data: {
        results: [
          {
            public_id: 'mem_1',
            user_display_name: 'John Doe',
            user_email: 'john@test.com',
            user_avatar_url: '',
            organization_public_id: 'org_1',
            organization_name: 'Main Branch',
            role_public_id: 'role_1',
            role_name: 'Veterinarian',
            has_usable_password: true,
            created_at: '2026-01-01',
            updated_at: '2026-01-01',
          },
        ],
        count: 1,
        total_pages: 1,
        next: null,
        previous: null,
      },
    });

    vi.mocked(apiClient.listOrganizations).mockResolvedValue({
      data: { results: [], count: 0, total_pages: 0, next: null, previous: null },
    });
  });

  it('should display members after loading', async () => {
    renderWithPermissions(<MemberList />);

    expect(await screen.findByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('john@test.com')).toBeInTheDocument();
    expect(screen.getByText('Main Branch')).toBeInTheDocument();
  });
});
```

### 2. Testing Tabs

```typescript
it('should show active and pending tabs with counts', async () => {
  // Mock active members
  vi.mocked(apiClient.listMembers)
    .mockResolvedValueOnce({ data: { results: [activeMember], count: 1, total_pages: 1 } })  // active
    .mockResolvedValueOnce({ data: { results: [pendingMember], count: 2, total_pages: 1 } }); // pending

  renderWithPermissions(<MemberList />);

  // Wait for tabs to render with counts
  expect(await screen.findByRole('tab', { name: /members/i })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /pending invitations/i })).toBeInTheDocument();
});
```

### 3. Testing Permission-Gated UI

```typescript
it('should hide Add Member button without create permission', () => {
  const noCreatePerms = {
    ...defaultPermissions,
    modules: {
      ...defaultPermissions.modules,
      users: { create: false, read: true, edit: false, delete: false },
    },
  };

  renderWithPermissions(<MemberList />, noCreatePerms);

  expect(screen.queryByRole('button', { name: /add member/i })).not.toBeInTheDocument();
});

it('should show Add Member button with create permission', () => {
  renderWithPermissions(<MemberList />);

  expect(screen.getByRole('button', { name: /add member/i })).toBeInTheDocument();
});
```

### 4. Testing Loading States

```typescript
it('should show skeleton during initial load', () => {
  // Don't resolve the API call
  vi.mocked(apiClient.listMembers).mockReturnValue(new Promise(() => {}));

  renderWithPermissions(<MemberList />);

  expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
});
```

### 5. Testing Error States

```typescript
it('should display error message on API failure', async () => {
  vi.mocked(apiClient.createMember).mockRejectedValue(new Error('Email already exists'));

  const user = userEvent.setup();
  renderWithPermissions(
    <MemberDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />
  );

  // Fill form and submit
  await user.click(screen.getByRole('button', { name: /save/i }));

  await waitFor(() => {
    expect(screen.getByText(/email already exists/i)).toBeInTheDocument();
  });
});
```

### 6. Testing Confirmation Dialogs

```typescript
it('should show deactivation confirmation on delete', async () => {
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const user = userEvent.setup();

  renderWithPermissions(
    <MemberDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} memberPublicId="mem_1" />
  );

  await user.click(screen.getByRole('button', { name: /deactivate/i }));

  expect(confirmSpy).toHaveBeenCalledWith(
    expect.stringContaining('deactivate')
  );

  confirmSpy.mockRestore();
});
```

### 7. Testing Form Validation

```typescript
it('should show validation error when email is missing', async () => {
  const user = userEvent.setup();
  renderWithPermissions(
    <MemberDialog open={true} onClose={vi.fn()} onSaved={vi.fn()} />
  );

  // Try to save without filling email
  await user.type(screen.getByLabelText(/first name/i), 'Jane');
  await user.type(screen.getByLabelText(/last name/i), 'Doe');
  await user.click(screen.getByRole('button', { name: /save/i }));

  expect(screen.getByText(/email is required/i)).toBeInTheDocument();
});
```

## TypeScript Patterns

### Typing Test Utilities

```typescript
import { render, RenderResult } from "@testing-library/react";
import { ReactElement } from "react";

interface RenderWithPermissionsOptions {
  permissions?: PermissionsResponse;
}

const renderWithPermissions = (
  ui: ReactElement,
  options?: RenderWithPermissionsOptions,
): RenderResult => {
  // Implementation
};
```

## Assertion Patterns

### Common Matchers

```typescript
import "@testing-library/jest-dom";

// Visibility
expect(element).toBeVisible();
expect(element).toBeInTheDocument();
expect(element).not.toBeInTheDocument();

// Form elements
expect(input).toBeEnabled();
expect(input).toBeDisabled();
expect(input).toHaveValue("test");
expect(checkbox).toBeChecked();

// Text content
expect(element).toHaveTextContent("Hello");
expect(element).toHaveTextContent(/hello/i);

// Attributes
expect(element).toHaveAttribute("href", "/path");
expect(element).toHaveClass("active");

// Accessibility
expect(element).toHaveAccessibleName("Submit");
```

### Mock Verification

```typescript
// Call count
expect(mockFn).toHaveBeenCalledTimes(1);
expect(mockFn).not.toHaveBeenCalled();

// Arguments
expect(mockFn).toHaveBeenCalledWith("arg1", "arg2");
expect(mockFn).toHaveBeenCalledWith(expect.objectContaining({ user_email: "test@example.com" }));
```

## File Structure

Test files live alongside their components:

```
features/
  members/
    MemberList.tsx
    MemberList.test.tsx
    MemberDialog.tsx
    MemberDialog.test.tsx
```

## Required Rules

1. **Use fresh mocks in beforeEach** - Initialize all mock data and functions in `beforeEach`, never as constants
2. **Prefer `getByRole`** - Most accessible query method
3. **Use `userEvent`** for complex interactions, `fireEvent` for simple ones
4. **Use `waitFor`** for async operations
5. **Mock context providers** - Always wrap components with `PermissionContext`
6. **Test behavior** - Not implementation details
7. **Use TypeScript** - Type all test utilities and mocks
8. **ALWAYS mock `gettext` and `interpolate`** - These are Django JS catalog globals
9. **NEVER ignore act() warnings** - They indicate async issues
10. **NEVER test private methods** - Only test through public API
11. **ONE test file at a time** - Fix completely before moving on
12. **Test edge cases** - Empty states, permission variations, API failures, loading states
13. **Verify API calls** - Check that the right API methods are called with correct arguments

## Test Requirements Checklist

**For AI Agents - Verify EVERY item before proceeding:**

- [ ] **ONE test file at a time** - Never create multiple simultaneously
- [ ] **Run test after creation** - `npx vitest run ComponentName.test.tsx`
- [ ] **CRITICAL: Check for warnings/errors even if tests pass**
- [ ] **ALERT USER if ANY warnings/errors exist**
- [ ] **All tests green AND no warnings/errors** before moving to next file
- [ ] **Use fresh mocks in beforeEach** - Declare variables with `let`, initialize in `beforeEach`
- [ ] Mock `gettext` and `interpolate` globals
- [ ] Use semantic describe grouping (Rendering, Behavior, Submission, etc.)
- [ ] Prefer `getByRole` over other query methods
- [ ] Wrap components with `PermissionContext` provider
- [ ] Mock API calls from `@/api/client`
- [ ] Use `waitFor` for async assertions
- [ ] Test all states: loading, error, success, empty, permission-denied
- [ ] Test edge cases: API failures, empty lists, pagination

## Common Pitfalls to Avoid

1. **Not awaiting async operations**

   ```typescript
   // BAD
   user.click(button);
   expect(mockFn).toHaveBeenCalled();

   // GOOD
   await user.click(button);
   await waitFor(() => {
     expect(mockFn).toHaveBeenCalled();
   });
   ```

2. **Forgetting to mock gettext/interpolate**

   ```typescript
   // BAD - Components crash with "gettext is not defined"
   render(<MemberList />);

   // GOOD - Mock globals first
   vi.stubGlobal('gettext', (t: string) => t);
   vi.stubGlobal('interpolate', (fmt: string, args: any[]) => { ... });
   ```

3. **Not wrapping with PermissionContext**

   ```typescript
   // BAD - Components crash or show no UI
   render(<MemberList />);

   // GOOD
   renderWithPermissions(<MemberList />);
   ```

4. **Using wrong query methods**

   ```typescript
   // BAD - fragile
   screen.getByTestId("submit-button");

   // GOOD - accessible
   screen.getByRole("button", { name: /save/i });
   ```
