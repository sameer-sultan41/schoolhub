# Students Dashboard — Phase 2: Guardians, Emergency Contacts & Documents

> **Agent Context:** This is the design spec for Phase 2 of the `/students` dashboard
> rebuild, per the Roadmap in `docs/superpowers/plans/2026-09-30-students-dashboard-phase-1.md`.
> It is implemented against `main` as of PR #96 (Phase 1) and PR #97 (UI polish), both
> merged. This phase is dashboard-first, but carries four small, deliberate backend
> additions surfaced across three rounds of independent plan review (ADR-0015):
> `GuardianSerializer` gains a `photo_url` field (guardians have no display URL for their
> uploaded photo today, unlike students); the `principal` role gains
> `students.document.view` in the permission registry (it already holds `.verify`, but
> not the view permission needed to see the tab it verifies from — a pre-existing gap in
> the permission matrix) — **this reaches only freshly dev/e2e-seeded `principal` roles**,
> since no production code anywhere provisions a default role but `school_owner` for an
> already-live tenant (a pre-existing, platform-wide `core.rbac`/`core.tenancy` gap,
> recorded in `docs/deferred-work.md`, not fixed by this phase — a backfill migration was
> considered and explicitly rejected once this was understood); `core/files`' signed
> download URLs gain a `Content-Disposition: attachment` header, applied globally, so a
> document download forces a real save-as/download regardless of file type instead of
> relying on an anchor's `download` attribute, which browsers ignore cross-origin; and a
> new `students.document.view`-gated `:download` action on `StudentDocumentViewSet`, so
> the dashboard's own document-download path no longer relies on the generic, every-
> staff-role `platform.file.view` key — though that generic `core/files` endpoint itself
> remains open platform-wide (pre-existing, cross-cutting, out of scope here). Every other
> endpoint this phase needs already exists and is already wired. The Guardians tab's
> per-guardian name resolution (fan out one `GET /guardians/{id}` per linked guardian,
> rather than a backend-embedded summary) is itself recorded as
> [ADR-0020](../../decisions/0020-client-fan-out-for-unembedded-nested-ids.md).

**Work tier:** 2

## 1. Purpose

Phase 1 shipped a flat student directory, create/edit, a read-only detail view, and
withdraw. It deliberately left out guardians, emergency contacts and documents — the
"relations" that the module doc (`docs/03-modules/student-management.md` §4, §6, §9,
§16) treats as core to a student record, and that §11's own validation ("at least one
guardian link and one emergency contact required to complete enrollment") makes a
prerequisite for Phase 3 (enrollment). This phase closes that gap: it wraps the existing
flat `StudentDetailSheet` in tabs and adds three new tabs — Guardians, Emergency
Contacts, Documents — each backed by backend endpoints that already exist and are
already wired (confirmed by reading `apps/api/apps/student_management/views.py`
directly: `GuardianViewSet`, `StudentGuardianViewSet`, `StudentGuardianLinkViewSet`,
`EmergencyContactLinkViewSet`, `StudentDocumentLinkViewSet`, `StudentDocumentViewSet`,
and the generic `core/files` `FileViewSet.download`).

**Success looks like:** a `school_admin` opens a student's detail sheet, switches to the
Guardians tab, links an existing guardian (found by search) or creates a new one with a
photo, marks them primary; switches to Emergency Contacts, adds an ordered contact;
switches to Documents, uploads a birth certificate, and a `principal` later verifies it
from the same tab. All three flows work on mobile (drawer) as well as desktop (sheet).

## 2. Scope

**In scope:**
- Tabbed `StudentDetailSheet` (Profile / Guardians / Emergency Contacts / Documents).
- Guardians tab: list linked guardians with their per-link flags; link an existing
  guardian (search) or create a new one (with an optional photo); edit a link's flags
  (including primary promotion); edit a guardian's own person-fields.
- Emergency Contacts tab: list (ordered by priority); add a contact. No edit, no delete,
  no reorder — the backend has no endpoints for any of those (`EmergencyContactLinkViewSet`
  is list+create only).
- Documents tab: list (type, title, verification status, expiry); upload (file +
  type + title + optional notes/expiry); verify/reject (permission-gated); delete
  (permission-gated); download (via a new, `students.document.view`-gated `:download`
  action on `StudentDocumentViewSet` — see below).
- New `Services.guardians` domain (five-file shape, ADR-0019); additions to
  `Services.students` for the nested emergency-contacts/documents/guardian-link calls,
  for fetching one guardian by id (`fetchGuardianById`, needed so the Guardians tab can
  show a linked guardian's name — a link row carries only `guardian_id`), and for the
  new `getDocumentDownloadUrl` (wrapping the new `:download` action below — not a reuse
  of `Services.jobs.fetchFileDownloadUrl`, since that wraps the generic `core/files`
  action this phase deliberately doesn't use for student documents).
- Four small backend additions (see the Agent Context note above): `GuardianSerializer.
  photo_url` (mirrors `StudentSerializer.get_photo_url`'s purpose-gated pattern exactly);
  `principal` added to `students.document.view`'s allowed roles in
  `apps/api/apps/student_management/permissions.py` (plus the matching row in
  `docs/03-modules/student-management.md` §4) — reaching only dev/e2e-seeded tenants, no
  production backfill (see Agent Context); a `Content-Disposition: attachment` header,
  applied globally, on `core/files`' signed download URLs
  (`core/files/storage.py`/`services.py`); and a new `students.document.view`-gated
  `:download` action on `StudentDocumentViewSet`. The first and last regenerate
  `openapi.yaml`/`schema.d.ts` per `.claude/rules/api-contract.md`; the permission and
  Content-Disposition changes touch no serializer/view signature, so neither alone
  touches the API contract.
- Backend test gaps closed (otherwise no new backend code beyond the four additions
  above — the rest are tests only): a cross-tenant test for emergency contacts (none
  exists, plus one for creating a contact under another tenant's student), `GET
  /student-guardians/{id}` and the guardians list (untested), `PATCH /guardians/{id}`
  (untested), reading another tenant's guardian link (404), and the guardian-link
  duplicate conflict (409).
- i18n: `students.guardians.*`, `students.emergencyContacts.*`, `students.documents.*`
  namespaces, in both `en.json` and `ur.json`.

**Out of scope (deferred, named explicitly so they aren't silently dropped):**
- **Unlinking a guardian from a student.** No backend endpoint exists
  (`GuardianViewSet`'s own docstring: "No destroy — a guardian with no remaining student
  links simply stops appearing in any student's roster"; `StudentGuardianLinkViewSet` is
  list+create only). The UI never offers an unlink action; this is stated as a known
  limitation in the UI copy and recorded in `docs/deferred-work.md`, not worked around.
- **Editing, deleting, or reordering an emergency contact.** Same story —
  `EmergencyContactLinkViewSet` is list+create only. The add form says plainly that a
  contact can't be changed after saving.
- Enrollment, class/section allocation, transfers (Phase 3).
- Bulk import/export, ID cards (Phase 4).
- AI-STU-03 (document OCR/extraction) — `docs/04-ai/ai-governance.md` gates every AI
  feature behind its own approval flow; not this phase's problem.
- A `Combobox`/typeahead primitive. The Roadmap already settled this: "search existing
  guardian" reuses a `Select` populated by a debounced search query — the same
  `useDebouncedValue` hook the student directory table's own filter already uses
  (Phase 1's Campus/House pickers are a different case: they list every campus/house with
  no search or debounce at all, since those lists are small and tenant-bounded). A real
  combobox is its own `packages/ui` addition (`schoolhub-ui-port`), out of scope here.
- Guardian "change-request" flow from the parent portal (§6) — portal-side, not this
  phase's dashboard-admin surface.

## 3. Architecture

### 3.1 Tabbed detail sheet

`StudentDetailSheet` (`apps/dashboard/src/features/students/student-detail-sheet.tsx`)
gains a `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` wrapper (`packages/ui`, already
ported, unused anywhere in this app yet — this is its first real consumer). The
existing Profile/Academic/Medical `FieldSection`s move under a `Profile` tab,
unchanged. Three new `TabsContent` panels render the three new feature components.

**Lazy per-tab data loading:** `packages/ui`'s `Tabs` wraps Radix `Tabs`, which unmounts
an inactive `TabsContent` panel by default (no `forceMount` is set anywhere in this
plan) — so a tab component's own `useQuery` never even runs until Radix actually mounts
that panel; there is nothing left for an `enabled` flag to gate, and no extra
`activeTab === "..."` state or gating is needed on top. Reopening the sheet
for a different student resets to the Profile tab via React's `key`-based remount
(`<Tabs defaultValue="profile" key={row.id}>`), not a `useEffect`.

**Mobile:** the existing `ResponsiveSheet`/`useIsDrawer()` split is unaffected — `Tabs`
renders identically in both the `Sheet` and `Drawer` branches. Four labels
(Profile/Guardians/Emergency contacts/Documents) risk overflowing a 375px drawer, worse
in Urdu — `packages/ui`'s `TabsList` does not build in scroll handling on its own, so the
`TabsList` gets `overflow-x-auto` as a defensive measure rather than assuming the labels
always fit on one line; verify visually at 375px in both locales during implementation.

### 3.2 Services layer (ADR-0011)

- **`Services.guardians`** (new domain) — the `Guardian` person resource and its link to
  a student: `searchGuardians(query)` (`GET /guardians?search=`), `fetchGuardianById(id)`
  (`GET /guardians/{id}`, used to resolve a link row's name/phone — a
  `GET /students/{id}/guardians` link carries only `guardian_id`, no embedded guardian
  fields), `createGuardian(input)` (`POST /guardians`), `updateGuardian(id, input)`
  (`PATCH /guardians/{id}`), `linkGuardianToStudent(studentId, input)` (`POST
  /students/{id}/guardians`), `updateGuardianLink(linkId, input)` (`PATCH
  /student-guardians/{id}`), `fetchGuardianLinks(studentId)` (`GET
  /students/{id}/guardians`). The Guardians tab resolves each link's guardian via a
  `useQueries` fan-out over `fetchGuardianById` — through `Services`, never a direct
  `apiClient`/`endpoints` call from the component (ADR-0011) — rather than adding a
  backend-embedded guardian summary; a tenant's guardian-per-student count is small
  enough that the extra per-row requests aren't worth a new serializer shape.
- **`Services.students`** — additions for the two remaining nested relations, which have
  no identity or reuse outside a single student's detail view (unlike guardians, which
  are genuinely shared across siblings and searched tenant-wide):
  `fetchEmergencyContacts(studentId)`, `addEmergencyContact(studentId, input)`,
  `fetchDocuments(studentId)`, `uploadDocumentRecord(studentId, input)` (the metadata
  POST after the file itself is already uploaded via `Services.files.uploadFile`),
  `deleteDocument(documentId)`, `verifyDocument(documentId, decision)`,
  `getDocumentDownloadUrl(documentId)` (see below). These go directly into the existing
  `students-service.ts`/`students-type.ts` files (no new per-resource file split —
  ADR-0019's five-file shape applies to the brand-new `Services.guardians` domain, not to
  an existing module gaining a few more functions).
- **Document download** is its own `getDocumentDownloadUrl(documentId)` wrapping the new
  `students.document.view`-gated `POST /student-documents/{id}:download` action (Task 1)
  — deliberately NOT a reuse of `Services.jobs.fetchFileDownloadUrl`
  (`apps/dashboard/src/services/modules/jobs/jobs-service.ts`), which wraps the generic
  `core/files` `POST /files/{id}:download` gated only by the broad `platform.file.view`
  key. `/staff`'s export download keeps using the generic one; student documents use the
  new, narrower action instead.

Query keys follow the existing `queryKeys` factory, whose third argument is a params
*object*, not a bare id: `queryKeys.list("students", "guardian-links", { studentId })`,
`.list("students", "emergency-contacts", { studentId })`, `.list("students", "documents",
{ studentId })`, `.list("guardians", "search", { query })`. A link/add/upload/verify/
delete mutation invalidates the matching list key.

### 3.3 Component responsibilities

| Component | Responsibility |
| --- | --- |
| `StudentGuardiansTab` | Lists linked guardians + flags (resolved via `fetchGuardianById` fan-out); "Add guardian" opens the chooser (search vs. create); shows a load-error state with retry on a failed fetch, distinct from the empty-list state. |
| `GuardianPickerDialog` | One dialog, two internal steps — never a dialog nested inside another (`packages/ui`'s `ResponsiveDialog` has no supported nested-drawer pattern on mobile). Step 1 ("choose"): search-existing (debounced `Select`, excluding guardians already linked to this student) **or** a "create new" tab with the same fields (including photo) as `GuardianFormDialog`, inlined directly rather than opened as a second dialog. Step 2 ("link"), reached from either path: the chosen/created guardian + relationship, ending in `linkGuardianToStudent`, retried on failure without re-creating the guardian. |
| `GuardianFormDialog` | Create/edit a guardian's own fields, including the photo via a shared `PhotoUploadField` (extracted from `StudentPhotoField` on this, its third use — students, staff, guardians — per the repo's third-copy rule; purpose `guardian.photo`). Shared by "create new" and "edit this guardian." |
| `GuardianLinkFlagsDialog` | Edit one link's `relationship`/`is_fee_responsible`/`can_pick_up`/`receives_communications` — a small form, `PATCH /student-guardians/{id}`. Never includes `is_primary`: promoting primary is a separate one-click row action (see below), since demoting without picking a replacement isn't an operation the backend supports directly. |
| `StudentEmergencyContactsTab` | Ordered list (read-only rows) + one add form. No per-row actions. |
| `StudentDocumentsTab` | List with per-row Verify/Reject, Download, Delete (each permission-gated); "Upload document" opens the upload dialog. |
| `DocumentUploadDialog` | File picker + `document_type` `Select` (6 seeded defaults) + title + optional notes/expiry; drives `Services.files.uploadFile` then `uploadDocumentRecord`. |

### 3.4 Permissions (module doc §4; one key's allowed roles change — see below)

| Action | Key |
| --- | --- |
| View guardians/links | `students.guardian.view` |
| Create/link a guardian | `students.guardian.create` |
| Update a guardian or a link's flags | `students.guardian.update` |
| View/add emergency contacts | `students.student.view` / `.update` (§4 declares no dedicated key — matches the real `EmergencyContactLinkViewSet`) |
| View documents | `students.document.view` |
| Upload a document | `students.document.create` |
| Verify/reject a document | `students.document.verify` |
| Delete a document | `students.document.delete` |

`students.document.view` currently grants `school_admin`/`admission_staff` only, while
`.verify` already grants those two plus `principal` — so a principal holds a permission
to verify a tab they cannot otherwise see. This phase adds `principal` to
`.view`'s allowed roles (`apps/api/apps/student_management/permissions.py` +
`docs/03-modules/student-management.md` §4), closing that gap rather than carrying it
forward silently.

Each new tab renders only for a caller holding *that tab's own* view key — not merely
"can view this student" — mirroring how the Documents tab's verify/reject/delete buttons
are already individually gated. Every action button is gated with
`hasPermission(currentUser, key)`, same as Phase 1 — UI hiding, never enforcement; the
server is the real gate.

## 4. Data flow — worked examples

**Link an existing guardian.** User opens Guardians tab → clicks "Add guardian" →
"Search existing" → types "Khan" → debounced `searchGuardians("Khan")` populates a
`Select` → user picks one → relationship + flags form appears → submit calls
`linkGuardianToStudent(studentId, {guardianId, relationship, isPrimary, ...})` →
invalidate the guardian-links list key → tab re-renders with the new row.

**Create and link a new guardian.** Same entry point → "Create new" tab (first/last name,
phone, email, optional photo — the same fields `GuardianFormDialog` uses, inlined into
this same picker dialog, not a nested second one) → on submit, `createGuardian` returns
the new guardian's id → the dialog advances to its link step, showing that guardian
selected → user picks a relationship → `linkGuardianToStudent` with that id and the
relationship/flags (defaulting as described above) → same invalidation. If linking fails,
retrying only re-runs `linkGuardianToStudent` — the guardian's id is already held in
state, so nothing re-creates it.

**Promote a link to primary.** Guardians tab's row action "Make primary" →
`updateGuardianLink(linkId, {isPrimary: true})` → the backend's own
`set_primary_guardian` service demotes the incumbent in the same transaction (confirmed
in `StudentGuardianViewSet.perform_update`) → invalidate and refetch; the previous
primary's badge disappears without a second client-side write.

**Upload and verify a document.** Documents tab's "Upload" → file picker + type +
title → `Services.files.uploadFile(file, "student.document")` resolves to a `fileId` →
`uploadDocumentRecord(studentId, {fileId, documentType, title, notes, expiresAt})` →
row appears with `verification_status: "pending"` → a `principal` later clicks
Verify/Reject → `verifyDocument(documentId, "verified" | "rejected")` → row updates in
place.

## 5. Error handling

- **Guardian search with no results:** `searchGuardians` is read-only; an empty result
  shows a dedicated "no matches" message (a new i18n key, distinct from the tab's own
  `guardians.empty` "No guardians linked yet." — this is a *search* empty state, not the
  tab's list empty state), with "Create new" still available from the same dialog.
- **Linking a guardian already linked to this student:** confirmed by reading
  `StudentGuardian`'s model constraints (`apps/api/apps/student_management/models.py`) —
  `UniqueConstraint(tenant, student, guardian, condition=deleted_at__isnull=True)`. A
  duplicate raises `IntegrityError`, which `core/api/exceptions.py`'s handler maps to a
  real `409 conflict` ("The request conflicts with existing data."), not an invented
  validation error. The picker excludes guardians already linked to this student from
  its search results as the primary defense; the 409 path is a defense-in-depth backstop
  (e.g. a second tab linking the same guardian concurrently), surfaced via the same
  `resolveErrorMessage` convention as every other mutation here.
- **Promoting primary when it's already primary:** idempotent no-op either way (the
  backend's `set_primary_guardian` only acts on an actual change); no special client
  handling needed.
- **Document upload failures:** reuses Phase 1's `FileUploadError` with its
  step-specific messages (`create`/`put`/`confirm`) verbatim — this is exactly the
  pattern `StudentPhotoField` already established.
- **A 403 on verify/delete for a caller who lost the permission mid-session:** the
  button is hidden by `hasPermission`, but if the request still 403s (a stale client
  cache of permissions), the mutation's `onError` shows the server's real message, not a
  generic one — same `resolveErrorMessage(..., "non_field")` convention as every other
  mutation in this module.
- **A failed tab query (guardians/contacts/documents list):** each tab shows its own
  load-error message with a retry action, distinct from — and never mistakable for —
  that tab's empty-list state; a stale error must clear once a retry succeeds.
- **Creating a guardian succeeds but the immediately following link fails:** the
  guardian's new id is kept in local state and only the link step is retried — the
  guardian is never re-created, since `GuardianViewSet` has no destroy endpoint and a
  duplicate create would be a permanent, unremovable record.
- **A tenant's document has a `document_type` outside the 6 seeded defaults** (a value
  the create form's `Select` never offers, but an older or externally-written row could
  still carry): the Documents tab renders the raw `document_type` string as a fallback
  rather than indexing into the fixed `documents.type.*` i18n map and hitting a missing
  key.

## 6. Testing strategy

- **Backend (Django):** close the named gaps — a cross-tenant test for
  `EmergencyContactLinkViewSet` (none exists today, plus one for creating a contact
  under another tenant's student), a test for `GET /student-guardians/{id}` and the
  guardians list (untested), a test for `PATCH /guardians/{id}` (untested), reading
  another tenant's guardian link (404), and the guardian-link duplicate conflict (409).
  These are additive test files/cases against already-shipped, already-correct
  endpoints — not new production code (except the registry/migration/storage tests the
  three backend additions above need, which do cover new code).
- **Jest (dashboard):** one `__tests__` file per new component, following the Phase 1
  pattern (mocked `Services.*`, `renderWithProviders`). Key cases: search-then-link,
  create-then-link, primary-promotion badge swap, emergency-contact add with no
  edit/delete controls rendered at all (not just disabled — genuinely absent, proving
  the "no backend support" constraint is honored), document upload → verify → delete,
  and permission-gated buttons absent for a caller without the key (mirroring Phase 1's
  `canUpdate`/`canWithdraw` tests).
- **E2E (Playwright, mocked `dashboard` project):** one flow per tab added to
  `e2e/tests/dashboard/students.spec.ts` or a new sibling spec, using the existing
  `MockApi` pattern; new mock domains for guardians/emergency-contacts/documents under
  `e2e/src/mocks/domains/`.
- **Not in scope:** the `students-admission-enrollment.spec.ts` live-lane rewrite stays
  Phase 3's job — it needs enrollment too, which this phase doesn't touch.

## 7. Alternatives considered

- **One combined "People & Documents" tab instead of three.** Rejected — guardians,
  emergency contacts and documents have distinct permission keys, distinct add flows,
  and distinct (lack of) edit/delete support; collapsing them would just move the
  distinction into conditional rendering inside one component instead of three small
  ones, with no real simplification.
- **Build a real Combobox now instead of reusing the `Select`-search composition.**
  Rejected for this phase — the Roadmap already settled this, and a proper
  typeahead-with-keyboard-nav primitive is its own `packages/ui` scope
  (`schoolhub-ui-port`), not warranted by this phase alone when a `Select` populated by a
  debounced search query (`useDebouncedValue`, already proven by the student directory's
  own filter) does the job.
- **Embed a guardian summary on `StudentGuardianSerializer` instead of a per-guardian
  `fetchGuardianById` fan-out.** Considered — it would save N requests per student's
  guardian list. Rejected for this phase because it's a backend change beyond the four
  already added (photo_url, the principal permission fix, download Content-Disposition,
  the gated document `:download` action), and a tenant's guardians-per-student count is
  small (the UI shows
  a handful of rows, not pages); the fan-out goes through `Services.guardians` properly
  either way, so upgrading to an embedded summary later is a pure backend+client change
  with no tab-component rewrite. Recorded as
  [ADR-0020](../../decisions/0020-client-fan-out-for-unembedded-nested-ids.md), since the
  choice sets a precedent for how the dashboard resolves ids from other nested lists.
- **Give guardians their own dedicated photo-upload component instead of sharing one with
  students.** Rejected — this would be the third near-identical copy of the same
  presigned-upload-then-preview flow (student, staff, guardian); the repo's own
  third-copy rule says extract at that point, so this phase pulls a shared
  `PhotoUploadField` out instead of adding a third copy.
- **Add backend unlink/edit/delete endpoints for guardian links and emergency contacts
  in this PR, to round out the UI.** Rejected — this phase's own framing (and the
  Roadmap) is dashboard-only; adding backend write paths the module doc never specified
  (§16 names no such endpoints) is scope creep into a separate, deliberate backend
  decision, not a UI gap to quietly patch over.
- **Store the emergency-contact permanence warning as a confirmation modal before
  submit.** Considered, rejected in favor of inline copy in the form itself — this
  isn't a destructive action (nothing is deleted), so a confirmation step would be
  friction without a matching risk; the module's own `WithdrawStudentDialog` reserves
  confirmation modals for genuinely irreversible-and-consequential actions.

## 8. Open questions

None blocking. Four decisions were made explicitly rather than left open: during
brainstorming, guardians get a photo-upload field in this phase (reusing the shared
`PhotoUploadField` pattern), and the document-type picker is a `Select` over the 6 seeded
defaults (not a free-text field) — a tenant-extended type is reachable only via `other` +
notes this phase, which is an acceptable gap given no endpoint currently lists a
tenant's extensions (`apps/dashboard/AGENTS.md`'s ADR-0017 convention doesn't apply here,
since there's no generated source for this list either way).

During independent plan review (ADR-0015), two more were resolved with the user in the
first round: add `GuardianSerializer.photo_url` (a small backend change, needed to make
the already-approved guardian photo actually displayable), and grant `principal` the
`students.document.view` permission (so the spec's own "a principal later verifies it"
success case is actually reachable). A second review round surfaced three more, also
resolved with the user: back-fill that permission onto tenants that already have a
`principal` role via a one-off data migration; force a real download via a
`Content-Disposition: attachment` header on `core/files`' signed download URLs, rather
than relying on an anchor's `download` attribute (which browsers ignore cross-origin);
and record the per-guardian `fetchGuardianById` fan-out as its own ADR
([ADR-0020](../../decisions/0020-client-fan-out-for-unembedded-nested-ids.md)) rather
than leaving an undocumented precedent for how the dashboard resolves ids from other
nested lists.

A third review round investigated the proposed backfill migration and found its premise
wrong: no production code anywhere provisions a default role other than `school_owner`
for an already-live tenant, so a migration scoped to "existing tenants' `principal`
role" would only ever touch dev/e2e seed fixtures — giving false confidence that
production tenants are covered when none are. **The user, informed of this, chose to
drop the migration** and document the real, platform-wide `core.rbac`/`core.tenancy` gap
in `docs/deferred-work.md` rather than expand this phase into building a tenant
role-provisioning system. The same round added a `students.document.view`-gated
`:download` action on `StudentDocumentViewSet`, so the dashboard's document-download path
no longer relies on the broad, every-staff-role `platform.file.view` key — **the user
confirmed this ships as-is**, without also closing the separate, pre-existing, and
cross-cutting exposure that `core/files`' own generic `GET /files`/`:download` endpoints
still grant to any `platform.file.view` holder (out of scope for this phase; recorded in
`docs/deferred-work.md`).
