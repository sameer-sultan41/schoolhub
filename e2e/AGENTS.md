# AGENTS.md — `e2e/`

Playwright browser suite for the dashboard and the public website.
Read [`README.md`](README.md) first; it has the lane split, the layout, and how to add a
module. This file is only the rules that are easy to get wrong.

## The one rule that matters

**A stubbed API proves nothing about the server.** `MockApi` returns exactly what the test
told it to, so an assertion like "a cross-tenant read is denied" is vacuous in the
`dashboard` project — it passes whether or not RLS is even enabled. Anything whose truth
depends on the database or the API belongs in `tests/live/`.

Corollary: the `website` project can only assert what the proxy decides *before* any fetch,
because the website renders on the server and browser interception cannot see its requests.

## Conventions

- Specs import from `@/fixtures` only. Add a capability as a fixture, not as a helper
  call repeated in each spec.
- Page objects hold locators and navigation. **No `expect` inside `src/pages/`** — a
  failure must name the behaviour, not a helper.
- Locate by role, label, or text. No CSS classes, and no `data-testid` unless a control
  genuinely has no accessible name (which is itself an accessibility bug worth fixing).
- Build stub responses with `ok` / `fail` / `paginated` from `src/mocks/envelope.ts`.
  A raw object literal will not break when the contract changes; the builders will.
- `fail(status, …)` derives the error code from the status using the same map as
  `apps/api/core/api/exceptions.py`. Override `code` only for a genuine domain code.
- Every spec is independent — `fullyParallel` is on.

## The auth throttle — and why every live browser spec logs in for itself

`AuthEndpointThrottle` (`apps/api/core/api/throttling.py`) allows only 10 requests/minute
per IP across login/refresh/logout combined. A real login per test blows through that the
moment `tests/live/` grows past a handful of specs, so don't do that either — but the
"share one login" fix has a sharp edge, confirmed against the real API, not assumed:

- **Refresh tokens rotate** (`core/rbac/views.py::RefreshView`). Any browser spec that
  does a cold, session-restoring navigation (`dashboardPage.goto()`) triggers a real
  `/auth/refresh` call, which rotates the refresh cookie. `tests/live/live.setup.ts`'s
  shared `storageState` file is therefore safe for **at most one** such spec per run —
  the second one to reuse it gets a 401, its token family already rotated away by the
  first. `fullyParallel` gives no guaranteed file order to make "the first one" reliable
  even if only two specs ever did this.
- So: **every live browser spec does its own real login**, guest context —
  `test.use({ storageState: { cookies: [], origins: [] } })` at the top of the file, then
  `loginPage.signIn(...)` — the same pattern `login.spec.ts`, `session.spec.ts`,
  `dashboard-summary.spec.ts` and `tenant-isolation.spec.ts` all use. That's ~8 real
  logins per full run today (the two admission-journey tests and the two-identity
  promotion journey each carry more than one), plus a refresh per cold navigation, which
  counts against the same 10/min budget. Re-check that math before adding another one —
  and prefer spending an existing session over opening a new one.
- A **two-actor** journey (an approval workflow: promotions today, transfers and leave
  later) needs two authenticated sessions at once. Use the `signInAsSecondIdentity`
  fixture, which signs the second identity into its own browser context: the first stays
  signed in while the second acts, so the journey costs two logins rather than the three
  a sign-out/sign-in-again shuffle would.
- `live.setup.ts`/`playwright.config.ts`'s `live-setup` project stays wired up for a
  future spec that is genuinely safe to share (one that never triggers its own refresh),
  but nothing uses it today — read `live.setup.ts`'s own header before reaching for it.
- API specs (`tests/live/api/`) destructure the worker-scoped `liveApiClient` fixture
  (`src/fixtures/index.ts`, wired to `src/lib/live-api.ts`) — one real login per worker,
  not per test or per file. This one has no rotation problem: it's a raw `fetch`-based
  session, not a browser `storageState`, so nothing else tries to reuse its cookie.
  `liveOtherTenantApiClient` is the same thing for the *other* tenant's admin: every
  cross-tenant isolation probe shares it, so the third such spec costs no extra login.
  A narrower identity a single spec needs (a `student`, a `principal`) still calls
  `createLiveSession(credentials)` itself — that's one login per test, so keep those to
  one test per file.

## Mirrored values

`src/constants.ts` copies a few values out of the apps (the session cookie name, the
tenant headers) because the apps are not published packages. Each one is covered by a
behavioural spec, so drift fails a test. If you add one, add the spec too.

## Do not

- Do not run the suite locally to "check" a change — commit, push, read CI
  (root `AGENTS.md`).
- Do not add a `live` spec to the PR gate. It needs the compose stack; the gate runs
  `--project=dashboard --project=website` only.
- Do not weaken a `live` assertion into a mocked one to make it pass.
