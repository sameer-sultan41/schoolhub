# Dashboard list state in the URL — Implementation Plan

> **For agentic workers:** one implementer pass per task (user preference), then one final review + one fix pass. This repo never runs tests, lint or typecheck locally — CI is the verifier.

**Work tier:** 2

**Goal:** `/students` and `/staff` keep search, filters, sort, page, page size and hidden columns in the URL query string, so a reload keeps the view and a link can be shared.

**Architecture:** A small URL-state hook family in `apps/dashboard/src/hooks/` that reads with `useSearchParams` and writes with the browser History API (`window.history.replaceState`), which Next 16 documents as keeping `useSearchParams` in sync without a server round trip. It is reshaped for TanStack Table + `DataGrid`, and follows the design the dashboard shipped before the shell reset (commits 19e591b / 4771afe / 842b4c9, deleted in 9548054), with the differences recorded in ADR-0024. Both directory tables swap their `useState` list state for it. No backend or API-contract change.

**Tech Stack:** Next.js 16.3.1, React 19, TanStack Table 8 / Query 5, Jest + RTL, Playwright (mocked lane).

**Branch:** `feat/dashboard-list-url-state` from an up-to-date `main` (`git checkout main && git pull --ff-only && git checkout -b feat/dashboard-list-url-state`).

## Context

The user asked why applying a filter, sort or page doesn't show in the URL. Exploration of the current tree confirmed:
- `features/students/student-directory-table.tsx` (lines ~67-148) and `features/staff/staff-directory-table.tsx` (~128-214) keep every list control in `useState`. Nothing reads or writes the URL, and hidden columns live inside TanStack's uncontrolled state.
- A URL convention existed (`useSearchParam`, `useTableParams`, `useDataGridTableParams`) and was deleted with the shell reset. No ADR covers it, and `nuqs` is not installed.
- Server sorting, filtering and paging are unchanged; only where the UI keeps its state moves.

**User decisions (2026-10-12):**
- Changes update the URL in place. Back leaves the screen and does not step through each filter change.
- A shared link to a page that no longer exists lands on page 1.
- Search text goes in the URL, with the reasoning recorded in an ADR.

## Alternatives considered (why not)

- **`router.replace` per change.** Rejected. With a query-only change on these dynamic routes, Next re-fetches the page's RSC payload from the server. Every sort click, checkbox and page change would wait for a server round trip, and the query string, including search text, would reach the Next server logs. `window.history.replaceState` is the documented shallow alternative (`node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`, History API section), and it updates synchronously.
- **`router.push` / `history.pushState` per change.** Rejected by the user: Back would step through every filter, debounced keystroke and page.
- **Add `nuqs`.** Rejected. It is a new runtime dependency for two screens, and the TanStack adapters (sorting, pagination, visibility) would still be hand-written on top of it.
- **Local state persisted to `sessionStorage`.** Rejected: it survives a reload but not sharing.
- **Row selection, dialogs, column order and pinning in the URL.** Rejected: they are transient UI, not a view someone shares (the retired hook made the same cut).

## Global Constraints

- **Verification and commits:** no local test/lint/typecheck runs; CI is the verdict. Commit and push only with the user's go-ahead. No `--no-verify`. Conventional Commits, with `Root cause:` on `fix` commits. No AI attribution.
- **Dashboard rules:**
  - No hardcoded English.
  - `@schoolhub/api-client` is never imported in `src/hooks`/`src/features`; take `ApiError` from `@/services`.
  - Tests go in sibling `__tests__/` folders.
  - Prettier width 100.
  - Coverage floor 85%.
  - No magic numbers or strings (ADR-0014): URL key names and page sizes are named constants.
- **API requests unchanged:** for the same state, requests stay exactly what each screen sends today, including students' untrimmed search and staff's trimmed search. Existing service and table tests assert this.
- **URL contents:** only search text, UUID ids, status values, sort column ids, page numbers and column ids. The search-text reasoning is recorded in ADR-0024 against `docs/06-security/security.md:57`.

## URL contract

| Key | Value | Omitted when |
| --- | --- | --- |
| `search` | the search text exactly as sent to the API (students untrimmed, staff trimmed) | empty |
| students `status` | a known student status, or `all` (no filter) | `active` (default) |
| staff `status` | a known `STATUS_META` key, or `all` (no filter: the Active Users switch off / cleared popover) | `active` (default) |
| students `campus`, `house`, `session`, `class`, `section` | UUID | empty |
| `sort` | column id, `-` prefix for descending, or `none` (explicitly unsorted, needed on staff where the default isn't empty) | equal to the screen's default sort |
| `page` | 1-based integer | 1 |
| `page_size` | one of `DATA_GRID_PAGE_SIZES` | the default (10) |
| `hidden` | comma-separated hideable column ids | none hidden |

**Rules:**
- **Page reset:** any change to search, a filter, the sort or the page size deletes `page`.
- **Unknown values fall back to the default silently.** That covers a non-numeric or out-of-list number, an unknown sort id, a non-hideable or unknown column id, a filter id that isn't a UUID, and a status outside the known set. A bad value is never sent to the API.
- **Students' class/section pair:** changing `class` clears `section` in the same write. A `section` whose id isn't in the loaded sections for the current `class` is dropped once that list loads.
- **Writes:** `window.history.replaceState(null, "", pathname + (qs ? "?" + qs : ""))`, with no trailing `?` when empty. Each write reads from `window.location.search`, so several writes in the same tick compose.

## Review Focus

1. **Typing, then an outside URL change.** Typing in search and reloading keeps the text and the filtered list. The box never jumps back while typing. An outside URL change (Back from another screen, a sidebar link to `/students`) is never overwritten by the stale debounced text.
2. **A link with `?page=7` when only 3 pages exist.** The real API answers 404 for an out-of-range page. The screen deletes `page` and shows page 1. A cold load never drops a valid `page` before the first response arrives.
3. **Hand-edited garbage** (`?page=abc&page_size=999&sort=nope&hidden=foo&campus=xyz&status=bogus`) renders the default view, with no crash and no bad API params.
4. **Staff "no status" and "no sort" states** survive a reload: the Active Users switch off gives `status=all`, and a header cleared to unsorted gives `sort=none`.
5. **Class change clears section**, and a stale `section` from a different class is not sent once the sections list loads.

---

### Task 1: URL-state hooks, shared constants, test helper

**Files:**
- **Create:**
  - `apps/dashboard/src/hooks/use-url-params.ts` and `apps/dashboard/src/hooks/use-data-grid-url-state.ts`
  - Their tests: `apps/dashboard/src/hooks/__tests__/use-url-params.test.tsx` and `.../use-data-grid-url-state.test.tsx`
- **Modify:**
  - `packages/ui/src/components/data-grid-pagination.tsx`: export `DATA_GRID_PAGE_SIZES = [10, 25, 50, 100] as const` and use it as `DEFAULT_SIZES`. Export it from the package index.
  - `apps/dashboard/src/lib/constants.ts`: add `LIST_URL_KEYS = { search: "search", sort: "sort", page: "page", pageSize: "page_size", hidden: "hidden" } as const`, the `SORT_NONE = "none"` / `FILTER_ALL = "all"` markers, and `DEFAULT_LIST_PAGE_SIZE = 10`.
  - `apps/dashboard/src/test-utils.tsx`: add an in-memory `next/navigation` mock. It provides `useSearchParams`, `usePathname` and `useRouter`, backed by a URL that `window.history.replaceState` writes and that re-renders subscribers. `setUrl(qs)` simulates a reload, shared link or outside navigation. The mock has no synchronous shortcut that would let a composition test pass without the real composing behaviour.

**Interfaces (produced):**

```ts
// use-url-params.ts
export function useUrlParams(): {
  searchParams: URLSearchParams; // from useSearchParams()
  setParams: (updates: Record<string, string | null>) => void; // null deletes; composes via window.location.search
};

// use-data-grid-url-state.ts
export interface FilterSpec { default: string; isValid: (value: string) => boolean }
export interface DataGridUrlStateOptions<F extends string> {
  filters: Record<F, FilterSpec>;   // URL key -> default + validator (UUID / known statuses / FILTER_ALL)
  sortableIds: readonly string[];
  defaultSorting: SortingState;     // [] allowed; SORT_NONE written when the user clears a non-empty default
  hideableIds: readonly string[];   // derived from the column defs (enableHiding !== false), not hand-copied
  trimSearch: boolean;              // students false, staff true (today's behaviour)
}
export function useDataGridUrlState<F extends string>(options: DataGridUrlStateOptions<F>): {
  filters: Record<F, string>;
  setFilters: (updates: Partial<Record<F, string>>) => void; // resets page; default deletes the key
  searchInput: string; setSearchInput: (value: string) => void;
  search: string;
  sorting: SortingState; onSortingChange: OnChangeFn<SortingState>;
  pagination: PaginationState; onPaginationChange: OnChangeFn<PaginationState>;
  columnVisibility: VisibilityState; onColumnVisibilityChange: OnChangeFn<VisibilityState>;
  setPageIndex: (pageIndex: number) => void;
};
```

**Implementation notes:**
- **Search:** `searchInput` is local state initialised from the URL. The effect that writes `search` depends only on the debounced value (`useDebouncedValue` + `SEARCH_DEBOUNCE_MS`). When the URL's `search` changes and differs from the last value this hook wrote, `searchInput` re-syncs, and the pending debounced write is dropped.
- **Page size:** a page-size change drops the simultaneous page-index change (TanStack fires both).
- **Stable callbacks:** callbacks TanStack holds are referentially stable.
- **No busy signal needed:** `replaceState` is synchronous, unlike the retired hook's `useTransition`.

- [ ] Write the hook tests first. Cover:
  - Defaults are parsed, and every key round-trips.
  - Every garbage value in Review Focus #3 falls back.
  - Changes to filters, search, sort and page size delete `page`, and default values are omitted.
  - Two `setParams` calls in one `act` both land.
  - `status=all` and `sort=none` round-trip.
  - An outside `setUrl` re-syncs `searchInput`, and a stale debounced value never overwrites it.
  - Typing and then waiting writes `search` once.
  - `trimSearch` true/false sends what the screen sends today.
  - `hidden` keeps only hideable ids.
- [ ] Implement both hooks against those tests, with concise comments only where the reason isn't obvious (`replaceState` not the router, the composing read, page-size/page-index ordering).

### Task 2: `/students` directory on the URL

**Files:**
- **Modify:**
  - `apps/dashboard/src/features/students/student-directory-table.tsx`
  - `apps/dashboard/src/features/students/student-directory-filters.tsx` (only if its props change)
  - `apps/dashboard/src/features/students/student-columns.tsx` (export the column ids, or derive the hideable ids from it)
  - `apps/dashboard/src/services/modules/students/students-constant.ts` (the filter spec map: UUID validator + known statuses + `FILTER_ALL`, and the sortable ids)
  - `apps/dashboard/src/app/(app)/students/page.tsx`: wrap the table in `<Suspense>`, as the Next `useSearchParams` docs recommend, so the page doesn't depend on the root layout happening to read cookies.
- **Test:** `apps/dashboard/src/features/students/__tests__/student-directory-table.test.tsx`

- [ ] **Swap the state.** Replace the search, filter, pagination and sorting `useState`s with `useDataGridUrlState`, and pass `columnVisibility` / `onColumnVisibilityChange` to `useReactTable`. Delete the now-redundant page-reset effect.
- [ ] **Clamp guard.** The clamp effect runs only on real page data (`pageMeta` present and `!query.isPlaceholderData`) and calls `setPageIndex`. When the query fails with `ApiError.isNotFound` and `page > 1`, delete `page`; the query refetches page 1.
- [ ] **Class and section.** A class change clears section in one `setFilters` call, and a `section` that isn't in the loaded sections list is dropped. Keep `rowSelection`, the dialogs and the detail sheet local.
- [ ] **Tests.** Install the navigation mock and keep every existing API-param assertion. Add these cases:
  - **Deep link:** `?status=all&campus=<uuid>&sort=-admissionDate&page=2` gives the matching `fetchStudentsPage` call and UI.
  - **Filter change:** changing the campus writes `campus` and drops `page`.
  - **Hidden columns:** hiding a column writes `hidden`.
  - **Bad values:** the garbage URL gives the default request.
  - **Stale page:** a 404 on `page=9` deletes `page` and refetches page 1.
  - **Cold load:** a cold load with `page=2` doesn't drop `page` before data arrives.

### Task 3: `/staff` directory on the URL

**Files:**
- **Modify:**
  - `apps/dashboard/src/features/staff/staff-directory-table.tsx`
  - `apps/dashboard/src/services/modules/staff/staff-constant.ts` (the filter spec: `STATUS_META` keys + `FILTER_ALL`, and the sortable ids)
  - `apps/dashboard/src/app/(app)/staff/page.tsx` (`<Suspense>`)
- **Test:** `apps/dashboard/src/features/staff/__tests__/staff-directory-table.test.tsx`

- [ ] **Swap the state** the same way. The Active Users switch, the status toggles and clearing the popover all write `status`, with "none" written as `all` and mapped to `employmentStatus: undefined` exactly as today. The Sort Order preset and header sorting both go through `onSortingChange`: the default `[{ id: "name", desc: false }]` is omitted, and a cleared sort is written as `sort=none` and sends no `ordering`. The same clamp guard and 404 handling as students. Column pinning and order stay local.
- [ ] **Tests.** The existing 23 tests keep passing with the mock installed; their API-param assertions are the contract. Add these cases:
  - **Students parity:** the URL cases from Task 2.
  - **Preset:** the Sort Order preset gives `sort=joiningDate`.
  - **Switch off:** Active Users off gives `status=all` and no `employment_status` sent.
  - **Cleared header:** a header cycled to unsorted gives `sort=none` and no `ordering` sent.

### Task 4: E2E, docs, ADR

**Files:**
- **E2E:** create `e2e/tests/dashboard/list-url-state.spec.ts`. Modify `e2e/src/mocks/domains/students.ts` and `staff.ts` so the list stubs return `fail(404)` for an out-of-range `page`, as the real DRF pagination does. Add a page-object helper for navigating with a query string only if `BasePage.goto(path)` can't take one already.
- **Docs and skill:**
  - `.claude/skills/schoolhub-dashboard-screen/SKILL.md`: replace "local debounced search" with the hook.
  - `apps/dashboard/AGENTS.md`: a wiring-table row for `useDataGridUrlState`.
  - `docs/03-modules/student-management.md` §20 and `docs/03-modules/staff-management.md`: add a line to their "Dashboard … (as shipped)" sections.
  - `docs/project-status.md`: make the "hidden columns live in the URL" line true again and note the change.
  - `docs/deferred-work.md`: remove anything this closes.
- **ADR:** `docs/decisions/0024-list-state-in-the-url.md` plus its README row. Record:
  - `replaceState` versus the router, push and `nuqs`, and the user's Back decision.
  - What stays local.
  - The `status=all` / `sort=none` markers.
  - Why search text in the URL is acceptable under `security.md:57`: the API already carries it in its own query string, and `replaceState` keeps it out of Next server logs.
  - The differences from the retired hook (`sort=-id` rather than `sort_by`/`sort_type`, no `clear()`, no `isPending`).

- [ ] **E2E** (mocked lane, `@/fixtures` only):
  - **Students reload:** apply a campus filter and a sort. The URL has `campus=` and `sort=`. After `page.reload()`, the same filter shows and the stub received the same params.
  - **Students stale page:** `/students?page=9` lands on page 1 with `page` removed (the stub returns 404).
  - **Staff reload:** with Active Users off and the Sort Order preset set, after a reload the same state shows and the stub got the same params.
- [ ] **Docs and ADR** as listed: cspell-safe English, links resolve.

## Verification

- **CI on the PR:**
  - `frontend`: Jest including the new hook tests, the 85% coverage floor, lint, typecheck, and the Playwright mocked lane.
  - `repo-hygiene`: doc-sync, links, cspell, the plan-review record.
- **Manual (the user):** on `/students`, set a filter, a sort and page 2, then reload: the same view. Paste the URL in a new tab: the same view. Hand-edit `?page=99`: page 1. Repeat on `/staff`, including Active Users off.

## Independent review

- **Reviewer:** plan-reviewer agent, 2026-10-12
- **Verdict:** REVISE. URL state is the right approach; the clamp/404 handling, the staff states with no URL form, unvalidated filter values, and the router.replace-vs-history choice needed fixing before implementation.
- **Findings addressed:** all 14 were folded in before approval.
  1. The clamp runs only on real page data, and a 404 on `page>1` deletes `page`. Review Focus #2 is now "page 1", and the e2e stubs return 404.
  2. Staff gets `status=all` and `sort=none` markers, with tests.
  3. Writes use `window.history.replaceState` (shallow, no server request). It is listed under alternatives and recorded in the ADR.
  4. Filter values are validated (UUID or known status), and a stale section is dropped once the sections list loads.
  5. The user confirmed "Back leaves the screen".
  6. The search write effect depends only on the debounced value, with an outside-change test, and trimming is per screen so requests stay unchanged.
  7. The navigation mock lives in `test-utils.tsx` and doesn't make the composition test pass trivially.
  8. `<Suspense>` is added in both `page.tsx` files.
  9. `DATA_GRID_PAGE_SIZES` is exported from `@schoolhub/ui`, URL keys are named constants, and an empty query leaves no trailing `?`.
  10. The search-text reasoning goes in ADR-0024.
  11. Both module docs are added, and the work is on a new branch from `main`.
  12. A staff e2e case is added.
  13. Hideable ids are derived from the column definitions, with full paths in the plan.
  14. The differences from the retired hook are recorded in the ADR, and no busy signal is needed with `replaceState`. The `admissionNumber` step is dropped.
- **Unresolved:** none. The user decided Back behaviour (Back leaves the screen), the stale page (page 1) and search in the URL (yes, with ADR) on 2026-10-12.
