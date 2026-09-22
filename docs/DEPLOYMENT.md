# Deployment

Build with `docker build -t larkai .`. The multi-stage image builds React with Node 24 and the Axum server with Rust 1.98. The runtime is Debian with CA certificates, curl for health checks and sqlite3 for consistent backups; it runs as UID/GID 10001.

## Configuration

Set these backend variables for production:

```dotenv
FEISHU_MODE=live
HOST=0.0.0.0
PORT=8000
DATABASE_PATH=/app/data/larkai.sqlite3
FRONTEND_DIST=/app/frontend/dist
PUBLIC_ORIGIN=https://dashboard.example.com
OIDC_ISSUER=https://identity.example.com/auth
OIDC_CLIENT_ID=larkai
OIDC_CLIENT_SECRET=your-confidential-client-secret
FEISHU_APP_ID=cli_your_app
FEISHU_APP_SECRET=your-feishu-secret
FEISHU_REDIRECT_URI=https://dashboard.example.com/oauth/callback
RM_AUTO_COLLECT_SECONDS=300
```

Register `PUBLIC_ORIGIN/oidc/callback` with Herkules and `FEISHU_REDIRECT_URI` with Feishu. Herkules must expose OIDC discovery, RS256, ES256 or EdDSA signed ID tokens and UserInfo with `sub` and `role` (`admin` or `member`). Serve through HTTPS. The public origin is the browser-visible origin and must have no path. Session IDs are random and stored in SQLite; no Flask signing secret is used.

Optional Cloudflare Access origin verification uses `CF_ACCESS_ISSUER` (the HTTPS `*.cloudflareaccess.com` team origin) and `CF_ACCESS_AUD`. The origin verifies the signed assertion rather than trusting identity headers. This is independent of a Cloudflare Worker; the frontend currently uses standard Vite hosting only.

## Container and storage

```sh
docker run -d --name larkai -p 8000:8000 --env-file .env \
  -v larkai-data:/app/data larkai
```

Use one container per SQLite database. Named volumes created by this image inherit its writable directory. For an existing bind mount or old volume, grant UID/GID 10001 write access before starting the image. Health is `GET /healthz`; it does not require identity or Cloudflare Access.

The rewrite starts a fresh `larkai.sqlite3`. Existing `rmtask.db` and Flask session files are ignored. Users sign in and reconnect Feishu. Refresh members, then sync to rebuild the data. Existing environment values may remain, but `FLASK_SECRET_KEY`, `RM_DB_PATH` and `RM_MOCK_DATA_DIR` no longer configure the new runtime. Use `DATABASE_PATH`. For live task creation set `FEISHU_BITABLE_SUBMIT_TABLE_ID`; `FEISHU_BITABLE_TASKS_TABLE_ID` is still honored as the submit-table fallback. Bitable mutations use the task's recorded source table.

## Existing GitHub/VPS flow

`.github/workflows/deploy.yml` runs Rust formatting/lints/tests, frontend build/unit/browser tests and deployment-helper tests, then publishes an immutable GHCR image. The deployment job stages the existing Compose and environment helpers over SSH, starts the new image, validates OIDC discovery and signing-key compatibility with `larkai check-auth`, and checks the public authentication redirect. `deploy/compose.yml` connects to the external `herkules_default` network with the `larkai` alias. No host port is published there.

`deploy/apply.sh` backs up the Rust SQLite database when present and rolls back image/configuration if container startup fails. First migration from the Python image does not import old data. The deployment helper initializes the data directory ownership for the unprivileged Rust container. Schema changes should remain compatible with the immediately previous Rust release if automatic rollback is needed.

Use `RUST_LOG=larkai=info,tower_http=info` for logs. Upstream token payloads are not returned to browsers. Do not put server secrets into `VITE_*` variables: they are compiled into the public JavaScript bundle.
