# RoboMaster Research Hub

A Rust/Axum API and React/TypeScript frontend built with Vite. The hub collects Feishu tasks, Bitable records and calendar events, and provides a member task workspace, team task board and dependency graph, and an actionable team overview.

This is a clean rewrite. It creates `data/larkai.sqlite3`; old Flask databases, sessions, routes and mock JSON files are not migrated. Sign in, connect Feishu, refresh members and sync to rebuild the workspace.

## Run locally

Requires Rust 1.98+ and Node.js 24 (22.12+ is also supported).

```sh
make setup                       # dependencies and .env.example → .env
make run                         # build React and serve everything on localhost:8000
```

The default `.env.example` uses `FEISHU_MODE=mock`. Click **Demo login** to manage local tasks without credentials. The demo starts empty and persists in SQLite.

For frontend development, run these in separate terminals:

```sh
cargo run -p larkai              # Axum on 127.0.0.1:8000
make dev                        # Vite on 127.0.0.1:5173, with API/auth proxies
```

For live OAuth through Vite, set `FEISHU_REDIRECT_URI=http://127.0.0.1:5173/oauth/callback` and register that exact callback with Feishu. Use the same browser hostname throughout the flow. Production serves the built frontend directly from Axum; no Node process is needed at runtime. Cloudflare Worker deployment is intentionally deferred.

## Live mode

Set `FEISHU_MODE=live`, `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_REDIRECT_URI` and the required `FEISHU_SCOPES`. Configure `FEISHU_BITABLE_APP_TOKEN` or `FEISHU_WIKI_NODE_TOKEN` for Bitable collection. When a Bitable is configured, set `FEISHU_BITABLE_SUBMIT_TABLE_ID` (the tracked 任务管理表 id) so created tasks land in the collected base; creation is refused with an actionable error instead of silently creating a task-v2 item that never appears on the board. `FEISHU_BITABLE_TASKS_TABLE_ID` remains a legacy submit-table fallback. Task-v2 creation is only used when no Bitable is configured. Each Bitable task retains its source table, so updates and deletes return to the correct table.

Production uses Herkules OIDC for website sign-in and a separate Feishu connection linked to the immutable OIDC subject. Herkules UserInfo controls admin roles. Without OIDC, `FEISHU_ADMIN_OPEN_IDS` controls admins; if unset, the first Feishu login becomes admin.

Team Overview is the shared team view. My Tasks is the default landing page and matches assignments to the connected Feishu identity. Members can create tasks for anyone and update supported statuses directly. Task actions require a connected account. Sync, member refresh, diagnostics, settings and deletion additionally require admin access. When OIDC is configured, every protected request validates the signed identity and the server-side role established at sign-in. Optional Cloudflare Access JWT verification remains supported.

## Checks

```sh
make check                      # rustfmt, clippy, TypeScript, production build
make test                       # Rust HTTP/contract tests, frontend units, deploy helper tests
cd frontend
npx playwright install chromium # once
npm run test:e2e                # browser task lifecycle + responsive layout
```

Browser tests start an isolated mock backend with an in-memory database and email disabled. They do not connect to Feishu.

## Deploy

```sh
docker build -t larkai .
docker run --rm -p 8000:8000 --env-file .env -v larkai-data:/app/data larkai
```

The container runs one Rust process as an unprivileged user and includes the compiled frontend. Mount a writable data volume. An existing host bind mount must allow UID/GID `10001` to write. Keep credentials in backend environment variables, never `VITE_*` variables.

The existing GitHub deployment workflow builds/tests the Rust and React projects and publishes the container. No deployment is performed by local build/test commands. See [deployment](docs/DEPLOYMENT.md) for Herkules, HTTPS and volume setup.

## Utilities and layout

`make collect` runs one collection and digest pass using a stored Feishu connection. Set `RM_AUTO_COLLECT_SECONDS=300` to collect in the server periodically; zero disables it. Run one server instance per SQLite database so the collection and refresh locks cover all writers.

```text
backend/src/       Axum routes, auth, Feishu provider, models, store and notifications
backend/migrations/ SQLite schema (SQLx)
backend/tests/     HTTP, authorization and mocked upstream contract tests
frontend/src/      React UI, typed API client and styles
frontend/e2e/      Playwright browser tests
deploy/            Docker Compose and deployment helpers
```

[Task graph](docs/TASK_GRAPH.md) · [Architecture](docs/ARCHITECTURE.md) · [Feishu setup](docs/FEISHU_SETUP.md) · [Collection](docs/COLLECTION.md) · [Task operations](docs/INTERACTIVE_TASKS.md) · [Email](docs/EMAIL_NOTIFICATIONS.md)

### Authentication and Feishu permissions

OIDC sign-in validates the provider ID token and checks UserInfo once to obtain the current role. Requests then validate that ID token locally against cached signing keys; tokens stay in the server-side session, behind an HttpOnly cookie. Discovery and JWKS caches last five minutes. Unknown keys trigger a refresh at most once per 30 seconds. Signature, issuer, audience, subject and expiry remain enforced. Sessions are capped at 15 minutes and the token expiry, so role changes and account disabling take effect at the next sign-in within that window. Existing sessions without an ID token must sign in again after upgrading.

Feishu authorization always requests `contact:contact.base:readonly` and `base:field:read` in addition to `FEISHU_SCOPES`. Enable these **user** permissions in the Feishu app console and publish/approve the app configuration if required by the tenant, then use **Administration → Reconnect Feishu** to grant them. Updating the scope configuration does not expand an existing token’s grants. Directory visibility is still limited to the app/user’s permitted organization range. Collection uses pages of 50 and follows cursors; it retains the previous source data on failure.

Message collection is disabled. Sync does not fetch chat history, and authorization filters message scopes out of `FEISHU_SCOPES`. Chat membership lookup remains available for the member directory.

## V1 workspace

- **My Tasks** (`/`): personal assignments, active work first, deadline/blocker counts, task creation and status updates. Finished tasks are hidden by default.
- **Team tasks** (`/tasks`): team-wide search, division/status filters, board and dependency graph.
- **Team overview** (`/overview`): completion progress, overdue/blocked/unassigned work, next-seven-day deadlines and per-person task summaries. Counts and rows link to filtered tasks or their graph context.
- **Administration** (`/settings`): sync, directory refresh, Feishu reconnection, email settings, delivery log and diagnostics. Timeline and workload URLs remain available for existing links but are removed from primary navigation.

Bitable and local tasks support pending, in progress, paused, completed and cancelled statuses. Native Feishu task-v2 records retain completion/cancellation controls; intermediate statuses are not offered for that source. Existing connection and administrator checks remain enforced.
