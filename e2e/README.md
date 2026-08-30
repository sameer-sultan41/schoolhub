# @schoolhub/e2e

Browser end-to-end tests for the SchoolHub dashboard and public website, built on
[Playwright](https://playwright.dev).

This is the layer above Jest. Jest covers units and components in jsdom; this drives a real
Chromium against a real Next.js production build and asserts what a user actually sees.

## Quick start

```bash
pnpm e2e:install     # one-time: download the Chromium build Playwright pins
pnpm e2e             # build + serve both apps, run the mocked lane
pnpm e2e:ui          # same, in Playwright's watch UI
pnpm --filter @schoolhub/e2e e2e:report   # open the last HTML report
```

Playwright builds and starts the apps itself (`webServer` in `playwright.config.ts` →
`scripts/serve-app.sh`). The build goes through Turborepo, so a warm repeat is near-instant.
Already running the apps? Set `E2E_NO_SERVER=1`.

Both apps set `output: "standalone"` for their Docker image, and **`next start` does not
serve that build** — it reports "Ready" and then answers nothing. `serve-app.sh` runs
`node .next/standalone/apps/<app>/server.js` instead, matching the Dockerfile's `CMD`, and
copies `.next/static` alongside it the way the image does. So the suite exercises the same
server production runs.

## The two lanes

|            | needs                        | runs             | proves                                        |
| ---------- | ---------------------------- | ---------------- | --------------------------------------------- |
| `dashboard`| dashboard build              | every PR         | auth and app flows, API stubbed in-browser    |
| `website`  | website build                | every PR         | host→tenant resolution, unknown-host fallback |
| `live`     | Postgres + Django + both apps| opt-in / nightly | real auth, RLS, cross-tenant isolation        |

The split is forced by where each app fetches. The **dashboard** fetches from the browser
through TanStack Query, so `page.route()` can intercept it and every test gets a hermetic,
per-test API. The **website** renders on the server, so browser interception cannot see its
fetches at all — its mocked specs are limited to what the proxy decides without the API, and
anything needing real rendered content goes in `live`.

Never move a `live` assertion into a mocked project. A stub returns whatever it was told to;
"RLS blocks a cross-tenant read" is only true if a real database enforced it.

### Running the live lane

```bash
docker compose -f infra/compose/docker-compose.yml up -d
# seed a tenant + admin, then:
E2E_API_BASE_URL=http://localhost:8000/api/v1 \
E2E_LIVE_ADMIN_PASSWORD=... \
pnpm e2e:live
```

## Layout

```
e2e/
├── playwright.config.ts     projects, servers, reporters
├── src/
│   ├── env.ts               zod-validated config, defaults for a fresh clone
│   ├── constants.ts         values mirrored from the apps, each covered by a spec
│   ├── fixtures/index.ts    the ONLY import surface for specs
│   ├── pages/               page objects — locators and navigation, never assertions
│   ├── mocks/
│   │   ├── envelope.ts      typed {data,meta} / {error} builders
│   │   ├── router.ts        MockApi — path matching, CORS, call recording
│   │   └── domains/         one file per API domain, composed with `.use(...)`
│   └── data/factories.ts    deterministic API-shaped objects
└── tests/{dashboard,website,live}/
```

## Writing a spec

Import from `@/fixtures` and nothing else:

```ts
import { authModule, schoolOrganizationModule, buildCampus } from "@/mocks";
import { expect, test } from "@/fixtures";

test("lists the tenant's campuses", async ({ page, mockApi, dashboardPage, signedIn }) => {
  mockApi.use(schoolOrganizationModule({ campuses: [buildCampus({ name: "North Campus" })] }));
  await dashboardPage.goto();

  await expect(page.getByRole("cell", { name: "North Campus" })).toBeVisible();
});
```

Rules the suite holds itself to:

- **Locate by role, label, or text** — never a CSS class. A class rename must not break a
  test; a broken accessible name must.
- **Web-first assertions only** — `await expect(locator).toBeVisible()`, never
  `expect(await locator.isVisible()).toBe(true)`. The former retries, the latter flakes.
- **Assertions live in specs, not page objects.** A page object that asserts produces failure
  reports naming a helper instead of the behaviour that broke.
- **Every test is independent.** `fullyParallel` is on; a spec that needs ordering is a bug.
- **Stub through the envelope builders** (`ok`/`fail`/`paginated`), never a raw literal, so a
  contract change is a compile error rather than a test that passes against a dead shape.

## Adding a module

1. Add `src/mocks/domains/<module>.ts` exporting a `MockModule` plus its factories.
2. Re-export it from `src/mocks/index.ts`.
3. Add a page object under `src/pages/dashboard/<module>/`.
4. Add specs under `tests/dashboard/`.

Nothing else changes — no config edit, no new project.

## Selectors

There are no `data-testid` attributes in the apps today, and that is deliberate: the accessible
name is the contract. Add `data-testid` only when a control genuinely has no accessible name
that can identify it, and treat needing one as a signal the component has an accessibility gap.
