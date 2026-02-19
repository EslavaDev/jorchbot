---
name: worktree
description: Create an isolated git worktree with unique web server ports for parallel development
allowed-tools:
  [Bash(git worktree list), Bash(git worktree remove *), Bash(bash scripts/create-worktree.sh *)]
---

## Your task

Create an isolated git worktree for parallel development with automatic port allocation for all services (Django, Vite, PostgreSQL, Redis).

**Note:** Each worktree gets its own isolated PostgreSQL and Redis instances running on unique ports.

### Step 1: Parse worktree name

Extract worktree name from user prompt. If unclear, ask user for a descriptive name (kebab-case).

**Examples:**

- User says: "create a worktree for issue 25" → Extract: "issue-25"
- User says: "worktree for WKT validation" → Extract: "wkt-validation"
- User says: "new worktree" → Ask user for a descriptive name

### Step 2: Ask user for base branch

Use AskUserQuestion tool with 2 options:

1. **Branch from `main`** (recommended, default)
2. **Branch from current branch** (to build on existing work)

### Step 3: Run the create-worktree script

Execute the main worktree creation script:

```bash
bash scripts/create-worktree.sh "${worktree_name}" "${base_branch}"
```

**Configuration:**

- The worktree base directory can be customized via `WORKTREE_BASE_DIR` environment variable
- Default: `../worktrees` (relative to repo root)
- To use a custom directory, prefix the command with the environment variable:
  ```bash
  WORKTREE_BASE_DIR=/custom/path bash scripts/create-worktree.sh "${worktree_name}" "${base_branch}"
  ```

**What the script does:**

1. Detects available ports by scanning Docker and system ports
2. Allocates next available port set for all services (Django, Vite, PostgreSQL, Redis)
3. Creates git worktree at `${WORKTREE_BASE_DIR}/${worktree_name}` (default: `../worktrees/${worktree_name}`)
4. Handles branch name conflicts (appends -2, -3, etc.)
5. Copies and configures `.env` with unique ports
6. Updates DATABASE_URL and REDIS_URL to use allocated ports
7. Updates CORS_ALLOWED_ORIGINS to match new Vite port
8. Copies Claude settings for consistent permissions
9. Runs `make setup-env` and `make npm-install-all`
10. Displays success message with next steps

**Port allocation strategy:**

- Main worktree: Django 8000, Vite 5173, PostgreSQL 5432, Redis 6379
- Worktree 1: Django 8001, Vite 5174, PostgreSQL 5433, Redis 6380
- Worktree 2: Django 8002, Vite 5175, PostgreSQL 5434, Redis 6381

**Service isolation:**
Each worktree runs its own PostgreSQL and Redis instances via Docker Compose.

### Step 4: Inform user about next steps

After the script completes successfully, remind the user (use the actual directory path from the script output):

```
The worktree has been created! To start working in it:

1. Change to the worktree directory:
   cd <worktree_path>

2. Start PostgreSQL and Redis:
   make start-bg

3. Start the development servers:
   make dev

4. (Optional) Start a new Claude session in that directory:
   claude

The worktree is fully isolated with its own PostgreSQL and Redis instances running on unique ports.
```

**Note:** The worktree path depends on the `WORKTREE_BASE_DIR` setting (default: `../worktrees/${worktree_name}`). Use the path from the script's success message.

## Edge cases (handled by the script)

The `scripts/create-worktree.sh` script handles these automatically:

1. **No running containers** - Uses default ports: 8000, 5173
2. **Worktree name with spaces/uppercase** - Sanitizes: converts to lowercase and replaces spaces with hyphens
3. **Branch name already exists** - Appends suffix: `-2`, `-3`, etc. and uses that for both branch and directory
4. **Worktree directory already exists** - Exits with error message
5. **.env must exist in repo root** - Script will fail if missing (required)
6. **settings.local.json doesn't exist** - Script skips copying (optional)
7. **Script errors** - Uses `set -e` to fail fast on any error

**Prerequisites:**

- `.env` file must exist in repository root
- Docker must be running (for PostgreSQL and Redis containers)

## Important notes

- **Repo-local skill** - Lives in `.claude/skills/worktree/` within the repository
- **Fully autonomous** - All commands pre-approved via allowed-tools
- **Script-based** - All logic delegated to `scripts/create-worktree.sh`
- **User must cd manually** - Claude cannot change directories persistently
- **Configurable directory** - Worktree location can be customized via `WORKTREE_BASE_DIR` env var (default: `../worktrees`)
- **Fully isolated services** - Each worktree has its own PostgreSQL and Redis instances
- **Unique ports** - All services (Django, Vite, PostgreSQL, Redis) get unique ports
- **Database independence** - Migrations and data in one worktree don't affect others
- **Preserved environment** - All `.env` variables preserved except ports and service URLs
