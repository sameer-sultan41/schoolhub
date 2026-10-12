# 0024. A directory's list state lives in the URL, written in place with `history.replaceState`

- **Status:** Accepted
- **Date:** 2026-10-12
- **Enforced by:** `apps/dashboard/src/hooks/__tests__/use-data-grid-url-state.test.tsx` and `use-url-params.test.tsx` (the hook's contract), the directory tests in `features/students/__tests__/` and `features/staff/__tests__/`, and `e2e/tests/dashboard/list-url-state.spec.ts`; that a new list screen uses the hook is review only (`schoolhub-dashboard-screen` skill)

## Context

`/students` and `/staff` kept every list control in `useState`, so a reload lost the view and a
filtered list could not be shared. The pre-shell-reset dashboard had kept this in the URL
(`useSearchParam`, `useTableParams`, `useDataGridTableParams`, deleted in b59a25e and 9548054), but no record
said so, and the rebuilt screens did not carry it over. The user decided on 2026-10-12 that a
change updates the address in place, that Back leaves the screen, that a stale page lands on page
1, and that search text goes in the URL
([plan](../superpowers/plans/2026-10-12-dashboard-list-url-state.md)).

## Decision

A `DataGrid` directory reads its search, filters, sort, page, page size and hidden columns from
the query string through `useDataGridUrlState` (`apps/dashboard/src/hooks/`). Writes go through
`useUrlParams`, which calls `window.history.replaceState` and reads `window.location.search` first,
so two writes in one tick compose. Defaults are left out of the address. Two markers stand for a
state whose default is not empty: `status=all` for no status filter and `sort=none` for
explicitly unsorted. A value outside the known set (an id that is not a UUID, an unknown status,
sort id or column id, a page size outside `DATA_GRID_PAGE_SIZES`) falls back to the default and is
never sent. Any change to search, a filter, the sort or the page size deletes `page`. Row
selection, dialogs, column order and pinning stay local: they are transient UI, not a view
someone shares.

Search text in the URL is acceptable under SEC-07's "no sensitive data in URLs or query strings"
([`security.md`](../06-security/security.md)): the API request already carries the same text in
its own query string (`?search=`), so the address adds no new exposure, and `replaceState` never
sends the address to the Next server, so it stays out of its logs.

## Alternatives considered

- **`router.replace` per change** — why not: a query-only change re-fetches the route's RSC
  payload, so every sort click and checkbox waits on a server round trip, and the query string,
  search text included, reaches the Next server logs.
- **`router.push` / `history.pushState`** — why not: the user chose that Back leaves the screen;
  a push makes Back step through every filter, debounced keystroke and page.
- **`nuqs`** — why not: a new runtime dependency for two screens, and the TanStack adapters for
  sorting, pagination and visibility would still be hand-written on top of it.
- **`sessionStorage`** — why not: it survives a reload but not a shared link.

## Consequences

- Differences from the retired hook: sort is one `sort` key (`-id` for descending), not
  `sort_by`/`sort_type`; there is no `clear()`; and there is no `isPending`, since `replaceState`
  is synchronous where the old hook's `router.replace` inside `useTransition` was not.
- A link to a page past the end gets the API's 404. The directory deletes `page` and shows page 1
  rather than the error.
- A new list screen passes the hook module-level constants (filter specs, sortable ids, default
  sort) and derives its hideable ids from its column definitions with `hideableColumnIds`.
- E2E fixture ids that reach a directory filter must be UUID-shaped (`uuid()` and `ORG_IDS` in
  `e2e/src/data/factories.ts`), or the filter is dropped by design.
