# Students Dashboard — Phase 3: Enrollment, Class/Section Allocation & Transfers

> **Agent Context:** This is the design for Phase 3 of the `/students` dashboard rebuild,
> following Phase 1 (`docs/superpowers/plans/2026-09-30-students-dashboard-phase-1.md`) and
> Phase 2 (`docs/superpowers/plans/2026-10-03-students-phase2-relations.md`), both merged. It
> was produced and adversarially reviewed across three rounds inside the harness's own Plan
> Mode (not this repo's brainstorming flow) before being transcribed here unchanged, because
> this phase's scope was well-bounded enough to go straight from research to a reviewed
> design without a separate brainstorming dialogue. The backend touches needed are small but
> real (three changes, named in full below) — this is a dashboard-first phase, not a
> backend-heavy one. The companion implementation plan is
> `docs/superpowers/plans/2026-10-07-students-phase3-enrollment.md`.

**Work tier:** 2

## Context

Phase 1 (student directory, create/edit, withdraw) and Phase 2 (guardians, emergency
contacts, documents) are both shipped and merged. Both phases' own planning documents name
"Phase 3 — enrollment lifecycle and transfers" as the next piece: it unblocks the student
directory's `class_id`/`section_id`/`academic_session_id` filters (dead controls without an
enrollment UI to populate them) and completes the student lifecycle story the module doc
treats as one coherent whole (enroll → allocate → transfer → withdraw).

This is a **dashboard-first** phase — the core enroll/change-section/transfer/history
business logic, models, and tests already exist and are live-routed (verified directly in
`urls.py`/`views.py`, not assumed from docs: `StudentTransferViewSet` is wired from the root
`views.py`, not the unwired `transfers/` subpackage — same unwired-duplicate trap Phase 2 hit
with `guardians/`). An independent review of this plan's first draft found it understated its
own backend footprint and had three real correctness bugs; this revision fixes all of them.
**Backend touches needed: three**, all small and all named explicitly below — not "zero,"
but still far short of a backend-heavy phase.

## Scope

**In scope:**
- Dashboard UI for `POST /students/{id}:enroll` and `POST /students/{id}:change-section`.
- Dashboard UI for the `student-transfers` resource: request (`inter_campus`/`outgoing`
  only — see Alternatives), approve, reject, complete.
- A `/students/{id}/history` timeline view (enrollment + transfer events).
- A new "Enrollment" tab in `StudentDetailSheet`, containing all of the above as sub-sections
  (confirmed UX decision — one tab, not two).
- Wiring the student directory's `class_id`/`section_id`/`academic_session_id` filters into
  `student-directory-filters.tsx`.
- **Three backend changes** (all in scope, all named here so nothing is a surprise mid-task):
  1. A `student_id` query filter on `StudentTransferViewSet` (Phase 1's own named follow-up).
  2. A real fix to `StudentFilterSet`'s session/class/section filtering — confirmed, by
     independent review, to have a genuine correctness bug today (see Backend section).
  3. An OpenAPI response schema for `GET /students/{id}/history`, which currently has none
     (`@extend_schema` documentation only — no new business logic, no new endpoint).

**Out of scope (deferred elsewhere — do not fold in):**
- `waive_clearance` UI (blocked on fees/library/transport modules not existing yet).
- The 422 duplicate-admission override-reason field (its own separate follow-up).
- **`incoming` transfers are excluded from this phase's request UI entirely** (see
  Alternatives — this is a scope decision, not an oversight).
- `:cancel` for transfers (undefined, permanent backend gap).
- `student_withdrawals` as a proper initiate/approve entity (not planned anywhere).
- Finishing the backend's `student_management` package-split refactor (ADR-0010) — the
  `transfers/` subpackage exists but is unwired; this phase's backend changes go into the
  real, wired root `views.py`/`filters.py`, never the subpackage.
- Hiding Approve/Reject from a transfer's own requester (see Alternatives — not buildable
  as a client-side hint without a backend field this phase doesn't add; the existing
  role-based permission split already covers the common case).
- Migrating `exit-staff-dialog.tsx` and `student-documents-tab.tsx`'s delete confirmation
  onto the new `ResponsiveAlertDialog` — both have a real, pre-existing wrong-breakpoint bug
  (see the Dashboard section below), but fixing it is unrelated to this phase's own goal and
  is deferred to its own follow-up `fix` PR (see Alternatives and `deferred-work.md`).
- Bulk import/export/ID cards (Phase 4).

## Backend — three changes, each proven by its own test

**1. `student_id` filter on transfers.** `apps/api/apps/student_management/filters.py` (the
real, wired file — confirmed via `urls.py`'s actual import, **not**
`transfers/filters.py`, which doesn't exist and would be a no-op) gets a new
`StudentTransferFilterSet`:

```python
class StudentTransferFilterSet(django_filters.FilterSet):
    student_id = django_filters.UUIDFilter(field_name="student_id")

    class Meta:
        model = StudentTransfer
        fields = ["student_id"]
```

`views.py` — import it, add `filterset_class = StudentTransferFilterSet` to the real
`StudentTransferViewSet` (line ~680). Tests added to `TransferTests` (not
`CrossTenantEnrollmentTests` — this is an own-tenant filtering test, the cross-tenant case
is separate): seed **two** own-tenant students each with a transfer, filter by one
`student_id`, assert exactly that student's transfer comes back (a test with only one
transfer in the tenant can't actually prove filtering happened). Add a cross-tenant case
to `CrossTenantEnrollmentTests`: filtering by a foreign tenant's real student id returns an
empty list (list endpoints have no single object to 404 on).

**2. Fix `StudentFilterSet`'s session/class/section filtering — a real, pre-existing bug,
scoped narrowly to just that bug.** Today, `academic_session_id`/`class_id`/`section_id` are
three independent `django_filters.UUIDFilter`s each joining through `enrollments__...`
separately. Per Django's own documented behavior for filtering across multi-valued
relationships, combining two of these in one request can match a student via **two
different enrollment rows** (e.g. a session filter matching last year's enrollment and a
class filter matching this year's), not necessarily one enrollment satisfying both. This bug
already exists in production (`StudentFilterSet` already powers the live directory
endpoint); this phase is what newly exposes it through UI, so it's fixed here rather than
shipped forward. **User decision: the fix stays scoped to exactly this same-row bug — it
does NOT additionally restrict matches to an `active` enrollment.** A session filter must
still be able to match a student's enrollment from a past, no-longer-active session (e.g.
"who was in Grade 3 in the 2024-25 session," a legitimate register-style query) —
restricting to active-only would silently return zero results for any non-current session
filter, a real behavior change beyond the bug this phase is fixing. Fix: replace the three
independent `UUIDFilter`s with one combined filter method that builds a single
`Exists(StudentEnrollment.objects.filter(student=OuterRef("pk"), deleted_at__isnull=True,
**conditions))` (conditions built only from whichever of the three params were actually
supplied), so all supplied conditions are checked against one enrollment row without a
`.filter().distinct()` join fan-out. Add the new test to
`apps/api/apps/student_management/tests/test_api.py`, alongside the existing filter tests
(`StudentFilterSetTests`, around the existing `academic_session_id`/`class_id`/`section_id`
cases): combine two of the three filters against a student with enrollments in two different
sessions, and assert only a student whose **single enrollment row** (regardless of status)
satisfies both conditions together is returned — plus a case proving a past, non-active
session still matches correctly, and a cross-tenant case proving a foreign tenant's matching
student never appears (empty list, not 404 — this is a list endpoint).

**3. Document `GET /students/{id}/history`'s response shape.** It currently has no OpenAPI
response schema (`@extend_schema` gives only a description, no body) — a hand-written
dashboard type would be a second source of truth ADR-0017 rules out, and the gap is fixable
rather than a reason to work around it. The endpoint returns a plain list
(`ActionResponse.ok(build_history(...))`), and this repo's first use of a polymorphic,
discriminated-by-field response. Two real pieces, not one:
- **Runtime:** `PolymorphicProxySerializer` is annotation-only (it has no real
  `to_representation` — confirmed against the installed drf-spectacular source) — it's used
  solely inside `@extend_schema` for documentation. The view's real runtime behavior stays a
  plain dict lookup: for each event in `build_history(...)`, dispatch to
  `EnrollmentHistoryEventSerializer` or `TransferHistoryEventSerializer` by `event["type"]`,
  and return the serialized list.
- **Documentation:** `@extend_schema(responses=PolymorphicProxySerializer(component_name=...,
  serializers={"enrollment": EnrollmentHistoryEventSerializer, "transfer":
  TransferHistoryEventSerializer}, resource_type_field_name="type", many=True))` —
  `many=True` is required (this is a list response, not a single event).
- **Required alongside it, or schema generation fails:** both new status fields reuse
  `EnrollmentStatus`/`TransferStatus` — the same choice sets `StudentEnrollmentSerializer`/
  `StudentTransferSerializer` already expose. drf-spectacular will see one choice set used in
  two components and auto-rename it with a hash suffix, which fails this repo's
  `--fail-on-warn` generation step. Add `ENUM_NAME_OVERRIDES` entries (next to this
  settings module's existing ones) pinning `StudentEnrollmentStatusEnum`/
  `StudentTransferStatusEnum` to their real model choice classes, in the same commit.

Add a test asserting each returned event's keys exactly match its serializer's declared
fields (so `build_history`'s hand-built dicts can't silently drift from the documented
shape). Regenerate `openapi.yaml`/`schema.d.ts` in the same commit — the dashboard then
imports the generated type instead of hand-declaring one.

All three regenerate `apps/api/openapi.yaml`/`packages/api-client/src/schema.d.ts` in their
own commits per `.claude/rules/api-contract.md`.

## Dashboard — Services layer

**Reference-data fetchers** go in `Services.schoolOrganization`
(`school-organization-service.ts`), **not** `dashboard-service.ts` (correcting the first
draft) — `fetchHouses` already lives there, typed as `Pick<ApiSchemas["House"], "id" | "name">`
pulled from the generated contract; `fetchClasses`/`fetchSections` follow the identical
shape (`Pick<ApiSchemas["Class"|"Section"], ...>`), under new `endpoints.schoolOrganization`
registry entries. `dashboard-service.ts`'s existing `endpoints.dashboard.classes`/`.sections`
(used only internally, for the dashboard-home count widget) are untouched and stay — the new
entries point at the same real API paths for a different, option-list-fetching purpose; this
is two named callers of one URL, not a duplication to clean up. `dashboard-service.ts` is the
dashboard-home screen's own service file with hand-written types, and Phase 1's own Roadmap
already lists moving `fetchCampuses` *out* of it as a future cleanup — adding more
reference-data fetchers there would compound exactly the thing already queued for cleanup,
not follow precedent. This phase does not retrofit `school-organization-service.ts` to
ADR-0019's five-file shape: that module already exists (ADR-0019's "from creation" language
governs a brand-new module), and the three functions this phase adds are plain read-only GET
fetchers with no form schema or mapping logic to justify splitting out `-type`/`-constant`/
`-helper`/`.schema` files — it stays a plain service file.

Two pickers have different scoping rules — do not conflate them:
- **Directory filter pickers** (`student-directory-filters.tsx`): show every class/section/
  session regardless of `is_active`/status, since a past enrollment may reference a now-
  deactivated section, and the filter's whole purpose is historical lookup (`fetchClasses()`,
  `fetchSections({ classId })` with no `is_active` param, both scoped by `campus_id` only
  where the endpoint requires it).
- **Enroll / change-section / complete-transfer pickers**: scoped to the live, writable set —
  `fetchSections({ classId, campusId, is_active: true })`. `Section` is scoped by both
  `class_id` and `campus_id` — a genuinely cascading picker. The enroll session picker
  excludes sessions whose status is `closed` or `archived` (confirmed the exact
  `AcademicSession.status` enum values via the model) so a user can't pick a session that's
  no longer writable.

`fetchAcademicSessions` (an existing function, currently hand-typed in `dashboard-service.ts`,
consumed today only by `earnings-chart.tsx`) moves here too for the same reason, re-typed from
`ApiSchemas["AcademicSession"]` and kept on `collectPages` (sessions use cursor pagination).
`earnings-chart.tsx`'s one call site moves to the new location and its ad hoc query key
(currently the raw array `["dashboard", "academic-sessions"]`) moves to
`queryKeys.list("school-organization", "academic-sessions")` in the same change, so both
callers share one cache entry instead of two differently-keyed copies of the same data. Query
keys: `queryKeys.list("school-organization", "classes" | "sections" | "academic-sessions",
params)`.

**Enroll / change-section / history** — folded into the existing `students-service.ts`/
`students-type.ts`/`students.schema.ts` (sub-actions on the `Student`/`StudentEnrollment`
aggregate, matching `withdrawStudent`'s precedent). New `endpoints.students` entries:
`enroll: (id) => \`/students/${id}:enroll\``, `changeSection: (id) =>
\`/students/${id}:change-section\``, `history: (id) => \`/students/${id}/history\``
(mirroring `withdraw`'s existing entry shape). Both `enrollStudent` and
`changeStudentSection` take an `idempotencyKey` (the server honors `Idempotency-Key` on both
— the first draft only wired it for transfer actions, missing these two), generated once per
dialog open via `crypto.randomUUID()`, matching `WithdrawStudentDialog`'s existing pattern.
`fetchStudentHistory` returns the generated history type once backend change 3 lands — no
hand-written `HistoryEvent` types.

**Transfers** — a new, separate five-file `Services.studentTransfers` module (own top-level
resource, own three-action state machine, own permission namespace — same shape that earned
`guardians` its own module in Phase 2; `StudentDocument`'s superficially-similar top-level
routes don't actually match this shape, since `StudentDocument`'s *creation* is nested under
`/students/{id}/documents`, while `StudentTransfer`'s is top-level from the start). New
`endpoints.studentTransfers` entries: `list: "/student-transfers"`, `create:
"/student-transfers"`, `approve`/`reject`/`complete`: `(id) =>
\`/student-transfers/${id}:<action>\``. `StudentTransferViewSet` uses this API's default
cursor pagination (same as `student-guardians`). A single student's transfer history is
small and bounded (the same reasoning Phase 2 applied to guardian links/emergency contacts),
so `fetchStudentTransfers` uses a single bounded `fetchPage` call with its own
`TRANSFER_PAGE_SIZE` constant (matching the `RELATION_PAGE_SIZE` precedent), not
`collectPages` — there's no real multi-page case to follow cursors for.

The request-transfer schema matches the server's real, exact rules
(`assert_transfer_campus_fields`) field for field — the first draft's schema was wrong and
would 422 on every real submission:

```ts
const baseFields = { reason: z.string().min(1), effective_date: z.string().min(1) };
export const requestTransferFormSchema = z.discriminatedUnion("transfer_type", [
  z.object({
    transfer_type: z.literal("inter_campus"),
    from_campus_id: z.string().min(1), // pre-filled, read-only — the student's current campus
    to_campus_id: z.string().min(1),
    ...baseFields,
  }),
  z.object({
    transfer_type: z.literal("outgoing"),
    from_campus_id: z.string().min(1), // pre-filled, read-only
    external_school_name: z.string().min(1),
    ...baseFields,
  }),
]);
```

`incoming` is deliberately not a branch here — see Alternatives. `from_campus_id` is never a
user-editable field in either branch: it's always the student's own current campus, rendered
read-only, not a `Select` (the server doesn't enforce this match today — a real,
pre-existing gap, see Alternatives — but there's no reason to let a user type a wrong one).
`to_campus_id` must never appear on `outgoing`, and `external_school_name` must never appear
on `inter_campus` — the server rejects both combinations.

`requestTransfer` has **no** `idempotencyKey` parameter — confirmed the server's
`perform_create` for transfer requests does not go through `replay_or_execute`, unlike
`approveTransfer`/`rejectTransfer`/`completeTransfer`, which do and each take one.

Query keys, named explicitly (ADR-0014 — the first draft left these unnamed, and used a
camelCase module name inconsistent with this codebase's existing kebab-case convention,
e.g. `"school-organization"`/`"guardian-links"`):
- `queryKeys.list("students", "history", { studentId })` — shared by the current-enrollment
  card and the history timeline (see below — they're one query, not two).
- `queryKeys.list("student-transfers", "transfers", { studentId })`.

Invalidation per mutation: enroll/change-section invalidate the `history` key (current
enrollment + timeline both live there) and the student directory list (its new filters may
now match differently). Request-transfer, approve, and reject each invalidate **both**
`transfers` and `history` — `build_history` includes every transfer regardless of status, so
a decision on a transfer changes what the timeline shows too, not just the transfers list
(the first draft only invalidated `transfers` on these three, leaving the timeline stale).
Complete invalidates `transfers`, `history`, the student detail query (campus may have
changed), and the directory list.

## Dashboard — feature components

| File | Responsibility |
| --- | --- |
| `student-enrollment-tab.tsx` | Orchestrator. **Current enrollment and the history timeline share one query** (`fetchStudentHistory`) — they cannot load/fail independently, correcting the first draft's claim. "Current enrollment" is derived as: the single `"enrollment"`-type event with `status === "active"`, and if more than one somehow matches, the one with the latest `enrollment_date` — matching the server's own `active_enrollment()` tie-break exactly. Transfers list is its own separate query and does fail/retry independently of history. |
| `class-section-fields.tsx` | Shared, built once (three real consumers within this same plan — not a speculative extraction). Unlocked mode takes `campusId` **always**, not just in locked mode — the first draft's enroll-dialog gap let a user pick a section from any campus; closing it client-side is this phase's job even though the server itself doesn't check it (documented as a deferred backend gap, see Alternatives). |
| `enroll-dialog.tsx` | Nested `ResponsiveDialog`. Session select, `ClassSectionFields` (campus-scoped to the student's own campus), date, roll number. Capacity-override-reason field is shown **unconditionally** for a caller holding `students.student.update` — not reactively after an error, since the server's capacity error and every other `non_field` 422 (session not writable, student not active, prerequisites) arrive with the identical error code and field, with no way for the client to tell them apart (confirmed: the exception handler always sends `exc.default_code`, and there's no structured `meta` payload to key off today). Simplest correct option without a fourth backend change. |
| `change-section-dialog.tsx` | Locked-class `ClassSectionFields`. Gets the same unconditional override-reason field enroll does — the first draft only gave it to enroll, but `change_section` accepts the same field server-side. |
| `request-transfer-dialog.tsx` | Transfer-type select offers only `inter_campus`/`outgoing` (not `incoming` — see Alternatives). `from_campus_id` renders as a read-only label (the student's current campus), never editable. For `inter_campus`, the `to_campus_id` picker excludes the student's own current campus from its options (a client-side guard against the server's unenforced from≠to gap — see Alternatives). |
| `transfer-decision-dialog.tsx` | `decision: "approve" \| "reject"`, built on the new shared `ResponsiveAlertDialog` (see below) rather than its own one-off desktop/mobile split. |
| `complete-transfer-dialog.tsx` | `inter_campus` branch: locked-class `ClassSectionFields` (the third real consumer — `complete_transfer` takes only `section_id`, never a class; the server resolves the class from the student's existing enrollment and validates the chosen section belongs to it, matching this mode's existing "class fixed, pick a section" shape), required, scoped to the transfer's `to_campus_id` rather than the student's current campus. No campus-exclusion logic belongs here (that guard is in `request-transfer-dialog.tsx`, against `to_campus_id` at request time — see above). Confirmed server quirk, documented in the dialog's own copy rather than worked around: if the student has no active enrollment at completion time, the server silently updates only the student's campus and skips the section reassignment entirely (no error) — this phase ships the dashboard for the endpoint as it exists, not a backend fix for that quirk (`deferred-work.md` entry). `outgoing` branch: a plain confirm via `ResponsiveAlertDialog`. Never rendered for `incoming` (out of scope, see Alternatives). `complete_transfer` has no capacity-override path at all (confirmed: `_assert_capacity` is always called with `capacity_override_reason=None, actor_has_capacity_override=False`, unlike enroll/change-section's real parameters) — a completion that exceeds the destination section's capacity always 422s with no override, server or client; a named, deliberate gap (see Error Handling and `deferred-work.md`). |

`apps/dashboard/src/components/responsive-alert-dialog.tsx` — **new shared component**,
extracted now rather than copy-pasted a third time. Props mirror what `withdraw-student-
dialog.tsx`'s existing split needs: `open`, `onOpenChange`, `title`, `description`,
`confirmLabel`, `onConfirm`, `isPending` — rendering a Radix `AlertDialog` (desktop) or a
vaul `Drawer` with `dismissible={false}` and `role="alertdialog"` on its content (mobile),
switching on `useIsDesktopShell()` (1024px — this repo's real, documented breakpoint
convention), not `useIsMobile()` (768px). This phase's own new dialogs
(`transfer-decision-dialog.tsx`, `complete-transfer-dialog.tsx`'s `outgoing` branch) are its
only consumers in this PR.

**Scope decision on the two existing miswired copies:** `exit-staff-dialog.tsx` and
`student-documents-tab.tsx`'s delete confirmation both switch on `useIsMobile()` (768px)
instead of this convention — a real, pre-existing bug for the 768–1023px range (inside a
vaul `Drawer` region, the wrong primitive renders). `withdraw-student-dialog.tsx` already
correctly uses `useIsDesktopShell()`. Fixing those two is **not** done in this PR: it's a
pre-existing bug unrelated to Phase 3's own goal, and bundling an unrelated fix into a
feature PR is avoided on principle (same discipline Phase 2 applied to its own
`SignedFileURLField` follow-up). Recorded instead as its own `deferred-work.md` entry with
the real root cause (wrong breakpoint hook, not a design choice), ready to become a small,
separately-reviewed `fix` PR citing `6c16a87` (the commit that introduced
`student-documents-tab.tsx`'s copy) and whichever commit introduced `exit-staff-dialog.tsx`'s.
Add a Jest case at the 768–1023px width range using `test-utils.tsx`'s existing matchMedia
shim for the new component (the shim currently only toggles 375/1280 — extend it with a
third width, or pass a raw `matchMedia` mock for this one test, whichever this repo's test
utilities make less invasive).

`student-directory-filters.tsx`, `students-type.ts`, `students-constant.ts`'s filter-param
map, and `student-directory-table.tsx`'s filter state/reset logic — all four touched to add
Class/Section/Academic-session controls (the first draft only named the first file). These
are the **directory filter pickers** described in the Services section above — they show
every class/section/session regardless of status, since filtering by a past, now-inactive
one is the whole point of a historical register-style query.

`student-detail-sheet.tsx` — new "Enrollment" tab, gated on `students.student.view` (no
dedicated `students.enrollment.view`/`students.transfer.view` key exists — confirmed, both
reuse this one), with per-action permissions threaded down as props exactly as the other
three tabs already do.

The transfers list shows campus **names**, not raw ids (`from_campus_id`/`to_campus_id`) —
resolved through `Services.dashboard.fetchCampuses()`'s already-cached result. This is a
plain lookup against an already-fetched list, not the per-id fan-out ADR-0020 describes
(that ADR doesn't apply here — history events already carry resolved campus names directly
from the backend, and the transfer list's campus count is small and already cached from the
same request the enroll/change-section dialogs make).

## Error handling

Server field errors map via `applyServerFieldErrors` (every new field gets a `FormMessage`
from day one — Phase 2's review chain found this exact gap four separate times). Named
failure modes, corrected against the real exception types:
- Capacity exceeded with no override reason: a **422** `DomainRuleViolation` (not 409 — the
  first draft had this wrong), `non_field`. The override-reason field is already visible
  unconditionally to a caller holding `students.student.update` (enroll/change-section only —
  `complete_transfer` has no such field at all, a named gap below), so this error simply
  shows the server's message; there is no reactive show/hide behavior.
- Override reason supplied by someone lacking `students.student.update`: 422,
  `capacity_override_reason` field — unreachable via this UI, still mapped defensively.
- Duplicate roll number within a section: a **409** conflict (the first draft's named-failure
  list omitted this entirely) — shown via the existing generic conflict copy.
- Prerequisites not met / student not active / session not writable: 422, `non_field`.
- Segregation-of-duties rejection on approve: a **422** `DomainRuleViolation`, `non_field`
  (not 403 — `students.transfer.approve` is the permission gate; a 422 is the business-rule
  check on top of it, requester ≠ approver). There is no client-side "hide if you're the
  requester" hint (see Alternatives), so this error path is reachable and real, not a rare
  defensive case.
- Already-decided/already-completed transfer: 409, generic conflict copy + list
  invalidation so stale action buttons disappear.
- `complete_transfer` exceeding destination-section capacity: 422 `non_field`, same generic
  copy as other prerequisite failures — there is no override path for this action (see the
  `complete-transfer-dialog.tsx` row above and `deferred-work.md`), so the only remedy this
  UI offers is picking a different section.

Action permission keys, listed once here rather than scattered: enroll/change-section —
`students.student.update`; request-transfer — `students.transfer.create`; approve/reject —
`students.transfer.approve`; complete — `students.transfer.create` (confirmed from the real
view, not assumed symmetric with approve).

## Testing strategy

- **Backend:** the filter-correctness test (combining two of the three directory filters,
  asserting only a student whose **single enrollment row** satisfies both conditions counts,
  regardless of that enrollment's status), plus the past-non-active-session case, the two
  `student_id` transfer-filter tests, and the `history` response's new serializer shape.
- **Jest:** one file per new service/component file. Highest-value cases: the discriminated
  transfer schema's two real branches — in Zod 4, `z.object` strips unrecognized keys rather
  than rejecting them, so the test must assert the **parsed output omits** `to_campus_id` for
  an `outgoing` submission and omits `external_school_name` for an `inter_campus` one, not
  that parsing throws (and `z.strictObject` is the wrong fix here: react-hook-form keeps a
  field's value in its form state even after the user switches to a branch that no longer
  shows it, so a strict schema would fail validation on a field with nowhere left to display
  the error); `class-section-fields`'s
  campus-scoping in both locked and unlocked mode; `student-enrollment-tab`'s shared
  history/current-enrollment query failing and retrying as one unit, while the transfers
  list fails/retries independently; every new action's permission-gated absence. Every new
  dialog (`enroll-dialog.tsx`, `change-section-dialog.tsx`, `request-transfer-dialog.tsx`,
  `transfer-decision-dialog.tsx`, `complete-transfer-dialog.tsx`) uses `useGuardedSubmit`
  (`apps/dashboard/src/hooks/use-submit-guard.ts`, extracted in Phase 2's post-merge fix) for
  its submit handler, matching the pattern now established across the dashboard —
  `withdraw-student-dialog.tsx`'s own still-inline guard is not touched or migrated in this
  phase, since nothing else in this plan requires opening that file.
- **E2E, mocked lane:** extend `e2e/src/mocks/domains/school-organization.ts` with Class/
  Section fixtures (avoid duplicating the bare stubs `dashboard-home.ts` already registers
  for `/classes`/`/sections`/`/academic-sessions` — compose only the modules a given spec
  actually needs, matching existing practice); new `enrollment.ts` and
  `student-transfers.ts` mock modules; two new specs covering enroll/change-section and the
  full transfer lifecycle, including the permission-gated absence checks.
- **E2E, live lane:** the full rewrite `docs/deferred-work.md` already calls for. Requires
  real setup this phase must include, not wave at generically:
  - `apps/api/core/rbac/management/commands/seed_e2e_data.py` — add
    `students.transfer.create` + `students.enrollment.update` to the seeded `school_admin`
    role, and `students.transfer.approve` to the seeded `principal` role (neither has them
    today — confirmed by reading the seed command directly).
  - The approval step needs a genuine second authenticated identity (segregation of duties
    is server-enforced) — use the existing `signInAsSecondIdentity` fixture and
    `E2E_PRINCIPAL_EMAIL` env var, the same pattern `academics-promotion-journey.spec.ts`
    already uses for its own dual-role journey. Name it explicitly; don't re-derive it.
  - An inter-campus completion needs a second campus with a same-class section — add both
    directly to `seed_e2e_data.py` (not a privileged API call from the spec: the seeded
    `school_admin` identity has no campus/section-creation permission itself, so that route
    would need yet another identity just for setup). Seed that section's capacity generously
    high (or unbounded, if the model allows a null capacity) — the live lane re-runs this
    seed on a shared backing database, and a tightly-capped section would accumulate
    enrollments across repeated runs and eventually fail the happy path on capacity alone,
    not on a real bug.

## Alternatives considered

- **Hiding Approve/Reject from a transfer's own requester.** Rejected as unbuildable without
  a new backend field: `StudentTransferSerializer` exposes no `created_by`/`requested_by`
  today, so the client has no way to know who requested a given transfer. Adding one would be
  a fourth backend change for a UX nicety that's already substantially covered by the
  default role split (`students.transfer.create` → `school_admin`; `students.transfer.approve`
  → `principal` — a school_admin without the approve permission never sees the buttons at
  all under normal role assignment). Not worth the extra backend surface for the residual
  case of a user holding both permissions.
- **Excluding `incoming` transfers from this phase's request UI.** The backend's own
  `request_transfer` requires the student to already be `active` — a precondition that fits
  `inter_campus`/`outgoing` naturally but is an odd fit for "a student incoming from another
  school," which more plausibly belongs to an admission-time flow this module doesn't have
  yet. Combined with the backend's own documented "undefined" completion workflow for
  `incoming`, building request UI for a transfer type this phase can't meaningfully complete
  isn't worth it. Recorded in `deferred-work.md` as a deliberate exclusion, not a bug — if a
  future phase builds a genuine "incoming transfer student" admission flow, it's at that
  point that `incoming`'s request UI (and its completion workflow) should be designed
  together, not before.
- **Enroll's section picker not checking the student's campus server-side.** `enroll_student`
  has no check that a chosen section's campus matches the student's own campus — a real,
  pre-existing gap. Closed client-side only in this phase (the picker always scopes by the
  student's campus) rather than as a fourth backend change, since it requires deliberately
  working around the UI to hit (not a normal-usage data-integrity risk the way the directory
  filter bug was). Recorded in `deferred-work.md`.
- **`ResponsiveAlertDialog` extracted now, but not migrating the two existing miswired call
  sites in this PR.** The usual "wait for the third copy" guidance for the extraction itself
  is exactly met — `withdraw-student-dialog.tsx` is the third, already-correct, occurrence.
  Migrating `exit-staff-dialog.tsx` and `student-documents-tab.tsx` onto the new component
  would also fix their real 768–1023px breakpoint bug, but that bug is pre-existing and
  unrelated to this phase's own goal; bundling an unrelated fix into a feature PR makes the
  diff harder to review and muddies the `fix`-commit's own `Root cause:` line. Deferred to a
  dedicated follow-up `fix` PR instead (see Out of scope and `deferred-work.md`).
- **Reference-data fetchers in `Services.schoolOrganization`, not `Services.dashboard`.**
  Corrected from the first draft — see the Services section above for the full reasoning.
- **Deriving the transfers list and its actions from `/history` instead of keeping
  `student-transfers` as its own list (dropping backend change 1).** Rejected: `/history` is
  a read-only display timeline (summarized event dicts for the "what happened" view), while
  the transfers tab needs actionable objects — the real `StudentTransfer` id and state each
  Approve/Reject/Complete button acts on. Collapsing a read-only summary feed and an
  actionable management list into one endpoint/shape couples two different responsibilities
  that are better left separate, and Phase 2 already established the same separation
  (guardians' own list vs. a general activity view). The `student_id` transfer filter stays
  as its own small, well-tested backend change.
- **A new ADR for the first polymorphic/discriminated-union API response.** Added — see Docs.
  `PolymorphicProxySerializer` combined with a real dict-dispatch runtime is a genuinely new
  pattern in this codebase (every prior response is a single serializer type), and a future
  "list of mixed event types" endpoint should follow a documented precedent rather than
  rediscover the annotation-only/`ENUM_NAME_OVERRIDES` gotchas this plan just worked through.
  Not covered by an existing ADR: 0011 and 0019 govern service-module shape and file layout,
  neither addresses a polymorphic response contract. (The transfer list's campus-name display
  is still a plain cached-list lookup, not a new fan-out pattern — ADR-0020 doesn't apply to
  it, unchanged from the first draft's correction.)
- **Enforcing a transfer's `from_campus_id` ≠ `to_campus_id`, or that it matches the
  student's actual current campus, server-side.** `request_transfer` does not check either
  today — a real, pre-existing gap. Closed client-side only in this phase: `from_campus_id`
  is always rendered read-only (never user-typed) and `to_campus_id`'s picker excludes the
  student's current campus from its options. Not a fourth backend change, for the same
  reason as the enroll section-campus gap above — it requires deliberately working around
  the UI to hit. Recorded in `deferred-work.md`.
- **Mirroring module doc §11's "effective date within the active session" transfer
  validation client-side.** Neither the server nor this plan's schema enforces it today. Not
  added in this phase: doing so needs the transfer dialog to also fetch the relevant active
  session's date range, a new dependency this phase's schema doesn't otherwise need, for a
  narrow, low-stakes validation gap. Recorded in `deferred-work.md` rather than engineered
  around.

## Docs

- `docs/03-modules/student-management.md` §16 (the new `student_id` transfer filter; the
  `StudentFilterSet` correctness fix) and §20 ("as shipped," once this phase lands).
- `docs/project-status.md` — the student-management row, closing the Phase 3 reference.
- `docs/deferred-work.md` — close the two entries this phase resolves (the directory-filter
  "dead controls" note; the live-lane rewrite note, once the rewrite ships); add five new
  entries (the enroll section-campus server-side gap; the deliberate `incoming`-transfer
  exclusion; the transfer `from_campus_id`/`to_campus_id` server-side match gap; the
  §11 effective-date-within-session validation gap; the `exit-staff-dialog.tsx`/
  `student-documents-tab.tsx` wrong-breakpoint bug as a ready-to-pick-up `fix` PR); and
  extend the **existing** entry about the unwired `guardians/` resource package drifting from
  its real, routed counterpart to also name `transfers/viewset.py` — it won't receive this
  phase's new `filterset_class` either, same unwired-duplicate situation, not a new entry.
- A new ADR (next available number in `docs/decisions/`, assigned at implementation time
  against whatever main's `docs/decisions/README.md` holds then) documenting the
  `PolymorphicProxySerializer`-for-docs / dict-dispatch-at-runtime pattern for the history
  endpoint's discriminated response — see Alternatives — plus its index row.
- `apps/dashboard/messages/en.json`/`ur.json` — fix `transfers.requestDescription`'s existing
  copy (it currently advertises "incoming" transfers, which this phase's request UI
  excludes) and add `tabs.enrollment` plus the small set of new override/decision copy named
  throughout this plan, in both locales.

## Verification

Neither existing seed command fits the "not enrolled, Phase-2-ready" starting state this
phase's happy path wants: `seed_dev_data` creates no students at all, and `seed_all_roles`'s
seeded students are already enrolled and have no guardians/emergency contacts. Manual setup
is needed first: via the dashboard, create a new student (Phase 1), link a guardian and add
an emergency contact (Phase 2) — this student starts genuinely unenrolled. Sign in as
`school_admin`, open that student's detail sheet, switch to the new Enrollment tab — confirm
"not enrolled" and an Enroll action. Enroll them (session → class → section cascades, scoped
to the student's own campus; the override-reason field is visible, since this role holds
`students.student.update`) — confirm the current-enrollment card and history timeline both
update from the same request. Change their section. Request an inter-campus transfer
(confirm `incoming` is not offered as an option at all); sign in as a second, `principal`
identity; approve it; sign back in as the original `school_admin` and confirm the request is
now decided; complete it (picking a destination section in the new campus when prompted) and
confirm the student's campus/section actually moved and their name resolves correctly from
the cached campus list. Finally, open the student directory,
filter by a past academic session the test student was never part of (confirm zero results,
not an error), then filter by the real session + class together and confirm only a student
whose single enrollment row matches both conditions appears — not one matching either
independently.

## Independent review

- **Reviewer:** plan-reviewer agent, across three rounds inside Plan Mode, 2026-10-07.
- **Verdict:** REVISE (round 3, final) — this design was reviewed three times before being
  transcribed into this file unchanged: round 1 found the backend footprint was understated
  and the transfer-request schema would 422 on every real submission; round 2 found the
  capacity-override field's "reactive" design was server-unbuildable and the shared dialog
  extraction used the wrong breakpoint hook; round 3 found the history endpoint's
  `ENUM_NAME_OVERRIDES` gap, the `PolymorphicProxySerializer` runtime-dispatch
  underspecification, and several internal self-contradictions left over from round 2's
  fixes. All three rounds' findings are folded into the sections above — none are stale.
- **Findings addressed:** Every High and Medium finding across all three rounds is resolved
  in the text above, not just referenced: the filter fix uses an `Exists()` subquery with a
  cross-tenant test; the history endpoint's runtime dispatch is a plain dict lookup with
  `ENUM_NAME_OVERRIDES` added for the shared enum collision; the override-reason field is
  unconditional everywhere it's mentioned (no remaining "reactive" wording); the
  `complete-transfer-dialog.tsx` description matches the real `complete_transfer` service
  code (verified directly: section-only input, silent no-op with no active enrollment, no
  capacity-override path); the campus-exclusion guard is in `request-transfer-dialog.tsx`,
  not `complete-transfer-dialog.tsx`; `ResponsiveAlertDialog` migrates all three real
  consumers it should, with the two pre-existing miswired copies explicitly deferred to a
  separate `fix` PR rather than bundled in. This file is the design of record for
  implementation; this phase's own task-by-task plan is
  `docs/superpowers/plans/2026-10-07-students-phase3-enrollment.md`, reviewed separately.
