<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — schoolhub-frontend / apps/dashboard

Instructions for AI assistants working on the **SchoolHub admin dashboard** — Next.js 16 +
TypeScript in the Turborepo monorepo (`apps/dashboard`, shared `packages/ui`,
`packages/api-client`, `packages/types`).

Read the monorepo root [`../../AGENTS.md`](../../AGENTS.md) first — it holds the repo-wide rules.

## Required Reading, In Order

`DOCS = <repo root>/docs`

1. `DOCS/AGENTS.md` — project summary, locked vocabulary, invariants. Always.
2. `DOCS/context/context-map.md` — row "Build dashboard UI for a module".
3. The module doc `DOCS/03-modules/<module>.md` for the screen you are building: §5–§8 define
   the features/workflows/journeys, §11 the validations to mirror client-side, §13 the reports,
   §16 the endpoints you consume.

## Stack Rules (see `DOCS/02-architecture/tech-stack.md` §3)

- Server state via TanStack Query against the generated API client (`packages/api-client`,
  regenerated from OpenAPI — never hand-write fetch types). Minimal client state via Zustand.
- Forms: React Hook Form + Zod; Zod schemas mirror the module doc §11 validations.
- UI: Tailwind + the ported primitives in `packages/ui` ([ADR-0009](../../docs/decisions/0009-ported-ui-primitives.md));
  tenant branding comes from tenant settings — no hardcoded colors.
- i18n via `next-intl`; every user-facing string goes through messages, RTL-safe layout.

## Hard Rules

1. **Permission-aware UI:** hide/disable by the user's permission keys (module doc §4), but never
   treat that as security — the API enforces.
1a. **No raw native interactive elements.** `<button>`, `<input>`, and the like are always
    `packages/ui`'s themed primitives (`Button`, `Input`, …), never hand-rolled — see
    `packages/ui/AGENTS.md`'s "Never drop to a raw native element" for why, including when
    working around a vendor library's own quirk.
2. **Roles:** only slugs from `DOCS/00-overview/users-and-roles.md`.
3. **Async jobs:** long operations return `202` + job resource — build polling/progress UI, don't
   block.
4. **Errors:** render the API error envelope (`error.code`, field `details`) — don't invent
   messages for known codes.
5. **Accessibility:** WCAG 2.1 AA per `DOCS/07-quality/non-functional.md`.
6. Component tests per `DOCS/07-quality/testing-strategy.md` — **Jest + React Testing
   Library** ([ADR-0008](../../docs/decisions/0008-jest-not-vitest.md)). Browser-level flows go
   in `e2e/` (Playwright): this app fetches client-side, so its API can be stubbed per test
   from the browser — see `e2e/README.md`. Anything needing a real database goes in the
   E2E `live` lane, not here and not in Jest.

## How This App Is Wired

| Concern | Where |
| ------- | ----- |
| Auth guard (routing only, cookie presence) | `src/proxy.ts` (Next 16's rename of `middleware`) |
| Access token in memory + refresh-on-401 | `src/lib/auth.ts` → `@schoolhub/api-client` |
| Feature API calls (one file per domain, no hardcoded paths) | `src/services/endpoints.ts` + `src/services/modules/<domain>/`, aggregated as `Services` in `src/services/index.ts` |
| Permission helpers | `src/lib/permissions.ts` → `canAccessModule(user, module)` (whole-module) and `hasPermission(user, key)` (per-action — `/staff`'s Export/Import buttons are its first user). The sidebar applies both through `filterMenuByAccess` (`src/app/(app)/shell/menu-access.ts`): a `MENU_SIDEBAR` item gates on `module`, on `permission` (`MenuItem.permission`: one key, or a list any one of which will do, via `hasAnyPermission` — the Academics and Timetable children use it), or both, at every level, and a parent whose children all drop is dropped with them. A declarative `<Can>` JSX wrapper still does not exist; add one to `src/components/` on top of `hasPermission` when a screen wants that shape |
| Background-job polling (`202 + job`, e.g. bulk import/export) | `src/hooks/use-job-polling.ts` |
| Bulk import (a `start(file)` → `202 + job` endpoint, with a per-row result) | `BulkImportDialog` in `src/components/bulk-import-dialog.tsx` — takes the module's column lists and its service's start function; `/staff` and `/students` both use it, so reuse it rather than writing another import dialog |
| A `202 + job` whose result is a file (an export, the ID-card PDF) | `useJobFileDownload` in `src/hooks/use-job-file-download.ts` — triggers, polls (via `use-job-polling.ts`), then downloads through `downloadFile` in `src/lib/helpers.ts`; a timed-out job is resumed, not re-started |
| Debouncing a value (e.g. a search input) before it drives a query | `src/hooks/use-debounced-value.ts` — check `src/hooks/` for an existing hook before inlining a new `useState`+`useEffect`/`setTimeout` pair for a cross-cutting UI concern like this one |
| A `DataGrid` list's search, filters, sort, page, page size and hidden columns, kept in the URL ([ADR-0024](../../docs/decisions/0024-list-state-in-the-url.md)) | `useDataGridUrlState` in `src/hooks/use-data-grid-url-state.ts` (over `useUrlParams`, `src/hooks/use-url-params.ts`, which writes with `window.history.replaceState`) — `/students`, `/staff`, the three Academics lists and `/timetable/periods`, `/timetable/rooms`, `/timetable/substitutions` and `/attendance/records` use it (Records is cursor-paged, so it keeps a cursor stack in component state, `features/attendance/use-cursor-stack.ts`, reset on any filter or sort change, instead of a page in the URL, with Previous and Next from `packages/ui`'s `CursorPagination`); URL key names and the `all`/`none` markers are in `src/lib/constants.ts`, each screen's filter specs in its module's constants file |
| A server-paginated `DataGrid` list's guard against a page that no longer exists (clamps to the last page when the list shrinks; a 404 for a page past the end goes back to page 1) | `usePageClamp` in `src/hooks/use-page-clamp.ts` — returns `pageCount` and `isStalePage`; take `setPageIndex` from `useDataGridUrlState`. `/students`, `/staff`, the three Academics lists and the three Timetable lists use it, so a new list should too rather than redoing the effects |
| The academic session a session-scoped screen works on (the `session` URL value, else the current session; `isLocked` for a closed or archived one, and an `isError` that is not "no session") | `useAcademicSession`, `SessionPicker` and `NoSessionCard` in `src/components/academic-session/` (strings under the `academicSession` message namespace) — the hook shares the `academic-sessions` list's cache entry, so it adds no request. See `schoolhub-dashboard-screen` for the session-scoped list pattern |
| A module with several screens under one tab bar (Academics, Timetable, Attendance) | `src/components/module-sections/`: a module lists its `ModuleSection`s once (`features/<module>/<module>-sections.ts`: href, label key, sidebar title, and the key, or keys any one of which will do, that shows it); `ModuleSectionNav` draws the tabs, `ModuleLanding` sends the module's root to the first section the viewer may open, and `sectionMenuItems` builds the sidebar children, so a section is gated the same way in all three |
| A list screen's sort, load-failure card, search box, filter and form `Select`s, and reference lists | `toOrdering(sorting, SORT_FIELD)` in `src/lib/helpers.ts` (the sort → `?ordering=`; `/students`, `/staff`, `/academics/curriculum`, `/academics/allocations` and `/academics/promotions` use it), and in `src/components/`: `LoadErrorCard` (`message` + `onRetry`), `SearchInput` (with its clear button), `FilterSelect` (a filter `Select` over `{ id, name }` options with an "All" choice) and `FormSelectField` (a `Select` in a `FormField`, with an optional `description`, and a "No options available." message, `common.noOptions`, when its list is empty: pass `emptyMessage` to `SelectContent` for a `Select` you build yourself); `/academics/curriculum`, `/academics/allocations` and `/academics/promotions` use all four (promotions' `SearchInput` is the decision table's, not the list's). The reference lists are `useCampuses`/`useClasses`/`useSubjects`/`useSections`/`useTeachingStaffOptions` in `src/hooks/use-reference-data.ts` (and a class's curriculum subjects, `useClassSubjectOptions` in `src/hooks/use-class-subject-options.ts`), each under the query key that list is read with elsewhere, so a list read by two screens is one cache entry (`useSections` also takes `{ isActive }` for a picker): curriculum uses campuses, classes and subjects; allocations uses classes, subjects and sections; promotions uses classes and sections. Reuse them rather than writing another inline copy. The "no session" state is `NoSessionCard` (`src/components/academic-session/no-session-card.tsx`), and the session and id fixtures Academics tests share are `src/test-fixtures/academics.ts`. Places that still repeat the inline version are in `docs/deferred-work.md` |
| Timetable pieces two screens share | `src/features/timetable/`: `use-cell-label.ts` (a weekday · period cell name, the grid's and My timetable's) and `use-active-rooms.ts` (a campus's in-service rooms, capped at `MAX_PAGE_SIZE`; the cell editor's and the cover dialog's room picker) |
| Attendance pieces two screens share | `src/features/attendance/`: `attendance-status.tsx` (a status's token, icon and label, and `AttendanceStatusBadge`), `request-correction-dialog.tsx` (Request correction on a locked row, from the register and Records; conditionally mounted, sends only changed values) and `use-cursor-stack.ts` (a cursor-paged list's visited cursors, for `CursorPagination`'s Previous / Next) |
| A create/edit dialog whose server errors stay inline, and a confirm-only dialog (remove, end, reinstate) | `FormDialogLayout` (`src/components/form-dialog-layout.tsx`: the dialog or drawer, scrolling body, Cancel/Save), `useFormDialogSubmit` (`src/hooks/use-form-dialog-submit.ts`: the guarded submit; a server error on a field with an input lands under it, any other field's folds into the form's own message, and the message clears on the next attempt) and `useConfirmAction` (`src/hooks/use-confirm-action.ts`: the same for a dialog with no inputs, one inline message). The curriculum dialogs, the allocation dialogs (wrapped by `use-allocation-mutations.ts`, which adds the over-norm toast and the module invalidation) and the promotion dialogs (create and edit-decision on the form pieces, every batch transition on `useConfirmAction`) use them; build a new dialog on them rather than copying one. Dialogs that still inline the older version are in `docs/deferred-work.md` |
| TanStack Query client + key factory | `src/lib/query-client.ts` |
| Validated public env | `src/lib/env.ts` |
| Tenant branding → CSS variables | Not rebuilt since the shell reset: `Services.tenant` fetches branding, nothing applies it yet (`docs/metronic-dashboard-shell.md` backlog) |
| Locale resolution (no locale routing) | `src/i18n/request.ts`, `messages/*.json` |
| Route groups | `src/app/(auth)/…` unauthenticated · `src/app/(app)/…` authenticated |
| Imports | `@/…` alias only — ESLint bans `../` parent-relative imports, and bans `@schoolhub/api-client` in `src/app`, `src/features`, `src/components`, `src/hooks` (import `ApiError` from `@/services`) |
| Lint baseline | `eslint-suppressions.json` freezes existing violations and may only shrink (ADR-0014); fixing one means pruning its entry |

**Never** put the access token in `localStorage` or a readable cookie, and never add a
`tenant_id` request parameter — the tenant always comes from the authenticated context.

## Adding a Module Screen

1. Route: `src/app/(app)/<module>/page.tsx` (async server component for chrome).
2. API calls: add a `<module>` entry to `src/services/endpoints.ts` (paths, or
   param-taking functions for anything with an id). Every module gets the full
   five-file shape from creation
   ([ADR-0019](../../docs/decisions/0019-every-module-uses-the-five-file-shape.md)):
   - `<module>-type.ts` — the generated `ApiSchemas["<Model>"]` type-alias
     (`export type StudentRecord = ApiSchemas["Student"]`, or a `Pick<>` of one for a
     narrower reference-data shape), never hand-written there or in `packages/types`
     ([ADR-0017](../../docs/decisions/0017-generated-wire-types-for-new-domains.md)).
     For a module with no generated source, re-export its real cross-cutting types
     from `packages/types` instead — e.g. `auth-type.ts` re-exporting
     `AuthenticatedUser`.
   - `<module>-constant.ts` and `<module>-helper.ts` — real content once the module
     has any, otherwise a short header comment plus `export {};`.
   - `<module>.schema.ts` — Zod schemas and their inferred form-values types.
   - `<module>-service.ts` — the actual `apiClient` calls, importing its types from
     `./<module>-type`.

   Register it in `src/services/index.ts` as `Services.<module>`. See
   `src/services/modules/students/` for a module with real content in every file,
   `src/services/modules/staff/` for the two-predicate `copyMappedFields` variant, or
   `src/services/modules/auth/` for a module that's deliberately thin in two of them.
3. Feature code: `src/features/<module>/` — components and hooks. A screen's
   `useQuery`/`useMutation` calls `Services.<module>.<action>(...)` as its
   `queryFn`/`mutationFn` — never `apiClient` directly, never a hardcoded path.
4. Query keys via `queryKeys.list("<module>", "<resource>", params)`.
5. Gate every action by its `module.resource.action` key, via `hasPermission(user, key)`
   (`src/lib/permissions.ts` — see the wiring table). A declarative `<Can>` JSX wrapper
   does not exist yet; add one to `src/components/`, on top of `hasPermission`, when a
   screen wants that shape instead of an inline check.
6. Strings into `messages/en.json` **and** `messages/ur.json` — `react/jsx-no-literals` rejects
   JSX text that isn't translated.
7. Co-locate tests in a sibling `__tests__/` folder (`__tests__/*.test.tsx`), not
   `*.test.tsx` flat beside the source.

## Guidance To Load First

Before writing or reviewing code here, load the Vercel skill that matches the work:
`react-best-practices` for performance (waterfalls, bundle size, re-renders),
`next-best-practices` for route conventions, RSC boundaries and data fetching,
`next-cache-components` for caching and PPR, and `web-design-guidelines` for
accessibility review. They are installed on this machine and outrank generic
advice on framework questions; this app's own conventions still win over both.
