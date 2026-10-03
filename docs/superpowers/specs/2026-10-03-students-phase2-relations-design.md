# Students Dashboard — Phase 2: Guardians, Emergency Contacts & Documents

> **Agent Context:** This is the design spec for Phase 2 of the `/students` dashboard
> rebuild, per the Roadmap in `docs/superpowers/plans/2026-09-30-students-dashboard-phase-1.md`.
> It is implemented against `main` as of PR #96 (Phase 1) and PR #97 (UI polish), both
> merged. The backend for everything this phase needs already exists — this is a
> dashboard-only phase.

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
  (permission-gated); download (via `core/files`' existing `:download` action).
- New `Services.guardians` domain; additions to `Services.students` for the nested
  emergency-contacts/documents/guardian-link calls; a small addition to `Services.files`
  for the download action (doesn't exist yet).
- Backend test gaps closed (no new backend *code* — these are tests only): a
  cross-tenant test for emergency contacts (none exists), `GET /student-guardians/{id}`
  and the guardians list (untested), `PATCH /guardians/{id}` (untested).
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
  guardian" reuses the same `Select`-populated-from-a-debounced-query composition
  Phase 1's Campus/House pickers use. A real combobox is its own `packages/ui` addition
  (`schoolhub-ui-port`), out of scope here.
- Guardian "change-request" flow from the parent portal (§6) — portal-side, not this
  phase's dashboard-admin surface.

## 3. Architecture

### 3.1 Tabbed detail sheet

`StudentDetailSheet` (`apps/dashboard/src/features/students/student-detail-sheet.tsx`)
gains a `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` wrapper (`packages/ui`, already
ported, unused anywhere in this app yet — this is its first real consumer). The
existing Profile/Academic/Medical `FieldSection`s move under a `Profile` tab,
unchanged. Three new `TabsContent` panels render the three new feature components.

**Lazy per-tab data loading:** each tab's own `useQuery` is `enabled: isOpen &&
activeTab === "guardians"` (etc.) — a viewer who only ever opens Profile never fires
the other three tabs' requests. This mirrors the existing `enabled: mode === "edit" &&
open` gating pattern already used by the edit-form's detail query (Phase 1), extended
to one `enabled` check per tab.

**Mobile:** the existing `ResponsiveSheet`/`useIsDrawer()` split is unaffected — `Tabs`
renders identically in both the `Sheet` and `Drawer` branches. On narrow viewports the
`TabsList` scrolls horizontally rather than wrapping (four short labels fit in practice,
but this is the correct baseline behavior regardless).

### 3.2 Services layer (ADR-0011)

- **`Services.guardians`** (new domain) — the `Guardian` person resource and its link to
  a student: `searchGuardians(query)` (`GET /guardians?search=`), `createGuardian(input)`
  (`POST /guardians`), `updateGuardian(id, input)` (`PATCH /guardians/{id}`),
  `linkGuardianToStudent(studentId, input)` (`POST /students/{id}/guardians`),
  `updateGuardianLink(linkId, input)` (`PATCH /student-guardians/{id}`),
  `fetchGuardianLinks(studentId)` (`GET /students/{id}/guardians`).
- **`Services.students`** — additions for the two remaining nested relations, which have
  no identity or reuse outside a single student's detail view (unlike guardians, which
  are genuinely shared across siblings and searched tenant-wide):
  `fetchEmergencyContacts(studentId)`, `addEmergencyContact(studentId, input)`,
  `fetchDocuments(studentId)`, `uploadDocumentRecord(studentId, input)` (the metadata
  POST after the file itself is already uploaded via `Services.files.uploadFile`),
  `deleteDocument(documentId)`, `verifyDocument(documentId, decision)`.
- **`Services.files`** — add `getDownloadUrl(fileId)` wrapping `POST
  /files/{id}:download`, returning the `download_url` string. Confirmed against
  `apps/api/core/files/views.py`/`urls.py` directly: a colon-action, not a nested path.

Query keys follow the existing `queryKeys` factory: `queryKeys.list("students",
"guardian-links", studentId)`, `.list("students", "emergency-contacts", studentId)`,
`.list("students", "documents", studentId)`, `.list("guardians", "search", query)`. A
link/add/upload/verify/delete mutation invalidates the matching list key.

### 3.3 Component responsibilities

| Component | Responsibility |
| --- | --- |
| `StudentGuardiansTab` | Lists linked guardians + flags; "Add guardian" opens the chooser (search vs. create). |
| `GuardianPickerDialog` | Search-existing (debounced `Select`) **or** switch to create-new inline; ends in `linkGuardianToStudent`. |
| `GuardianFormDialog` | Create/edit a guardian's own fields, including the photo (same upload pattern as `StudentPhotoField`, purpose `guardian.photo`). Shared by "create new" and "edit this guardian." |
| `GuardianLinkFlagsDialog` | Edit one link's `relationship`/`is_primary`/`is_fee_responsible`/`can_pick_up`/`receives_communications` — a small form, `PATCH /student-guardians/{id}`. |
| `StudentEmergencyContactsTab` | Ordered list (read-only rows) + one add form. No per-row actions. |
| `StudentDocumentsTab` | List with per-row Verify/Reject, Download, Delete (each permission-gated); "Upload document" opens the upload dialog. |
| `DocumentUploadDialog` | File picker + `document_type` `Select` (6 seeded defaults) + title + optional notes/expiry; drives `Services.files.uploadFile` then `uploadDocumentRecord`. |

### 3.4 Permissions (module doc §4, already registered — no new keys)

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

Every action button is gated with `hasPermission(currentUser, key)`, same as Phase 1 —
UI hiding, never enforcement; the server is the real gate.

## 4. Data flow — worked examples

**Link an existing guardian.** User opens Guardians tab → clicks "Add guardian" →
"Search existing" → types "Khan" → debounced `searchGuardians("Khan")` populates a
`Select` → user picks one → relationship + flags form appears → submit calls
`linkGuardianToStudent(studentId, {guardianId, relationship, isPrimary, ...})` →
invalidate the guardian-links list key → tab re-renders with the new row.

**Create and link a new guardian.** Same entry point → "Create new" → `GuardianFormDialog`
(first/last name, phone, email, optional photo, etc.) → on submit, `createGuardian`
returns the new guardian's id → immediately `linkGuardianToStudent` with that id and the
relationship/flags collected in the same dialog (a two-step flow presented as one form,
matching how Phase 1's `StudentFormDialog` already composes a multi-field save into one
submit) → same invalidation.

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

- **Duplicate/conflicting guardian search:** no special handling needed — `searchGuardians`
  is read-only; an empty result just shows "No guardians found" (i18n'd), with "Create
  new" still available from the same dialog.
- **Linking a guardian already linked to this student:** the backend's `link_guardian`
  service — confirmed by reading `apps/api/apps/student_management/services.py` — does
  not already special-case this; if it allows a duplicate link or raises a constraint
  violation, the dashboard surfaces whatever `error.fieldErrors()`/`non_field` message
  comes back via `resolveErrorMessage`, per the existing Phase 1 convention. The plan
  phase verifies the exact backend behavior here (a one-line check) rather than this
  spec guessing at it.
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

## 6. Testing strategy

- **Backend (Django):** close the three named gaps — a cross-tenant test for
  `EmergencyContactLinkViewSet` (none exists today), a test for `GET
  /student-guardians/{id}` and the guardians list (untested), a test for `PATCH
  /guardians/{id}` (untested). These are additive test files/cases against
  already-shipped, already-correct endpoints — not new production code.
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
  (`schoolhub-ui-port`), not warranted by this phase alone when the existing
  composition already works (Phase 1's Campus/House pickers).
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

None blocking. Two decisions were made explicitly during brainstorming rather than left
open: guardians get a photo-upload field in this phase (reusing the `StudentPhotoField`
pattern), and the document-type picker is a `Select` over the 6 seeded defaults (not a
free-text field) — a tenant-extended type is reachable only via `other` + notes this
phase, which is an acceptable gap given no endpoint currently lists a tenant's
extensions (`apps/dashboard/AGENTS.md`'s ADR-0017 convention doesn't apply here, since
there's no generated source for this list either way).
