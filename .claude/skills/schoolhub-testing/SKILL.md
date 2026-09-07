---
name: schoolhub-testing
description: Use when writing, editing, or reviewing tests anywhere in this repo (apps/api, apps/dashboard, apps/website, e2e) — phrases like "write tests for this endpoint/component/spec", "add coverage", "test this view/hook/screen", or any edit to `apps/api/**/tests/**`, `apps/dashboard/src/**/*.test.ts(x)`, `apps/website/src/**/*.test.ts(x)`, or `e2e/tests/**`. Routes to the right layer and tooling for the file being touched, and — the thing most likely to be gotten wrong — which of the three lanes (Jest-mocked, E2E-mocked, E2E-live) a given assertion actually belongs in, per e2e/AGENTS.md's "a stubbed API proves nothing about the server." SKIP for non-test edits.
---

# SchoolHub Testing Skill

## Purpose

This repo has four independent test surfaces with different runners and different
truths they can prove. Picking the wrong one is the most common mistake: a Jest test
with a mocked API "proving" cross-tenant isolation proves nothing, because the mock
returns whatever it was told to.

## Which layer does this belong in?

| You're testing | Layer | Where |
| --------------- | ----- | ----- |
| A Django model, service, serializer, validator, permission class, or API endpoint | Backend | `apps/api/apps/<module>/tests/` or `apps/api/core/<area>/tests/` |
| A dashboard/website React component, hook, form, or route handler in isolation | Jest + RTL | co-located `*.test.ts(x)` next to the source file |
| A user-visible flow through the dashboard or website, with the API stubbed in-browser | E2E mocked | `e2e/tests/dashboard/` or `e2e/tests/website/` |
| Anything whose correctness depends on the real database, real RLS, real cross-tenant isolation, or a real login/refresh cycle | E2E live | `e2e/tests/live/` |

**The one rule that matters (e2e/AGENTS.md):** if the assertion would still pass with
the API mocked out from under it, it does not belong in `live` — but if the assertion's
truth *depends on the database enforcing something* (RLS, a cross-tenant 404, a unique
constraint), it can only go in `live`. Never weaken a `live` assertion into a mocked one
to make it pass, and never add a `live` spec to the PR gate (`e2e/AGENTS.md`).

## Backend — `apps/api`

Read `apps/api/AGENTS.md` and `apps/api/docs/ENGINEERING_STANDARDS.md` §5 first.

1. **Django's built-in test runner, not pytest.** `apps/api/apps/ENGINEERING_STANDARDS.md`
   and CI (`uv run coverage run manage.py test`) are the ground truth — `TestCase` /
   `rest_framework.test.APITestCase`. (`docs/07-quality/testing-strategy.md` §2 mentions
   pytest; the code disagrees with the doc, and the code + CI win.)
2. **PostgreSQL only, never SQLite** — RLS cannot be exercised on any other backend.
3. **Factories, not fixtures.** Every module has its own `tests/factories.py`
   (`factory.django.DjangoModelFactory`), which write through the tenant-scoped default
   manager inside `tenant_context(...)` — see `apps/academics/tests/factories.py`'s
   module docstring for why. Reuse an existing factory before writing a new one; import
   cross-module factories from their owning app (e.g. `StaffFactory` from
   `apps.staff_management.tests.factories`).
4. **A shared `tests/base.py` `APITestCase` subclass per module** builds the minimum
   object graph every endpoint needs (session → class → section → curriculum, etc.) in
   `setUp`, and calls `authenticate(self.client, self.user)` +
   `enable_feature(self.tenant, "module.<name>")`. Extend the module's own base class
   rather than duplicating that setup.
5. **Permission tests use `self.allow("module.resource.action")`** (granted mid-test to
   assert a 403→200 transition) — see `apps/academics/tests/test_api.py`.
6. **Every new endpoint needs a `test_cross_tenant.py` entry.** Pattern: grant every
   permission key in the module so a denial can only come from tenant scoping, create
   parallel tenant-A/tenant-B data, assert tenant-A callers get **404, never 403** against
   tenant-B resources (list leakage, detail read, create-with-foreign-reference, update,
   delete, export, search). A module PR without this for its new endpoints fails review
   by definition (`docs/07-quality/testing-strategy.md` §3).
7. **RBAC:** if you add or rename a permission key, update the seed matrix and the
   module doc's §4 table in the same PR — CI fails otherwise.
8. **Money paths (`fees`, `payroll`):** assert ledger-balance invariants and
   append-only-ness; never let a test UPDATE/DELETE a ledger row and expect it to work.
9. **Celery tasks:** run eager in tests; cover retry/failure paths, not just the happy
   path.
10. **Do not run `manage.py test` locally.** Commit, push, read CI — CI is the source of
    truth (root `AGENTS.md`, `apps/api/AGENTS.md` rule 8).

## Frontend components — `apps/dashboard`, `apps/website`

Read the app's own `AGENTS.md` first (`apps/dashboard/AGENTS.md` §"Hard Rules" 6,
`apps/website/AGENTS.md`'s testing note).

1. **Jest + React Testing Library**, via `next/jest` (`jest.config.ts` in each app) —
   the spec (`docs/07-quality/testing-strategy.md`) says Vitest; the team chose Jest, and
   the actual config wins.
2. **Co-locate as `*.test.ts(x)`** next to the file under test (`src/proxy.test.ts` next
   to `src/proxy.ts`, `src/app/page.test.tsx` next to `src/app/page.tsx`, etc.) — this
   repo does not use a mirrored `__tests__/` tree.
3. **Global test setup lives in each app's `jest.setup.ts`** — `matchMedia`,
   `ResizeObserver`, pointer-capture and `scrollIntoView` shims for jsdom gaps that
   Radix/Recharts hit unconditionally, plus default `NEXT_PUBLIC_*` env vars. Extend that
   file for a new jsdom gap rather than shimming it per-test.
4. **Coverage floor is 85%** (branches/functions/lines/statements, global) per app,
   enforced by each `jest.config.ts`'s `coverageThreshold` — a PR that drops it fails its
   own app's CI test job, isolated from lint/typecheck/build/E2E
   (`docs/07-quality/testing-strategy.md` §9.6).
5. **`apps/website` is server-rendered**, so a Jest test cannot intercept its fetches —
   Jest coverage there is limited to what runs before any fetch (host resolution in
   `src/lib/host.ts`, the proxy's header-stripping, the unknown-host fallback). Real
   rendered tenant content needs `e2e/tests/live`.
6. **Never test the access token going into `localStorage` or a readable cookie** — if a
   test needs that to pass, the code under test is the bug, not the test.

## Browser E2E — `e2e/`

Read `e2e/README.md` (layout, lanes, `pnpm e2e` / `pnpm e2e:live` commands) and
`e2e/AGENTS.md` (the auth-throttle rules) before writing a spec — do not paraphrase them,
follow them, especially the login-throttle section if the spec touches `live`.

1. **Import from `@/fixtures` only.** Add a capability as a fixture, not a helper
   repeated across specs.
2. **Page objects (`src/pages/`) hold locators and navigation, never `expect`** — a
   failing assertion must name the behaviour, not a helper.
3. **Locate by role, label, or text.** No CSS classes; no `data-testid` unless the
   control genuinely has no accessible name (itself an accessibility bug worth filing).
4. **Build stub responses with `ok`/`fail`/`paginated` from `src/mocks/envelope.ts`** —
   never a raw object literal; the builders track the real error-code map
   (`apps/api/core/api/exceptions.py`) and break loudly when the contract changes.
5. **Every spec is independent** (`fullyParallel: true`) — do not depend on spec order or
   shared mutable state across files, except the one shared `live-setup` login the auth-
   throttle section explicitly allows.
6. **`live` specs each do their own real login** (guest `storageState`, then
   `loginPage.signIn(...)`) — refresh-token rotation makes a shared session unsafe past
   one cold navigation per run. `tests/live/api/*` specs use the worker-scoped
   `liveApiClient` fixture instead, which *is* safe to share (raw fetch, no
   `storageState`).
7. **Don't run the suite locally to "check" a change** — commit, push, read CI
   (`e2e/AGENTS.md`). `pnpm e2e:live` is for deliberate local exploration against a real
   stack, not a pre-commit habit.
8. **Never add a `live` spec to the PR gate** — the gate runs
   `--project=dashboard --project=website` only; `live` needs the compose stack and runs
   opt-in / nightly.

## Related

- `docs/07-quality/testing-strategy.md` — the full strategy (test pyramid, cross-tenant
  suite, RBAC matrix, money invariants, CI gates). Treat it as intent; where it names a
  tool the actual config/CI contradicts (pytest, Vitest), the code wins.
- `apps/api/docs/ENGINEERING_STANDARDS.md` §5 — backend testing rules, condensed.
- `e2e/README.md` and `e2e/AGENTS.md` — layout, lanes, and the auth-throttle reasoning.
- Root `AGENTS.md` and each app's own `AGENTS.md` — never run tests locally; CI is the
  source of truth.
