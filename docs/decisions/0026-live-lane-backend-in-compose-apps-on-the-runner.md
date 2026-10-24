# 0026. The live lane runs the backend through `seed-dev.sh` and serves the apps on the runner

- **Status:** Accepted
- **Date:** 2026-10-22
- **Enforced by:** `.github/workflows/e2e-live.yml` (`seed-dev.sh --backend-only`, then `E2E_REAL_API=1`; nightly and on dispatch, not a PR gate); `infra-compose.yml`'s `images` job (every compose-built image builds at its target) and its `node:24-slim` pin check

## Context

`e2e-live` had failed every recorded run (50, from 2026-09-05), so no live journey had ever run
on CI. The run had never got past building images. Behind that were several more breaks:

- the frontend `Dockerfile`s had no `dev` stage, though compose builds that target;
- CI never generated PgBouncer's userlist, and never migrated as the migrator role;
- compose passed `NODE_IMAGE` to `Dockerfile`s that read `NODE_VERSION`;
- the website got environment names it doesn't read, and the dashboard's auth proxy pointed
  at a host that, inside its container, is the container itself.

The user chose (2026-10-22) to repair the compose frontends for local development, to serve the
apps on the runner in CI, and to reuse `seed-dev.sh` for the backend.

## Decision

- **CI backend:** the live lane runs `infra/scripts/seed-dev.sh --backend-only`. That is the
  script a developer runs (random local secrets, the PgBouncer userlist, the RLS assertions,
  migrations as the migrator, `seed_dev_data` and `seed_e2e_data`), stopping short of the compose
  dashboard and website. CI deliberately runs both seeds, so a broken `seed_dev_data` fails the
  lane.
- **CI apps:** Playwright's `webServer` builds and serves the two apps (`e2e/scripts/serve-app.sh`,
  production standalone output), as the PR lane does. `E2E_REAL_API=1` drops only the
  tenant-lookup stub.
- **Local apps:** compose runs them as `next dev` from a new `dev` stage, over the mounted source.
- **Node image:** every image takes its Node image from one `NODE_IMAGE` build arg, defaulting
  to `node:24-slim` in the `Dockerfile`s, compose and `.env.example`, so dev, CI and production
  share it.
- **Auth proxy:** the dashboard's `/api/auth/*` rewrite reads a server-only `API_BASE_URL`
  before `NEXT_PUBLIC_API_BASE_URL`. `next.config.ts` is read at `next build`, so for a
  standalone build the target is fixed then, not at runtime.

## Alternatives considered

- **Run the compose `next dev` apps in CI** — why not: each route compiles on first request, so
  journeys would hit compile latency the PR lane never sees, and CI would test a dev build.
- **Run the production `runner` image in compose for CI** — why not: `NEXT_PUBLIC_*` is inlined
  at build time, so it needs per-environment build args and an override file that duplicate
  `appEnv`.
- **Copy seed-dev's userlist and migrate steps into the workflow** — why not: two setup paths to
  keep in step, and CI would skip seed-dev's RLS assertions.
- **`extra_hosts: api.localhost:host-gateway` for the dashboard proxy** — why not: it leaves
  through the host's published port and relies on host-gateway support.
- **Remove the compose frontends and run the apps natively** — why not: the user chose to keep
  `docker compose up -d` running everything.

## Consequences

- A live run builds both apps cold (e2e-live has no turbo cache). That is expected to fit the 30-minute budget; the first full run measures it.
- The dashboard image can't be pointed at a different auth-proxy API per environment without a
  rebuild (`docs/deferred-work.md`).
- The frontends support only `dev` in compose; `runner` is the deploy image, built outside it.
