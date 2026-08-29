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
