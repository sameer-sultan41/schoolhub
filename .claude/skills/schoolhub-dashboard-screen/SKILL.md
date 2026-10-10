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
(`apps/dashboard/src/features/students/`) is the current reference. It repeats `/staff`'s
shape and follows `/staff`'s existing precedents — notably the `isDetailLoading` gate that
stops a Radix `Select` blanking itself on edit-prefill, which `/staff` already had — and it
also records the mistakes caught while building it, so the next screen doesn't rediscover
them: a columns memo defeated by inline callbacks once the columns moved into their own
hook, an address that couldn't be cleared on edit (a gap `/staff`'s own `buildAddress`
still has), server field errors swallowed by sub-field components with no `FormMessage`,
and a photo upload that a quick Save silently dropped.

**Why this exists:** before Task 11, "how do I build a screen" lived only as tribal
knowledge spread across `/staff`'s source and four rounds of plan review on the students
plan. Every one of those review rounds, plus the branch's final review, caught a mistake
this skill now states up front — see each section's citation. This skill is the distilled
version so the next module (guardians, fees, timetable, …) starts from the fixed shape, not
from a blank page.

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
  <module>-toolbar.tsx             # stat chips + "New <X>" action
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

A narrower reference-data shape is derived the same way, not hand-written either:

```ts
// apps/dashboard/src/services/modules/school-organization/school-organization-service.ts:13
export type SchoolOrganizationOption = Pick<ApiSchemas["House"], "id" | "name">;
```

ADR-0017 has exactly one exception to "no second source of truth": the small runtime
enum value-arrays in `packages/types` that a `<Select>` or `z.enum(...)` needs (e.g.
`GENDER_VALUES`), hand-copied only because this repo's OpenAPI generator invocation doesn't
emit `--enum-values` yet. Otherwise `packages/types` keeps only cross-cutting types with no
generated source (envelope/pagination, auth/RBAC, tenant/website) — not a feature's own
shapes, and there is no carve-out for "small" hand-written ones.

## 2. Split a form before hitting the 400-line `max-lines` ceiling

This is not optional polish — `eslint-suppressions.json` freezes the existing
lint-violation baseline and may only shrink (ADR-0014); a new file cannot add a
suppression to it, so a form that grows past the ceiling has nowhere to go but split.

The students form ended up as **five** files, not the three the plan originally called for —
Task 5 found mid-implementation that even after splitting out the address block, the
remaining file still didn't clear the ceiling, so a second split peeled off the plain text
fields; the final review's photo-upload fix then needed real upload state, which went into
its own component rather than back into the dialog:

- `student-form-dialog.tsx` — the dialog shell: queries, mutation, the required fields
  and the `Select`s (the fields with real logic), and composes the three field components
  below.
- `student-form-schema.ts` — zod schema, `detailToFormValues`, `buildStudentInput`.
- `student-address-fields.tsx` — the six address sub-fields, `.map()` over a
  `[name, labelKey]` tuple list (`apps/dashboard/src/features/students/student-address-fields.tsx:10-17`).
- `student-profile-text-fields.tsx` — the six structurally-identical simple text fields
  (`preferred_name`, `blood_group`, `nationality`, `religion`, `previous_school`,
  `medical_notes`), same tuple-list pattern, with `medical_notes` filtered in/out by a plain
  `showMedicalNotes` boolean prop — **the permission check stays in the dialog**, the field
  component "has no idea what a permission is" (`student-profile-text-fields.tsx:25-31`).
- `student-photo-field.tsx` — the photo picker with its own upload state (see §5).

The lessons:

- Budget for a sub-field component *and* expect it might not be enough on the first pass.
  Don't treat a plan's file count as fixed — check the real line count as you write, and
  split again rather than reaching for a suppression.
- **Every extracted field renders its own `<FormMessage />`, as a direct child of its
  `FormItem`.** The dialog maps a server field error onto any field whose name is in the
  schema and then suppresses its top-level alert (§5) — so a field with no `FormMessage`
  shows only a red outline and the server's text appears nowhere. The final review caught
  exactly this on both split-out components (`blood_group`'s max length of 8 rejects
  "O positive" with no visible message). Direct child matters: `FormItem` only points
  `aria-describedby` at a `FormMessage` it finds among its own children
  (`packages/ui/src/components/form.tsx`'s `hasMessage`).
- **Check every schema field has an input.** `preferred_name` sat in the schema, defaults,
  `detailToFormValues` and `buildStudentInput` — and the detail sheet displayed it — but no
  component rendered it, so it could never be set. Diff the schema's keys against the
  rendered `name=` props when you split.

## 3. The `DataGrid` shape

Real example: `student-columns.tsx`, `student-directory-filters.tsx`,
`student-toolbar.tsx`, `student-directory-table.tsx`.

- **Don't hand-roll a sort header or a checkbox column.** Use `DataGridColumnHeader`
  (`packages/ui/src/components/data-grid-column-header.tsx`) for every sortable column
  header and `createSelectColumn<TRow>({ selectAll, selectRow })`
  (`packages/ui/src/components/data-grid-table.tsx`) for the bulk-selection column —
  `useStudentColumns` (`student-columns.tsx`).
- **Give the grid a translated `caption`** (`caption={t("list.caption")}`, the
  `<DataGrid>` call in `student-directory-table.tsx`) — a screen-reader-only `<caption>` naming what the
  table lists, same as `/staff`'s.
- **Local debounced search**, not a query-level debounce: a local `searchInput` state
  updates immediately for the input's own value, a separate `search` state (what the query
  actually uses) updates after `SEARCH_DEBOUNCE_MS` (`apps/dashboard/src/lib/constants.ts`,
  currently 300ms) via a `setTimeout` effect in `StudentDirectoryTable` (`student-directory-table.tsx`).
- **Narrow pagination with `isOffsetPagination`/`isCursorPagination`** before touching
  `total_pages`/`total_count` — `Page<T>.pagination` is itself optional, and those fields
  exist only on the offset arm of the `Pagination` union:
  ```ts
  // student-directory-table.tsx, StudentDirectoryTable
  const pageMeta = query.data?.pagination;
  const pageCount = pageMeta && isOffsetPagination(pageMeta) ? pageMeta.total_pages : 1;
  const totalCount = pageMeta && isOffsetPagination(pageMeta) ? pageMeta.total_count : 0;
  ```
  Never a single `?.` chain straight through to `total_pages`.
- **Bulk selection filtered to rows the action is actually valid for.** Bulk withdraw
  only acts on the selected rows that are still `active`, regardless of whether the viewer
  *can* withdraw — a non-active row has nothing to withdraw from:
  ```ts
  // student-directory-table.tsx, StudentDirectoryTable
  const selected = table.getSelectedRowModel().rows.map((r) => r.original);
  const selectedWithdrawable = selected.filter((s) => s.status === "active");
  ```
- **Gate a row action on the record's own state, not just the viewer's permission.** The
  per-row Withdraw button and the bulk-withdraw button both check `canWithdraw &&
  row.status === "active"` (the row-action `cell` in `student-columns.tsx`,
  `selectedWithdrawable` in `student-directory-table.tsx`)
  — a permission check alone would offer withdraw on an already-withdrawn row the backend
  itself refuses (confirmed against the mock backend's own domain-rule rejection,
  `e2e/src/mocks/domains/students.ts:137-141`).
- **`useCallback`-wrap the row-action handlers passed into the columns hook.** This was
  added during Task 8's review (commit `886df22`, "stabilize student columns callbacks")
  after the first version passed inline arrow functions from `student-directory-table.tsx`
  into `useStudentColumns`, which defeated that hook's own `useMemo` on every parent
  re-render (a search keystroke, a page change). `/staff` never hit this — its columns are
  built in the table component's own `useMemo`, not a separate hook:
  ```ts
  // student-directory-table.tsx, StudentDirectoryTable
  const handleEdit = useCallback((id: string) => {
    setFormDialog({ mode: "edit", studentId: id });
  }, []);
  const handleWithdraw = useCallback((id: string, name: string) => {
    setWithdrawDialog({ ids: [id], names: [name] });
  }, []);
  ```
  `useStudentColumns`'s own `useMemo` deps list includes both callbacks — a stable
  callback is what makes that memo actually skip
  recomputation.
- **Stat-chip counts go through `.toLocaleString()`**, not `.toString()`
  (`statChipState`'s `.toLocaleString()` call, `student-toolbar.tsx`), matching the
  shared `StatChip`/`AnimatedStat` (`@/components/stat-chip`, used by both `/staff` and
  `/students`) — a skeleton while pending, a translated "unavailable" string on error,
  never a fabricated number. Exact line numbers in this section are deliberately
  omitted: they rotted twice already as this screen kept changing after being written
  up — cite the function/symbol name instead and let the reader search for it.

## 4. `ResponsiveDialog`/`ResponsiveSheet`

- `useIsDesktopShell()` (1024px breakpoint, `apps/dashboard/src/hooks/use-is-desktop-shell.ts`)
  decides Dialog-vs-Drawer for a form; `useIsDrawer()`
  (`apps/dashboard/src/components/responsive-dialog.tsx:52`) is the equivalent for a
  sheet/footer that needs to render icon-only buttons on mobile vs. labeled ones on
  desktop — see `student-detail-sheet.tsx`'s `DetailFooter`, which renders icon buttons
  (`Pencil`, `UserMinus`) in the drawer branch and labeled `Button`s otherwise
  (the `DetailFooter` function, `student-detail-sheet.tsx`).
- **The mobile `<form>` needs `flex min-h-0 grow flex-col` inside a `Drawer`**, and the
  body must not get a second competing `max-h`:
  ```tsx
  // student-form-dialog.tsx:207-217
  <form ... className={isMobile ? "flex min-h-0 grow flex-col" : undefined}>
    <ResponsiveDialogBody
      className={isMobile ? "space-y-4 overflow-y-auto" : "max-h-[65vh] space-y-4 overflow-y-auto pe-1"}
    >
  ```
  Round 3 of the students plan review caught a desktop dialog with no height bound at all
  — the Save button sat off-screen at the CI runner's viewport. Both branches need an
  explicit scroll boundary, just different ones.
- **Both primitives unmount their content on close** (no `forceMount`), so state that
  lives in a component *inside* the dialog body starts fresh on every open for free — the
  photo field (§5) relies on this. State in the dialog component itself does not, which is
  what §6's mounting contract is about.

## 5. The form-dialog shape

Real example: `student-form-dialog.tsx`, `student-form-schema.ts`, `student-photo-field.tsx`.

- **snake_case zod schema**, matching the API's own field names 1:1 so
  `error.fieldErrors()` keys need no re-mapping step
  (`student-form-schema.ts:7-9`).
- **`Object.entries(error.fieldErrors())`, never a `for...of`** — it's a `Record`, not an
  iterable:
  ```ts
  // student-form-dialog.tsx:161
  for (const [field, issue] of Object.entries(error.fieldErrors())) {
  ```
  A field that matches the schema gets `form.setError` and suppresses the top-level alert,
  which is only safe because every field renders a `FormMessage` (§2).
- **`resolveErrorMessage(error, tErrors, fallback, "non_field")`** for a domain-rule error
  with no matching form field — e.g. a duplicate-student rejection that isn't about any
  single input (`student-form-dialog.tsx:168`). A round-1 review finding on this plan was
  a `field`-less error-message call that silently dropped the real server text; always
  pass the `"non_field"` key explicitly.
- **`isDetailLoading` keeps every `Select` unmounted until the edit prefill has actually
  applied**, not just until the query resolves — `/staff`'s own precedent
  (`staff-form-dialog.tsx`'s `populatedStaffId`/`isDetailLoading`, there before this plan
  started), which the students form follows exactly:
  ```ts
  // student-form-dialog.tsx:119-121
  const isDetailLoading =
    mode === "edit" &&
    (detailQuery.isPending || (detailQuery.data !== undefined && populatedStudentId !== studentId));
  ```
  Radix mirrors a `Select`'s value into a hidden native `<select>` and silently blanks
  itself if that value changes before the matching `<option>` has registered — true for
  every select on the render right after mount. Round 2 of this plan's review caught a
  draft that had dropped this gate on the edit-prefill path — it is easy to lose when a
  form is later split into sub-components.
- **An "open session" counter, not a boolean, for a stale-upload guard.** A boolean can't
  distinguish "still this same open session" from "closed and reopened before the upload
  settled". The dialog owns the counter (bumped on every open, including a reopen, inside a
  `useEffect` — never during render, which trips `react-hooks/refs`) and hands the photo
  field a function that snapshots it:
  ```ts
  // student-form-dialog.tsx:76-87, 177-182
  const sessionRef = useRef(0);
  const openSessionRef = useRef(0);
  function captureUploadSession() {
    const uploadSession = openSessionRef.current;
    const uploadedStudentId = studentIdRef.current;
    return () =>
      openSessionRef.current === uploadSession && studentIdRef.current === uploadedStudentId;
  }
  ```
- **A file upload is its own component with its own state, held to `/staff`'s standard.**
  The first students version was a bare `<Input type="file">` and the final review found it
  effectively lost data: Save stayed enabled during the three-step upload, so saving right
  after picking a photo reported success while the photo was silently dropped. What
  `student-photo-field.tsx` now does, mirroring `staff-form-dialog.tsx`'s photo handling:
  - an `idle | uploading | error` status, the file input disabled while uploading, and
    **Save disabled while uploading** — the field reports `onUploadingChange` to the dialog,
    which passes `disabled={isPhotoUploading}` to its submit button
    (`student-form-dialog.tsx:378, 404`);
  - a preview — the freshly picked file via `URL.createObjectURL` (revoked when replaced and
    on unmount), else the saved photo via `stableSignedUrl(record.photo_url)` while
    `photo_file_id` still matches the record's;
  - the upload's **own** error text (`FileUploadError`'s message is already specific — the
    backend's validation text or the failed step), never the form's generic fallback;
  - **one session guard for both outcomes**: success and failure alike are dropped if the
    session or record changed, so a stale failure can't surface as this session's error
    (`student-photo-field.tsx:97-124`);
  - a `mountedRef` so only a still-mounted instance reports back — a closed session's
    upload settling late must not re-enable Save while the next session's own upload is in
    flight (`student-photo-field.tsx:68-76`).
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

- **Mounting: the caller mounts it conditionally — a fresh instance per open.** Everything
  the dialog remembers about one attempt (the targets still to submit, seeded from props
  once on mount; the last partial-failure result; the cached idempotency keys) is
  per-instance state with **no reset-on-reopen logic at all**, and it needs none, because
  its only caller renders it only while a selection exists:
  ```tsx
  // student-directory-table.tsx, StudentDirectoryTable
  {withdrawDialog && (
    <WithdrawStudentDialog
      open
      onOpenChange={(open) => {
        if (!open) setWithdrawDialog(null);
      }}
      studentIds={withdrawDialog.ids}
      studentNames={withdrawDialog.names}
    />
  )}
  ```
  The contract is written on the component itself (its own header comment in
  `withdraw-student-dialog.tsx`). A
  persistent, `open`-toggled instance would reopen showing the previous attempt's failure
  list, submit the previous selection, and resend a past attempt's idempotency key — which
  the server replays (`apps/api/core/idempotency/services.py`) rather than performing the new
  withdrawal. History worth knowing so nobody "fixes" this back: Task 7's review added a
  `!open` reset effect assuming a persistent mount; Task 8 shipped the conditional mount,
  so that effect's branch could never run; the final review deleted it and its
  `react-hooks/set-state-in-effect` suppression in favour of the documented contract.
- **The general rule: a dialog's own reset logic must cover every way it is actually
  mounted — no more, no less.** `StudentFormDialog` is mounted *both* ways — persistently
  by `StudentToolbar`'s `open={addDialogOpen}` (`student-toolbar.tsx`) and conditionally by the directory
  table — so it carries its own reset-on-close effect and session counter (§5).
  `WithdrawStudentDialog` is only ever mounted conditionally, so it carries neither, and
  says so on the component. Adding a caller that mounts a dialog persistently means adding
  the matching reset first, not after the stale-state bug shows up; a reset effect for a
  mounting style no caller uses is dead code that misleads the next reader.
- **`RequestOptions.idempotencyKey`**, generated once per dialog instance (per target, for
  a bulk action) and reused on retry — not regenerated each submit attempt:
  ```ts
  // withdraw-student-dialog.tsx:111-115
  const keysRef = useRef(new Map<string, string>());
  function keyFor(id: string): string {
    if (!keysRef.current.has(id)) keysRef.current.set(id, crypto.randomUUID());
    return keysRef.current.get(id) as string;
  }
  ```
  A later, logically distinct attempt never sees these keys because it is a new open, so a
  new instance with an empty map — the mounting contract above is what makes that true.
- A bulk action's per-target outcome never pairs back to its target by array index —
  each promise resolves to its own `{ id, name, ok }`, because `noUncheckedIndexedAccess`
  makes `targets[i]`/`outcomes[i]` a real compile error when two separately-typed arrays
  have no guaranteed lockstep (`withdraw-student-dialog.tsx:124-152`).
- On partial failure, narrow the retry to only the ids that still need attention, reusing
  each one's cached idempotency key (`withdraw-student-dialog.tsx:163-165`).

## 7. The detail sheet

Real example: `student-detail-sheet.tsx`.

- **`"medical_notes" in data`, not `data?.medical_notes` or a falsy check**, to
  distinguish "the backend omitted this key because you lack visibility" from "the field
  exists and is simply empty for this record":
  ```ts
  // student-detail-sheet.tsx, StudentDetailSheet
  const hasMedicalNotesField = data !== undefined && "medical_notes" in data;
  ```
  A falsy check (`data?.medical_notes`) would show "Restricted" for both a field the
  viewer can't see *and* a field that's genuinely blank — two different facts.
- **Every line derived from the fetched detail gets the same loading gate** — a `Skeleton`
  until `data` arrives, never a label with an empty value. "Last updated" first shipped as
  `t("detail.lastUpdated", { when: data?.updated_at ?? "" })`: a raw ISO string once
  loaded, and "Last updated " with nothing after it while loading. It now renders a
  skeleton until `data` exists, then relative time via `date-fns`' `formatDistanceToNow`,
  the same rendering as `/staff`'s `formatLastUpdated` (`student-detail-sheet.tsx`'s own
  `formatLastUpdated`).
- **Docs describe the sheet that shipped.** Phase 1's sheet has Personal, Academic and
  Medical sections and no address section — the final review caught the module doc and
  `project-status.md` claiming otherwise. Adding the address section is a logged follow-up
  in `docs/deferred-work.md`.

## 8. Query keys and invalidation

`queryKeys.list(module, resource, params)` / `.detail(module, resource, id)` /
`.module(module)` (`apps/dashboard/src/lib/query-client.ts:58-65`). A mutation that
changes something the dashboard home's own counts reflect invalidates **both**:

```ts
// student-form-dialog.tsx:152-153, withdraw-student-dialog.tsx:155-161
void queryClient.invalidateQueries({ queryKey: queryKeys.module("students") });
void queryClient.invalidateQueries({ queryKey: queryKeys.module("dashboard") });
```

## 9. i18n

Reuse `common.*` for generic labels — `tCommon("cancel")`, `tCommon("save")`,
`tCommon("close")`, `tCommon("edit")` — rather than adding a per-screen
`students.actions.cancel` duplicate. A round-4 review finding on this plan was a
half-applied dedup: `actions.edit`, `form.loading` and `detail.close` had been added as
near-duplicates of existing `common.*` keys before being caught and removed, with call
sites switched to `tCommon`. Every new key goes into **both** `messages/en.json` and
`messages/ur.json` — `src/i18n/messages.types-check.ts` fails `tsc` on a locale missing a
key en.json has.

## 10. Tests

- **`renderWithProviders`** for most cases — fresh mount per test, no cross-test state.
- **A locally-built `QueryClientProvider` wrapper** (not `renderWithProviders`, which
  can't survive `rerender`) for any test that needs the *same* component instance across
  prop changes — a stale-upload-after-reopen or a reopen-after-close regression test:
  ```tsx
  // student-form-dialog.test.tsx:294-308
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </NextIntlClientProvider>
    );
  }
  const { rerender, unmount: unmountDialog } = render(
    <StudentFormDialog open mode="create" onOpenChange={onOpenChange} />,
    { wrapper: Wrapper },
  );
  ```
  If the component under test calls `useTranslations`, the wrapper needs
  `NextIntlClientProvider` too — a round-3 finding was a wrapper with only
  `QueryClientProvider`, which threw before the test reached its first assertion.
- **Anything that picks a file needs jsdom's gaps stubbed**: `stubObjectUrls` (jsdom has no
  `URL.createObjectURL`/`revokeObjectURL`) and, to assert on a preview `<img>`,
  `stubImageLoading` (Radix's `AvatarImage` otherwise waits forever for a load jsdom never
  performs). Both live in `student-form-dialog.test.tsx`, copied from
  `staff-form-dialog.test.tsx`; unmount before restoring the URL stubs, since the field
  revokes its object URL on unmount.

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
   `ApiSchemas["<Model>"]` (or a `Pick<>` of one), re-exported from the domain's own
   `<domain>-service.ts` (ADR-0017).
2. `<module>-row.ts` maps the wire record to the table's row shape.
3. `<module>-form-schema.ts`: snake_case zod schema, `detailToFormValues`,
   `build<Module>Input(values, mode)` with create-vs-edit clearing semantics.
4. `<module>-form-dialog.tsx`: `ResponsiveDialog`, `isDetailLoading` gate on every
   `Select`, an open-session counter for any async upload, `Object.entries(error.fieldErrors())`
   with a `"non_field"` fallback. Split sub-sections into their own files **before** 400
   lines, not after — check the real line count, don't trust the plan's file list. Every
   field (split-out ones included) renders a `FormMessage`; every schema key has an input.
5. A file field is its own component: uploading/error state, preview, Save disabled while
   uploading, the upload's own error text, one session guard for both outcomes.
6. `<module>-columns.tsx`: `useMemo`'d `useColumns()` hook, `DataGridColumnHeader` +
   `createSelectColumn`, row actions gated on both permission and the record's own state.
7. `<module>-directory-filters.tsx`: local debounced search via `SEARCH_DEBOUNCE_MS`,
   `Select` filters with a `aria-label` on each trigger.
8. `<module>-directory-table.tsx`: owns all state, a translated `DataGrid` `caption`,
   `isOffsetPagination`/`isCursorPagination` narrowing, `useCallback`-wrapped row-action
   handlers passed into the columns hook, bulk selection filtered to the action's valid
   subset, and each dialog conditionally mounted (`{state && <Dialog open ... />}`).
9. `<lifecycle-action>-dialog.tsx`: `idempotencyKey` per dialog instance (per target for
   bulk), per-target outcome tracking with no index pairing, and a written mounting
   contract — conditionally mounted by its caller, no reset effect needed; add a reset
   only if a caller genuinely needs to keep it mounted.
10. `<module>-detail-sheet.tsx`: `ResponsiveSheet`, `useIsDrawer()` for its footer, a
    `"field" in data` check for any field with a visibility-vs-empty distinction, a
    loading gate on every data-derived line, and timestamps as relative time.
11. `<module>-toolbar.tsx`: stat-chip `useQuery`s with `pageSize: 1` per `StatChip`
    (icon + `AnimatedStat` + label, matching `/staff`'s own), counts through
    `.toLocaleString()`, fail-closed on an unresolved permission (disabled + a `title`
    explaining why).
12. Route `page.tsx`: thin server component, `<Toolbar/>` + `<DirectoryTable/>`.
13. Both mutation paths (create/edit dialog, destructive action) invalidate
    `queryKeys.module("<module>")` **and** `queryKeys.module("dashboard")` if the home
    screen shows a related count.
14. i18n: reuse `common.*`, don't add a per-screen near-duplicate; new keys in both
    `en.json` and `ur.json`.
15. Jest: `renderWithProviders` by default; a local `QueryClientProvider` (+
    `NextIntlClientProvider` if the component uses `useTranslations`) wrapper only for a
    same-instance-across-rerender regression test; object-URL/image stubs for file fields.
16. e2e: register the page object in `e2e/src/pages/index.ts` and the fixture in
    `e2e/src/fixtures/index.ts`; a `MockModule` in `e2e/src/mocks/domains/`; assert a
    default-filtered screen's own view, not just that an action disappeared.
17. Docs describe what shipped, checked against the components — not against the plan.

## What this does NOT cover

- **Tabbed detail views with nested CRUD** (guardians, emergency contacts, documents under
  a student's own detail) — Phase 1's `StudentDetailSheet` is deliberately flat; wrapping
  it in `Tabs` with nested per-tab create/update/delete flows is Phase 2's own pattern, not
  yet shipped as a worked example.
- **Bulk import/export.** Don't hand-roll either: both are shared. A column-mapping-free
  CSV/.xlsx import against a fixed required/optional column set is the shared
  `BulkImportDialog` (`apps/dashboard/src/components/bulk-import-dialog.tsx`), fed by a
  service's `start(file)` and that module's column lists. An export (or any `202 + job`
  whose result is a file, like the ID-card PDF) is the shared `useJobFileDownload` hook
  (`apps/dashboard/src/hooks/use-job-file-download.ts`). `/staff`'s toolbar
  (`apps/dashboard/src/features/staff/staff-toolbar.tsx`) and `/students`'
  (`apps/dashboard/src/features/students/student-toolbar.tsx`) are the two worked examples,
  and `student-id-cards-button.tsx` shows the hook with an argument.

## Related

- The students Phase 1 plan,
  [`docs/superpowers/plans/2026-09-30-students-dashboard-phase-1.md`](../../../docs/superpowers/plans/2026-09-30-students-dashboard-phase-1.md)
  — the plan this skill was written from; its "Independent review — summary across four
  rounds" section is the source of the review-round findings cited throughout.
- [ADR-0017](../../../docs/decisions/0017-generated-wire-types-for-new-domains.md) —
  generated wire types for a new domain.
- `/staff`'s source (`apps/dashboard/src/features/staff/`) — the original reference
  implementation this pattern was first established against; its toolbar and `/students`'
  are the two shipped examples of bulk import/export.
- `schoolhub-api-services` — the services-layer skill this one assumes is already done.
- `schoolhub-ui-port` — for when a screen needs a `packages/ui` primitive that doesn't
  exist yet, rather than composing existing ones.
