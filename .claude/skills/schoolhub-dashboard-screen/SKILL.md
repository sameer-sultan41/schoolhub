---
name: schoolhub-dashboard-screen
description: Use when building a new dashboard feature screen — a directory list, create/edit form, detail view, and a destructive/lifecycle action — phrases like "build the X screen", "add a directory for Y", "port the old Z UI", or any new file under `apps/dashboard/src/features/<module>/`. SKIP for wiring a single API call with no screen around it (use schoolhub-api-services) or for a new packages/ui primitive (use schoolhub-ui-port).
---

# SchoolHub Dashboard Feature Screen Skill

## Purpose

A "module screen" in `apps/dashboard` is always the same five pieces: a server-paginated
directory table with filters, a create/edit form dialog, a read-only detail view, a
destructive/lifecycle action (withdraw, exit, deactivate, …), and the route that wires
them together. `/staff` was the first one built; `/students` Phase 1
(`apps/dashboard/src/features/students/`) is the current reference — it repeats `/staff`'s
shape but also fixed things `/staff` got away with (a Radix `Select` prefill bug, a
memoization defeated by inline callbacks, an uncleareable address field) that the next
screen should not have to rediscover.

**Why this exists:** before Task 11, "how do I build a screen" lived only as tribal
knowledge spread across `/staff`'s source and four rounds of plan review on the students
plan. Every one of those review rounds caught a mistake this skill now states up front —
see each section's citation. This skill is the distilled version so the next module
(guardians, fees, timetable, …) starts from the fixed shape, not from a blank page.

## The five pieces, every time

```
apps/dashboard/src/features/<module>/
  <module>-form-schema.ts          # zod schema + detail->form / form->input mappers
  <module>-form-dialog.tsx         # ResponsiveDialog: create/edit
  <module>-<subfield>-fields.tsx   # split-out sub-sections of the form (see "Splitting a form" below)
  <module>-detail-sheet.tsx        # ResponsiveSheet: read-only detail + its own action footer
  <module>-row.ts                  # wire record -> table row shape
  <module>-columns.tsx             # useColumns() hook, DataGrid ColumnDef[]
  <module>-directory-filters.tsx   # search input + Select filters
  <module>-directory-table.tsx     # the screen: owns all state, wires the above together
  <module>-toolbar.tsx             # stat cards + "New <X>" action
  <lifecycle-action>-dialog.tsx    # e.g. withdraw-student-dialog.tsx — the destructive action
  __tests__/
    *.test.tsx
apps/dashboard/src/app/(app)/<module>/
  page.tsx                         # thin server component: <Toolbar/> + <DirectoryTable/>
```

Real example throughout: `apps/dashboard/src/features/students/` (Tasks 5–9 of the
students Phase 1 plan) and `apps/dashboard/src/app/(app)/students/page.tsx` (Task 9).

## 1. Wire types from `ApiSchemas`, not `packages/types` (ADR-0017)

A domain's own wire shape is a type alias on the generated client, re-exported from the
domain's service file — never hand-written:

```ts
// apps/dashboard/src/services/modules/students/students-service.ts:15
export type StudentRecord = ApiSchemas["Student"];
```

`schoolhub-api-services` covers the service-file shape itself (endpoints, service
functions, `Services` registration) — load that skill for the services layer; this skill
assumes it's already done and starts from the feature code that consumes
`Services.<module>.*`. [`docs/decisions/0017-generated-wire-types-for-new-domains.md`](../../../docs/decisions/0017-generated-wire-types-for-new-domains.md)
exists because the first draft of `students` hand-rolled a `StudentRecord` in
`packages/types` that drifted from the real contract (missing `custom_fields`, mistyped
`address`, wrong `admission_number` optionality) before the rest of the module was built.

A small, genuinely hand-written reference-data shape in the same feature is fine —
`SchoolOrganizationOption` lives beside the students feature code, not in `packages/types`
— that's consistent with ADR-0017's carve-out for cross-cutting/no-generated-source types,
not a violation of it.

## 2. Split a form before hitting the 400-line `max-lines` ceiling

This is not optional polish — `eslint-suppressions.json` freezes the existing
lint-violation baseline and may only shrink (ADR-0014); a new file cannot add a
suppression to it, so a form that grows past the ceiling has nowhere to go but split.

The students form needed **four** files, not the three the plan originally called for —
Task 5 found mid-implementation that even after splitting out the address block, the
remaining file (gender/campus/house selects, photo upload, the five simple text fields,
submit wiring) still didn't clear the ceiling, so a second split peeled off the plain text
fields too:

- `student-form-dialog.tsx` — the dialog shell: queries, mutation, the fields that need
  real logic (Select, file upload), composes the two field components below.
- `student-form-schema.ts` — zod schema, `detailToFormValues`, `buildStudentInput`.
- `student-address-fields.tsx` — the six address sub-fields, `.map()` over a
  `[name, labelKey]` tuple list (`apps/dashboard/src/features/students/student-address-fields.tsx:10-17`).
- `student-profile-text-fields.tsx` — the five structurally-identical simple text fields
  (`blood_group`, `nationality`, `religion`, `previous_school`, `medical_notes`), same
  tuple-list pattern, with `medical_notes` filtered in/out by a plain `showMedicalNotes`
  boolean prop — **the permission check stays in the dialog**, the field component "has no
  idea what a permission is" (`student-profile-text-fields.tsx:21-26`).

The lesson: budget for a sub-field component *and* expect it might not be enough on the
first pass. Don't treat a plan's file count as fixed — check the real line count as you
write, and split again rather than reaching for a suppression.

## 3. The `DataGrid` shape

Real example: `student-columns.tsx`, `student-directory-filters.tsx`,
`student-toolbar.tsx`, `student-directory-table.tsx`.

- **Don't hand-roll a sort header or a checkbox column.** Use `DataGridColumnHeader`
  (`packages/ui/src/components/data-grid-column-header.tsx`) for every sortable column
  header and `createSelectColumn<TRow>({ selectAll, selectRow })`
  (`packages/ui/src/components/data-grid-table.tsx`) for the bulk-selection column —
  `student-columns.tsx:46-49`.
- **Local debounced search**, not a query-level debounce: a local `searchInput` state
  updates immediately for the input's own value, a separate `search` state (what the query
  actually uses) updates after `SEARCH_DEBOUNCE_MS` (`apps/dashboard/src/lib/constants.ts:28`,
  currently 300ms) via a `setTimeout` effect — `student-directory-table.tsx:54-77`.
- **Narrow pagination with `isOffsetPagination`/`isCursorPagination`** before touching
  `total_pages`/`total_count` — `Page<T>.pagination` is itself optional, and those fields
  exist only on the offset arm of the `Pagination` union:
  ```ts
  // student-directory-table.tsx:120-122
  const pageMeta = query.data?.pagination;
  const pageCount = pageMeta && isOffsetPagination(pageMeta) ? pageMeta.total_pages : 1;
  const totalCount = pageMeta && isOffsetPagination(pageMeta) ? pageMeta.total_count : 0;
  ```
  Never a single `?.` chain straight through to `total_pages`.
- **Bulk selection filtered to rows the action is actually valid for.** Bulk withdraw
  only acts on the selected rows that are still `active`, regardless of whether the viewer
  *can* withdraw — a non-active row has nothing to withdraw from:
  ```ts
  // student-directory-table.tsx:165-168
  const selected = table.getSelectedRowModel().rows.map((r) => r.original);
  const selectedWithdrawable = selected.filter((s) => s.status === "active");
  ```
- **Gate a row action on the record's own state, not just the viewer's permission.** The
  per-row Withdraw button and the bulk-withdraw button both check `canWithdraw &&
  row.status === "active"` (`student-columns.tsx:101`, `student-directory-table.tsx:215`)
  — a permission check alone would offer withdraw on an already-withdrawn row the backend
  itself refuses (confirmed against the mock backend's own domain-rule rejection,
  `e2e/src/mocks/domains/students.ts:137-141`).
- **`useCallback`-wrap the row-action handlers passed into the columns hook.** This was
  added during Task 8's review (commit `886df22`, "stabilize student columns callbacks")
  after the first version passed inline arrow functions from `student-directory-table.tsx`
  into `useStudentColumns`, which defeated that hook's own `useMemo` on every parent
  re-render (a search keystroke, a page change):
  ```ts
  // student-directory-table.tsx:141-146
  const handleEdit = useCallback((id: string) => {
    setFormDialog({ mode: "edit", studentId: id });
  }, []);
  const handleWithdraw = useCallback((id: string, name: string) => {
    setWithdrawDialog({ ids: [id], names: [name] });
  }, []);
  ```
  `useStudentColumns`'s own `useMemo` deps list includes both callbacks
  (`student-columns.tsx:117`) — a stable callback is what makes that memo actually skip
  recomputation.

## 4. `ResponsiveDialog`/`ResponsiveSheet`

- `useIsDesktopShell()` (1024px breakpoint, `apps/dashboard/src/hooks/use-is-desktop-shell.ts`)
  decides Dialog-vs-Drawer for a form; `useIsDrawer()`
  (`apps/dashboard/src/components/responsive-dialog.tsx:52`) is the equivalent for a
  sheet/footer that needs to render icon-only buttons on mobile vs. labeled ones on
  desktop — see `student-detail-sheet.tsx`'s `DetailFooter`, which renders icon buttons
  (`Pencil`, `UserMinus`) in the drawer branch and labeled `Button`s otherwise
  (`student-detail-sheet.tsx:204-254`).
- **The mobile `<form>` needs `flex min-h-0 grow flex-col` inside a `Drawer`**, and the
  body must not get a second competing `max-h`:
  ```tsx
  // student-form-dialog.tsx:206-216
  <form ... className={isMobile ? "flex min-h-0 grow flex-col" : undefined}>
    <ResponsiveDialogBody
      className={isMobile ? "space-y-4 overflow-y-auto" : "max-h-[65vh] space-y-4 overflow-y-auto pe-1"}
    >
  ```
  Round 3 of the students plan review caught a desktop dialog with no height bound at all
  — the Save button sat off-screen at the CI runner's viewport. Both branches need an
  explicit scroll boundary, just different ones.

## 5. The form-dialog shape

Real example: `student-form-dialog.tsx`, `student-form-schema.ts`.

- **snake_case zod schema**, matching the API's own field names 1:1 so
  `error.fieldErrors()` keys need no re-mapping step
  (`student-form-schema.ts:7-9`).
- **`Object.entries(error.fieldErrors())`, never a `for...of`** — it's a `Record`, not an
  iterable:
  ```ts
  // student-form-dialog.tsx:160
  for (const [field, issue] of Object.entries(error.fieldErrors())) {
  ```
- **`resolveErrorMessage(error, tErrors, fallback, "non_field")`** for a domain-rule error
  with no matching form field — e.g. a duplicate-student rejection that isn't about any
  single input (`student-form-dialog.tsx:167`). A round-1 review finding on this plan was
  a `field`-less error-message call that silently dropped the real server text; always
  pass the `"non_field"` key explicitly.
- **`isDetailLoading` keeps every `Select` unmounted until the edit prefill has actually
  applied**, not just until the query resolves:
  ```ts
  // student-form-dialog.tsx:118-120
  const isDetailLoading =
    mode === "edit" &&
    (detailQuery.isPending || (detailQuery.data !== undefined && populatedStudentId !== studentId));
  ```
  Radix mirrors a `Select`'s value into a hidden native `<select>` and silently blanks
  itself if that value changes before the matching `<option>` has registered — true for
  every select on the render right after mount. Round 2 of this plan's review caught this
  bug *re-introduced* on the edit-prefill path after `/staff` had already fixed it once —
  it is easy to lose this gate when a form is later split into sub-components.
- **An "open session" counter, not a boolean, for a stale-upload guard.** A boolean can't
  distinguish "still this same open session" from "closed and reopened before the upload
  settled":
  ```ts
  // student-form-dialog.tsx:76-87, 174-181
  const sessionRef = useRef(0);
  const openSessionRef = useRef(0);
  // bumped on every open (including a reopen) inside a `useEffect`, never during render
  async function handlePhotoUpload(file: File) {
    const uploadSession = openSessionRef.current;
    const uploadedStudentId = studentIdRef.current;
    const fileId = await Services.files.uploadFile(file, "student.photo");
    if (openSessionRef.current !== uploadSession || studentIdRef.current !== uploadedStudentId) return;
    form.setValue("photo_file_id", fileId);
  }
  ```
  Both guard refs are written only inside a `useEffect`, never in the render body — writing
  a ref during render trips the `react-hooks/refs` lint rule (an earlier draft did exactly
  this and a round-3 review caught it).
- **Create-vs-edit clearing semantics**: on create, an empty optional field is
  `undefined` (omit it — nothing to clear); on edit, an emptied field sends `null`
  (clear the column), uniformly for every clearable field including ones the model also
  accepts `""` for:
  ```ts
  // student-form-schema.ts:115-116
  const clearable = (value: string) => (mode === "edit" ? value || null : value || undefined);
  ```
  This extends to a composite field: on edit, an address emptied down to nothing must send
  `address: null`, not merely omit the key (a round-4 review finding — `buildAddress`
  returning `undefined` means "send nothing" everywhere else in that function, but a fully
  cleared address specifically needs "send null" to actually reach the server, since
  `updateStudent` drops `undefined` values — `student-form-schema.ts:143`). Don't
  dirty-track a composite field separately from the rest of the form "for efficiency" — an
  earlier draft tried that for the address block and the tracking flag was never set
  `true`, silently dropping every real address edit. Recomputing the whole field from
  current form values on every submit, same as every other field, is both simpler and
  correct.

## 6. A destructive/idempotent action

Real example: `withdraw-student-dialog.tsx`.

- **`RequestOptions.idempotencyKey`**, generated once per dialog-open (per target, for a
  bulk action) and reused on retry — not regenerated each submit attempt:
  ```ts
  // withdraw-student-dialog.tsx:94-98
  const keysRef = useRef(new Map<string, string>());
  function keyFor(id: string): string {
    if (!keysRef.current.has(id)) keysRef.current.set(id, crypto.randomUUID());
    return keysRef.current.get(id) as string;
  }
  ```
  Cleared on close (`!open`), so a later, logically distinct attempt on the same record id
  never resends a stale key from a past session — `withdraw-student-dialog.tsx:110-117`.
  This reset effect was added during Task 7's review: the first version had no `!open`
  reset at all, so a dialog kept mounted across opens would carry a previous session's
  cached keys and partial-failure state into a new one.
- A bulk action's per-target outcome never pairs back to its target by array index —
  each promise resolves to its own `{ id, name, ok }`, because `noUncheckedIndexedAccess`
  makes `targets[i]`/`outcomes[i]` a real compile error when two separately-typed arrays
  have no guaranteed lockstep (`withdraw-student-dialog.tsx:126-154`).
- On partial failure, narrow the retry to only the ids that still need attention, reusing
  each one's cached idempotency key (`withdraw-student-dialog.tsx:164-167`).

## 7. The detail sheet

Real example: `student-detail-sheet.tsx`.

- **`"medical_notes" in data`, not `data?.medical_notes` or a falsy check**, to
  distinguish "the backend omitted this key because you lack visibility" from "the field
  exists and is simply empty for this record":
  ```ts
  // student-detail-sheet.tsx:68-73
  const hasMedicalNotesField = data !== undefined && "medical_notes" in data;
  ```
  A falsy check (`data?.medical_notes`) would show "Restricted" for both a field the
  viewer can't see *and* a field that's genuinely blank — two different facts.

## 8. Query keys and invalidation

`queryKeys.list(module, resource, params)` / `.detail(module, resource, id)` /
`.module(module)` (`apps/dashboard/src/lib/query-client.ts:58-65`). A mutation that
changes something the dashboard home's own counts reflect invalidates **both**:

```ts
// student-form-dialog.tsx:151-152, withdraw-student-dialog.tsx:158-163
void queryClient.invalidateQueries({ queryKey: queryKeys.module("students") });
void queryClient.invalidateQueries({ queryKey: queryKeys.module("dashboard") });
```

## 9. i18n

Reuse `common.*` for generic labels — `tCommon("cancel")`, `tCommon("save")`,
`tCommon("close")`, `tCommon("edit")` — rather than adding a per-screen
`students.actions.cancel` duplicate. A round-4 review finding on this plan was a
half-applied dedup: `actions.edit`, `form.loading` and `detail.close` had been added as
near-duplicates of existing `common.*` keys before being caught and removed, with call
sites switched to `tCommon`.

## 10. Tests

- **`renderWithProviders`** for most cases — fresh mount per test, no cross-test state.
- **A locally-built `QueryClientProvider` wrapper** (not `renderWithProviders`, which
  can't survive `rerender`) for any test that needs the *same* component instance across
  prop changes — a stale-upload-after-reopen or a reopen-after-close regression test:
  ```tsx
  // student-form-dialog.test.tsx:266-276
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </NextIntlClientProvider>
    );
  }
  const { rerender } = render(<StudentFormDialog ... />, { wrapper: Wrapper });
  ```
  If the component under test calls `useTranslations`, the wrapper needs
  `NextIntlClientProvider` too — a round-3 finding was a wrapper with only
  `QueryClientProvider`, which threw before the test reached its first assertion.

## 11. e2e

Real example: `e2e/tests/dashboard/students.spec.ts`, `e2e/src/mocks/domains/students.ts`,
`e2e/src/pages/dashboard/students.page.ts`.

- **`MockApi`/envelope pattern**: a `MockModule` built with `ok`/`fail`/`pagedList` from
  `e2e/src/mocks/envelope.ts`, registered in a spec via `mockApi.use(studentsModule({...}))`
  — never a raw object literal standing in for a response.
- **The fixtures/pages barrel files are the actual contract, not dead code to delete.**
  `e2e/src/pages/index.ts` and `e2e/src/fixtures/index.ts` both need the new page
  object/fixture added (`studentsPage: StudentsPage` in `fixtures/index.ts:63,174`,
  `export * from "./dashboard/students.page"` in `pages/index.ts:6`) or the spec simply
  can't import it — a round-1 review finding on this plan was e2e fixture/barrel files
  that would fail to import because this step was skipped.
- **`test.use()` at `describe`/file scope only** — never inside a `test()` body.
- **A screen's own default filter changes what "withdrawn" looks like in an assertion.**
  `/students` defaults to `status=active`; a row that just left that status via a
  destructive action *drops out of the default view* — assert that it's gone from the
  default view, and separately that switching the status filter shows it withdrawn with
  its action removed, don't just assert the action is "disabled":
  ```ts
  // students.spec.ts:84-90
  await expect(studentsPage.row("Ayesha Khan")).toHaveCount(0);
  await page.getByRole("combobox", { name: /status/i }).click();
  await page.getByRole("option", { name: /^all$/i }).click();
  await expect(studentsPage.row("Ayesha Khan").getByText(/withdrawn/i)).toBeVisible();
  await expect(studentsPage.rowAction("Ayesha Khan", "Withdraw")).toHaveCount(0);
  ```
  A round-2 finding on this plan was exactly the opposite mistake: a withdraw test whose
  own assertion contradicted the directory's default filter.

## Checklist for a new module screen

1. Service layer already in place per `schoolhub-api-services` — wire type is
   `ApiSchemas["<Model>"]`, re-exported from the domain's own `<domain>-service.ts`
   (ADR-0017).
2. `<module>-row.ts` maps the wire record to the table's row shape.
3. `<module>-form-schema.ts`: snake_case zod schema, `detailToFormValues`,
   `build<Module>Input(values, mode)` with create-vs-edit clearing semantics.
4. `<module>-form-dialog.tsx`: `ResponsiveDialog`, `isDetailLoading` gate on every
   `Select`, an open-session counter for any async upload, `Object.entries(error.fieldErrors())`
   with a `"non_field"` fallback. Split sub-sections into their own files **before** 400
   lines, not after — check the real line count, don't trust the plan's file list.
5. `<module>-columns.tsx`: `useMemo`'d `useColumns()` hook, `DataGridColumnHeader` +
   `createSelectColumn`, row actions gated on both permission and the record's own state.
6. `<module>-directory-filters.tsx`: local debounced search via `SEARCH_DEBOUNCE_MS`,
   `Select` filters with a `aria-label` on each trigger.
7. `<module>-directory-table.tsx`: owns all state, `isOffsetPagination`/`isCursorPagination`
   narrowing, `useCallback`-wrapped row-action handlers passed into the columns hook,
   bulk selection filtered to the action's valid subset.
8. `<lifecycle-action>-dialog.tsx`: `idempotencyKey` per dialog-open (per target for bulk),
   a `!open` reset effect, per-target outcome tracking with no index pairing.
9. `<module>-detail-sheet.tsx`: `ResponsiveSheet`, `useIsDrawer()` for its footer, a
   `"field" in data` check for any field with a visibility-vs-empty distinction.
10. `<module>-toolbar.tsx`: stat-card `useQuery`s with `pageSize: 1`, fail-closed on an
    unresolved permission (disabled + a `title` explaining why).
11. Route `page.tsx`: thin server component, `<Toolbar/>` + `<DirectoryTable/>`.
12. Both mutation paths (create/edit dialog, destructive action) invalidate
    `queryKeys.module("<module>")` **and** `queryKeys.module("dashboard")` if the home
    screen shows a related count.
13. i18n: reuse `common.*`, don't add a per-screen near-duplicate.
14. Jest: `renderWithProviders` by default; a local `QueryClientProvider` (+
    `NextIntlClientProvider` if the component uses `useTranslations`) wrapper only for a
    same-instance-across-rerender regression test.
15. e2e: register the page object in `e2e/src/pages/index.ts` and the fixture in
    `e2e/src/fixtures/index.ts`; a `MockModule` in `e2e/src/mocks/domains/`; assert a
    default-filtered screen's own view, not just that an action disappeared.

## What this does NOT cover

- **Tabbed detail views with nested CRUD** (guardians, emergency contacts, documents under
  a student's own detail) — Phase 1's `StudentDetailSheet` is deliberately flat; wrapping
  it in `Tabs` with nested per-tab create/update/delete flows is Phase 2's own pattern, not
  yet shipped as a worked example.
- **Bulk import/export.** `/staff`'s `StaffImportDialog`
  (`apps/dashboard/src/app/(app)/staff/staff-import-dialog.tsx`) is the shipped reference
  for a column-mapping-free CSV import against a fixed required/optional column set; its
  toolbar Export button is the reference for a streamed CSV export. Students Phase 4 plans
  to mirror both — until that lands, point at `/staff`'s source directly rather than
  guessing at the shape.

## Related

- The students Phase 1 plan (`.superpowers/sdd/can-you-see-checkout-frolicking-anchor/`)
  — the plan this skill was written from, including four rounds of independent review
  whose findings are cited throughout.
- [ADR-0017](../../../docs/decisions/0017-generated-wire-types-for-new-domains.md) —
  generated wire types for a new domain.
- `/staff`'s source (`apps/dashboard/src/app/(app)/staff/`) — the original reference
  implementation this pattern was first established against, and still the only shipped
  example of bulk import/export.
- `schoolhub-api-services` — the services-layer skill this one assumes is already done.
- `schoolhub-ui-port` — for when a screen needs a `packages/ui` primitive that doesn't
  exist yet, rather than composing existing ones.
