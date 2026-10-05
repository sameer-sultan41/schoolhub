# Students Dashboard — Phase 2: Guardians, Emergency Contacts & Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Guardians, Emergency Contacts and Documents to `/students`' detail view — a tabbed `StudentDetailSheet` (Profile/Guardians/Emergency Contacts/Documents) backed entirely by backend endpoints that already exist.

**Architecture:** Each relation gets its own small feature component (tab) reading/writing through a new `Services.guardians` domain plus additions to the existing `Services.students` module. Mostly a dashboard-only phase — closing four named backend test gaps along the way — plus four small, deliberate backend additions surfaced across three rounds of independent plan review: `GuardianSerializer.photo_url`; `principal` gaining `students.document.view` in the registry (reaches dev/e2e-seeded tenants only — see Global Constraints and `docs/deferred-work.md` for why no production backfill exists); a `Content-Disposition: attachment` header on `core/files`' signed download URLs; and a `students.document.view`-gated `:download` action on `StudentDocumentViewSet`. **User decision (2026-10-06):** this new action is the dashboard's own, properly-gated download path — it does not close the pre-existing, broader exposure that `core/files`' generic `GET /files` (list) and `POST /files/{id}:download` still grant to any caller holding `platform.file.view` (every staff role), which can still list and download a student's document directly. That generic exposure predates this plan, is cross-cutting `core/files` infrastructure shared by every module (e.g. `/staff`'s export download), and is out of scope here — ship the narrower fix and record the remaining gap honestly (Task 1 Step 17, Task 12) rather than expanding this PR into a `core/files` authorization redesign.

**Tech Stack:** Next.js 16, TanStack Query v5, react-hook-form + zod, `@schoolhub/ui` (`Tabs`, first real consumer in this app), Django 6.1 + DRF (mostly tests; Task 1 carries the four small production changes above).

**Spec:** `docs/superpowers/specs/2026-10-03-students-phase2-relations-design.md`

**Work tier:** 2

## Global Constraints

- **Four small backend additions, otherwise no new backend production code.** Task 1 adds `GuardianSerializer.photo_url`; `principal` to `students.document.view`'s allowed roles in the registry (this alone only reaches a `principal` role created *after* the change — `seed_all_roles`/`seed_e2e_data`, dev/e2e only; there is no production mechanism anywhere in this codebase that provisions a default role, other than `school_owner`, for an already-live tenant, so no migration can "backfill" a role that nothing ever creates — this is a pre-existing, platform-wide `core.rbac`/`core.tenancy` gap, recorded in `docs/deferred-work.md`, not something this phase fixes); a `Content-Disposition: attachment` header on `core/files`' signed download URLs, applied to every presigner implementation so every `:download` caller keeps working; and a new `students.document.view`-gated `:download` action on `StudentDocumentViewSet` — the dashboard's own path now requires the specific permission, not just `platform.file.view`, though the generic `core/files` `GET /files`/`:download` endpoints remain open platform-wide to any `platform.file.view` holder regardless (pre-existing, cross-cutting, out of scope — **user decision, 2026-10-06** — see the Architecture note above and Task 1 Step 17) — each proven by a test first. Every other endpoint this phase calls already exists and is wired (`GuardianViewSet`, `StudentGuardianViewSet`, `StudentGuardianLinkViewSet`, `EmergencyContactLinkViewSet`, `StudentDocumentLinkViewSet`, `StudentDocumentViewSet`) — the rest of the backend work in this plan is test-only.
- **No unlink, no emergency-contact edit/delete.** The backend has no endpoints for any of these (`StudentGuardianLinkViewSet` and `EmergencyContactLinkViewSet` are both list+create only). No task invents a workaround; the UI states this plainly where relevant and `docs/deferred-work.md` records it.
- **`StudentGuardian.relationship` is a fixed 6-value enum** (`Relationship` in `apps/api/apps/student_management/models.py`: `father`, `mother`, `grandparent`, `sibling`, `legal_guardian`, `other`) — a `<Select>`, not free text. **`EmergencyContact.relationship` is free text** (`models.CharField(max_length=50)`, no choices) — a plain `<Input>`. These are different fields on different models; do not conflate them. The enum's values live in `packages/types` (alongside the existing `GENDER_VALUES`), not copy-pasted into each component that needs them.
- **The guardian-link list has no embedded guardian name/phone.** `StudentGuardianSerializer` (`GET /students/{id}/guardians`) returns only `guardian_id` plus link fields — never the guardian's own name/phone. `StudentGuardiansTab` resolves each link's guardian via a `useQueries` fan-out over `Services.guardians.fetchGuardianById` — through `Services`, never a direct `apiClient`/`endpoints` import inside the tab component (ADR-0011). This is a real, confirmed API shape, not an oversight to design around; an embedded backend summary field was considered and rejected (see Alternatives Considered, and ADR-0020) to keep this phase's backend surface to the three additions above.
- **Reuse the existing i18n scaffolding.** `apps/dashboard/messages/en.json`/`ur.json` already carry `students.tabs`, `students.guardians`, `students.emergencyContacts`, `students.documents` namespaces (committed on `main`, dating from pre-dashboard-shell-reset work — confirmed real, fully translated in both locales) with the right `Relationship`/`DEFAULT_DOCUMENT_TYPES` values already baked in. Task 4 audits and reuses these; it does not invent a parallel set of keys. Fixes needed: `guardians.close` duplicates `common.close` (Phase 1's established convention is to reuse `common.*` for generic verbs, never a per-screen near-duplicate) — delete `guardians.close` from both locales and use `tCommon("close")` at its one call site; and the existing `guardians.empty` ("No guardians linked yet.") is the Guardians *tab's* empty state, not the *picker's* zero-search-results state — those need their own new key (Task 4 adds it), never conflated.
- **`GuardianFormDialog`'s field scope is deliberately minimal:** `first_name`, `last_name`, `phone` (required), `alt_phone`, `email` (optional), plus a photo (purpose `guardian.photo`, via the shared `PhotoUploadField` extracted in Task 5 — see Alternatives Considered). `occupation`, `employer`, `national_id`, `address`, `custom_fields`, `user_id` are real `Guardian` fields but out of scope this phase (YAGNI — nothing in the module doc or this phase's spec calls them out as priorities; all are nullable server-side, so omitting them client-side is safe).
- **Link defaults match `link_guardian`'s own service defaults exactly:** `is_primary: false`, `is_fee_responsible: false`, `can_pick_up: true`, `receives_communications: true`, `has_portal_access: true`. A form that defaults differently from the service it calls is a latent bug the first time a user doesn't touch every checkbox.
- **"Make primary" is a one-click row action, never a dialog.** Promoting a link doesn't need relationship/other-flags context — it's `updateGuardianLink(linkId, { isPrimary: true })` on click, shown only on a non-primary row. Editing the other four flags plus relationship is a separate `GuardianLinkFlagsDialog`, which never includes `is_primary` (demoting without picking a replacement primary is a confusing half-action the backend doesn't even support as a direct operation — `_demote_primary_guardian` only ever runs as a side effect of promoting someone else).
- **A document's download link is fetched fresh per click, never cached.** `Services.students.getDocumentDownloadUrl` (Task 3's own new function, wrapping Task 1's `students.document.view`-gated `POST /student-documents/{id}:download`) always requests a fresh URL; the resulting URL drives a programmatically-created, immediately-clicked `<a download>` element (the same pattern `/staff`'s export download already uses), never `window.open` — a browser only allows `window.open` to succeed within a short window of direct user interaction, and the request in between is enough to lose that window on a slow connection. The URL itself is never stored in component state or React Query's cache — a signed URL has a server-side TTL and caching it would eventually hand out an expired link. `core/files`' own `Content-Disposition: attachment` header (Task 1) forces the actual save-as behavior regardless of file type; the anchor's `download` attribute is a same-origin filename hint on top of that, not load-bearing on its own.
- **Every new permission-gated control uses `hasPermission(currentUser, key)` directly** (Phase 1's established pattern) — no `<Can>` wrapper component exists in the current app and this plan does not add one. Each new tab itself is gated the same way, on its own view key — not merely "can view this student."
- **Lazy per-tab data loading needs no extra state, and no `enabled` option.** `packages/ui`'s `Tabs` wraps Radix `Tabs`, which unmounts an inactive `TabsContent` panel by default (no task sets `forceMount`) — so a tab component's own `useQuery` never even runs until Radix actually mounts that tab's panel; there is nothing left for an `enabled` flag to gate. No `activeTab` state or `activeTab === "<tab>"` gating is added anywhere in this plan either.
- **Every tab shows a real load-error state, distinct from its empty-list state.** A failed `useQuery` renders a retry-capable error message, not the tab's "no records yet" copy — and the error must visibly clear once a retry succeeds, not linger.
- **Mutations don't fail silently.** Make-primary, verify/reject, delete, download and add-contact all show `resolveErrorMessage(error, tErrors, <fallback>)` via toast on failure, matching `/staff`'s existing mutation error-handling pattern — not a swallowed rejection.
- **Colors/RTL/imports:** `--sh-*` tokens only, logical CSS properties only, `@/` alias only, `@schoolhub/api-client` only inside `src/services/**`/`src/lib/**` (ADR-0011).
- **New files cannot add an ESLint `max-lines` suppression**, and this plan adds no new `eslint-disable` anywhere — the baseline is shrink-only (ADR-0014).
- **Tests:** sibling `__tests__/` folders. Coverage floor is 85% global and only ever rises.
- **Never run tests, linters or typechecks locally.** Commit, push, watch `gh pr checks <n> --watch`.

## Alternatives considered (why not)

- **Per-guardian `fetchGuardianById` fan-out vs. an embedded guardian summary on `StudentGuardianSerializer`.** Chosen: the fan-out, through `Services.guardians`, per [ADR-0020](../../decisions/0020-client-fan-out-for-unembedded-nested-ids.md) (added this round specifically for this decision). An embedded summary would save N requests per student's guardian list, but it is a backend change beyond the three Task 1 already makes, for a phase independent review already pushed toward "dashboard-first, minimal backend surface." A tenant's guardians-per-student count is small (a handful of rows, not pages), so the N+1 cost is bounded and real; the fan-out goes through `Services` properly either way, so upgrading to an embedded summary later is a pure backend+client change with no tab-component rewrite. `GuardianViewSet.get_queryset` still gets `.select_related("photo_file")` (Task 1) so each resolved guardian's own photo lookup isn't itself an N+1.
- **A shared `PhotoUploadField` vs. a third standalone copy for guardians.** Chosen: extract a shared component (Task 5), used by both the student and guardian forms. Students and staff already each have their own copy of the same presigned-upload-then-preview flow; guardians would be the third, and this repo's own convention is to extract on the third copy rather than wait for a fourth. Staff's route lives outside `features/students/`, so migrating it too is out of scope for this PR — flagged in `docs/deferred-work.md` (Task 12) rather than silently left as a third uncounted copy.
- **Select-populated-by-debounced-search vs. a real `Combobox` primitive for "search existing guardian."** Chosen: keep the `Select` + `useDebouncedValue` composition (same hook the student directory's own filter already uses). The spec's own Alternatives section settled this: a proper typeahead-with-keyboard-nav primitive is a `packages/ui` addition (`schoolhub-ui-port`) big enough to be its own piece of work, not warranted by this one dialog.
- **`key`-based remount vs. a `useEffect` reset for the tabbed sheet's active tab.** Chosen: `<Tabs defaultValue="profile" key={row.id}>`, matching React's own documented pattern for "reset all state when a prop changes" (react.dev). A `useEffect` that resets state on `row` changing would need an `eslint-disable` for `react-hooks/set-state-in-effect` (a new one this plan deliberately adds none of) and runs a render later than the `key` approach for no benefit, since the component actually does need to reset, not merely re-sync one field.
- **One `GuardianPickerDialog` with two internal steps vs. nesting `GuardianFormDialog` inside it for "create new."** Chosen: one dialog, two steps (Task 6). `ResponsiveDialog` wraps a Radix `Dialog` on desktop and a `vaul` `Drawer` on mobile; nesting a second `ResponsiveDialog` inside this one would need `Drawer.NestedRoot` on the mobile branch, which `packages/ui` doesn't expose. The create-fields form is inlined into the picker's own "create new" tab instead (reusing `guardians.schema.ts`'s exported `guardianFormSchema`/`GuardianFormValues`, Task 2 — not `GuardianFormDialog`'s whole dialog component), and a successful create advances the same dialog to its "link" step — the same step a search-selection also lands on.

## Review Focus

1. **A guardian search with zero results.** The picker must show a dedicated "no matches" message (i18n'd, distinct from the Guardians tab's own "No guardians linked yet." empty state) with "Create new" still reachable from the same dialog — not a blank box that looks broken. Pinned in Task 6.
2. **Linking a guardian already linked to this student.** `StudentGuardian`'s real `UniqueConstraint` (`apps/api/apps/student_management/models.py`) turns a duplicate into an `IntegrityError`, which `core/api/exceptions.py` maps to a real `409 conflict` ("The request conflicts with existing data.") — proven by Task 1's new `test_linking_an_already_linked_guardian_returns_409`. The picker excludes already-linked guardians from its search results as the primary defense; the UI must still surface a real 409 via `resolveErrorMessage(..., "non_field")` as a backstop, not swallow it or invent a different status code. Pinned in Task 6.
3. **An emergency contact or document action, or an entire tab, rendered for a caller without the permission.** Each gated button — and each tab itself — must be genuinely absent (not merely disabled) for a caller lacking its key, matching Phase 1's `canUpdate`/`canWithdraw` precedent. Pinned in Tasks 7, 8, 9, 10.
4. **A document upload that fails at the PUT-to-storage step vs. the create/confirm step.** `Services.files.uploadFile`'s `FileUploadError` already carries a step-specific message (Phase 1's `StudentPhotoField` precedent) — `DocumentUploadDialog` must surface that real message, not a generic "upload failed." Pinned in Task 9.
5. **A tab's query fails, or is switched away from and back while mid-fetch.** A failed query must show a load-error state that clears on a successful retry — never mistakable for the tab's own empty-list state. Switching tabs away and back must not leave a stale error or loading state from an interrupted first fetch — TanStack Query's own `enabled`/remount semantics already handle this correctly, but the test suite proves it rather than assuming it. Pinned in Task 10.

## File Structure

```
apps/api/apps/student_management/serializers.py          # MODIFY — GuardianSerializer.photo_url (Task 1)
apps/api/apps/student_management/permissions.py           # MODIFY — principal + students.document.view (Task 1)
apps/api/apps/student_management/views.py                  # MODIFY — GuardianViewSet select_related("photo_file"); StudentDocumentViewSet.download (Task 1)
apps/api/apps/student_management/urls.py                   # MODIFY — wire the new :download route (Task 1)
apps/api/apps/student_management/tests/test_guardians_documents.py   # MODIFY — new tests (Task 1)
apps/api/apps/student_management/tests/base.py              # (read, not modified — confirms `allow()`'s real scope)
apps/api/core/files/storage.py                              # MODIFY — content_disposition on Presigner/NullPresigner/S3Presigner (Task 1)
apps/api/core/files/services.py                             # MODIFY — get_download_url passes Content-Disposition (Task 1)
apps/api/core/files/tests/test_storage.py                   # MODIFY — new tests (Task 1)
apps/api/openapi.yaml                                      # MODIFY — regenerated (Task 1)
packages/api-client/src/schema.d.ts                         # MODIFY — regenerated (Task 1)
docs/deferred-work.md                                       # MODIFY — production role-provisioning gap; remove the now-closed Content-Disposition entry (Task 1)
docs/decisions/0020-client-fan-out-for-unembedded-nested-ids.md  # CREATE (Task 2)
docs/decisions/README.md                                     # MODIFY — index row for ADR-0020 (Task 2)

packages/types/src/student.ts              # MODIFY — add RELATIONSHIP_VALUES alongside GENDER_VALUES (Task 2)

apps/dashboard/src/services/modules/guardians/     # five-file shape from creation (ADR-0019)
  guardians-service.ts                     # CREATE (Task 2)
  guardians-type.ts                        # CREATE (Task 2)
  guardians-constant.ts                    # CREATE (Task 2)
  guardians-helper.ts                      # CREATE (Task 2)
  guardians.schema.ts                      # CREATE (Task 2)
  index.ts                                 # CREATE (Task 2)
  __tests__/guardians-service.test.ts      # CREATE (Task 2)
  __tests__/guardians-helper.test.ts       # CREATE (Task 2)

apps/dashboard/src/lib/error-message.ts            # MODIFY — add applyServerFieldErrors (Task 5)
apps/dashboard/src/lib/__tests__/error-message.test.ts  # MODIFY — new test case (Task 5)

apps/dashboard/src/services/modules/students/
  students-service.ts                      # MODIFY — add emergency-contact + document functions (Task 3)
  students-type.ts                         # MODIFY — add their input/record types (Task 3)
  students-constant.ts                     # MODIFY — add DOCUMENT_TYPES (Task 3)
  index.ts                                 # MODIFY — re-export the new functions (Task 3)
  __tests__/students-service.test.ts       # MODIFY — new test cases (Task 3)

apps/dashboard/src/services/endpoints.ts   # MODIFY — guardians/student-guardians/emergency-contacts/documents paths, including studentDocuments.download (Task 2, 3).

apps/dashboard/messages/en.json, ur.json   # MODIFY — reuse + fix existing students.tabs/guardians/emergencyContacts/documents (Task 4)

apps/dashboard/src/components/
  photo-upload-field.tsx                   # CREATE — neutral location, generic `purpose: string` prop; shared by student + guardian forms (extracted from student-photo-field.tsx, its third near-identical copy counting staff's own inline one) (Task 5)
  __tests__/photo-upload-field.test.tsx    # CREATE (Task 5)

apps/dashboard/src/features/students/
  student-photo-field.tsx                  # MODIFY — becomes a thin wrapper around @/components/photo-upload-field.tsx (Task 5)
  __tests__/student-photo-field.test.tsx   # MODIFY — still covers the student-specific wrapper (Task 5)
  guardian-form-dialog.tsx                 # CREATE (Task 5)
  __tests__/guardian-form-dialog.test.tsx  # CREATE (Task 5)
  guardian-picker-dialog.tsx               # CREATE (Task 6)
  __tests__/guardian-picker-dialog.test.tsx # CREATE (Task 6)
  student-guardians-tab.tsx                # CREATE (Task 7)
  guardian-link-flags-dialog.tsx           # CREATE (Task 7)
  __tests__/student-guardians-tab.test.tsx # CREATE (Task 7)
  __tests__/guardian-link-flags-dialog.test.tsx # CREATE (Task 7)
  student-emergency-contacts-tab.tsx       # CREATE (Task 8)
  __tests__/student-emergency-contacts-tab.test.tsx  # CREATE (Task 8)
  student-documents-tab.tsx                # CREATE (Task 9)
  document-upload-dialog.tsx               # CREATE (Task 9)
  __tests__/student-documents-tab.test.tsx # CREATE (Task 9)
  __tests__/document-upload-dialog.test.tsx # CREATE (Task 9)
  student-detail-sheet.tsx                 # MODIFY — Tabs shell (Task 10)
  __tests__/student-detail-sheet.test.tsx  # MODIFY (Task 10)

e2e/src/mocks/domains/guardians.ts         # CREATE (Task 11)
e2e/src/mocks/domains/student-relations.ts # CREATE — emergency contacts + documents (Task 11)
e2e/src/mocks/domains/files.ts             # CREATE — upload create/:confirm + storage PUT route (Task 11)
e2e/src/mocks/index.ts                     # MODIFY (Task 11)
e2e/tests/dashboard/students-relations.spec.ts  # CREATE (Task 11)

docs/03-modules/student-management.md      # MODIFY — §4 permission row (Task 1), §20 update (Task 12)
docs/project-status.md                     # MODIFY (Task 12)
docs/deferred-work.md                      # MODIFY — unlink/edit/delete gaps, staff's un-migrated photo-field copy (Task 12)
```

---

## Task 1: Backend — guardian `photo_url`, principal document-view, a gated document `:download`, download Content-Disposition, and the test gaps

**Files:**
- Modify: `apps/api/apps/student_management/serializers.py`
- Modify: `apps/api/apps/student_management/permissions.py`
- Modify: `apps/api/apps/student_management/views.py`
- Modify: `apps/api/apps/student_management/urls.py`
- Modify: `apps/api/apps/student_management/tests/test_guardians_documents.py`
- Modify: `apps/api/core/files/storage.py`
- Modify: `apps/api/core/files/services.py`
- Modify: `apps/api/core/files/tests/test_storage.py`
- Modify: `apps/api/openapi.yaml` (regenerated, not hand-edited)
- Modify: `packages/api-client/src/schema.d.ts` (regenerated, not hand-edited)
- Modify: `docs/03-modules/student-management.md` (§4 permissions table, §16 endpoint list)
- Modify: `docs/deferred-work.md` (the production role-provisioning gap — see Step 7)

**Interfaces:**
- Consumes: nothing new.
- Produces: `GuardianRecord.photo_url` (via the regenerated `ApiSchemas["Guardian"]`, flowing into Task 2's `guardians-type.ts` with no manual edit there), `principal` holding `students.document.view` in the registry (which Task 10's permission-gating step depends on — reaches dev/e2e-seeded tenants only, see Step 7), a new `students.document.view`-gated `POST /student-documents/{id}:download` action (which Task 3's `getDocumentDownloadUrl` and Task 9's download step depend on), and `core/files`' `:download` action now returning a URL with `Content-Disposition: attachment` baked in on every presigner (which the new document `:download` action, and `/staff`'s existing export download, both benefit from). Otherwise backend-only, independent of every other frontend task.

This task carries the four small backend changes independent plan review (ADR-0015) found necessary across three review rounds — everything else in this plan stays dashboard-only. Each is narrow, mirrors an existing pattern exactly, and is proven by a test before being written (TDD), same as every other task in this plan.

**User decision (2026-10-06):** dropping the backfill migration (first proposed, then investigated, in round 3 of independent plan review) was an explicit, informed choice, not a silent reversal — the user was told plainly that no production code provisions any default role but `school_owner` for a real tenant, and chose to drop the migration and document the real gap rather than expand this PR into building a tenant role-provisioning system. See the full investigation below.

**On `core.rbac.sync`, and why there is no backfill migration:** `core.rbac.sync.sync_permissions_on_migrate` (the `post_migrate` hook) only upserts rows in the `Permission` table from `registry.all()` — key, module, resource, action, description. It never touches `RolePermission` (confirmed by reading `apps/api/core/rbac/sync.py` in full) and has nothing to do with which roles a permission's `default_roles` names. The only place `default_roles` is read at all is `seed_all_roles`'s `_seed_role_logins` and `seed_e2e_data`'s equivalent, both of which build a role from scratch via `ensure_role_with_permissions` — so adding `"principal"` to `students.document.view`'s `default_roles` in code only changes what a *freshly created* `principal` `Role` row holds, in a dev/e2e-seeded tenant. A migration backfilling "existing tenants' `principal` role" was considered and rejected: reading `apps/api/core/rbac/seeding.py` and `apps/api/apps/staff_management/staff/services/invite.py` in full shows there is **no production code anywhere that creates a platform-default (`tenant=None`) `Role` row for any role except `school_owner`** (via `ensure_school_owner_role`) — not `principal`, not `teacher`, not `school_admin`. The invite flow is written to let an admin assign a `tenant=None` default role, but nothing ever creates one for a real tenant. A migration that filtered for tenant-scoped `principal` rows would only ever touch dev/e2e seed fixtures, giving false confidence that production tenants are covered when none are. This is a pre-existing, platform-wide gap in `core.rbac`/`core.tenancy` (no tenant-provisioning system exists yet for any default role but `school_owner`) — out of scope for this phase. Step 7 records it precisely in `docs/deferred-work.md` instead of papering over it with a migration that cannot do what its name claims.

- [ ] **Step 1: Write the failing test for `GuardianSerializer.photo_url`**

Add to `GuardianPhotoFileTests` (already exists in `test_guardians_documents.py` — confirmed by reading it; mirrors `StudentSerializer`'s own `test_a_photo_file_whose_purpose_is_not_student_photo_signs_no_url`, which this test is modeled on exactly):

```python
    def test_photo_url_is_none_when_the_attached_files_purpose_is_not_guardian_photo(
        self,
    ) -> None:
        self.allow("students.guardian.view")
        with tenant_context(self.tenant.id):
            mismatched_file = FileFactory(
                tenant=self.tenant, purpose="student.photo", status=FileStatus.READY
            )
            guardian = GuardianFactory(tenant=self.tenant)
            guardian.photo_file = mismatched_file
            guardian.save(update_fields=["photo_file"])

        response = self.client.get(f"/api/v1/guardians/{guardian.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.json()["data"]["photo_url"])

    def test_photo_url_signs_a_real_link_when_the_purpose_matches(self) -> None:
        self.allow("students.guardian.view")
        with tenant_context(self.tenant.id):
            photo = FileFactory(
                tenant=self.tenant, purpose="guardian.photo", status=FileStatus.READY
            )
            guardian = GuardianFactory(tenant=self.tenant)
            guardian.photo_file = photo
            guardian.save(update_fields=["photo_file"])

        response = self.client.get(f"/api/v1/guardians/{guardian.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNotNone(response.json()["data"]["photo_url"])

    def test_patching_a_guardian_with_their_own_unchanged_mismatched_photo_succeeds(
        self,
    ) -> None:
        """Pins Step 3's `validate_photo_file_id` skip: re-sending the guardian's own

        current `photo_file_id` unchanged must succeed even when that file's purpose
        predates this check — without the skip, every edit to a guardian whose photo
        was uploaded before the purpose check existed would fail outright.
        """
        self.allow("students.guardian.view", "students.guardian.update")
        with tenant_context(self.tenant.id):
            mismatched_file = FileFactory(
                tenant=self.tenant, purpose="student.photo", status=FileStatus.READY
            )
            guardian = GuardianFactory(tenant=self.tenant, phone="0300-0000000")
            guardian.photo_file = mismatched_file
            guardian.save(update_fields=["photo_file"])

        response = self.client.patch(
            f"/api/v1/guardians/{guardian.pk}",
            {"phone": "0300-1111111", "photo_file_id": str(mismatched_file.pk)},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["phone"], "0300-1111111")
```

- [ ] **Step 2: Confirm all three tests fail**

`photo_url` doesn't exist on `GuardianSerializer` yet, so the first two requests 500 or the key is simply absent from the response — either way, neither assertion passes yet. The third (`test_patching_a_guardian_with_their_own_unchanged_mismatched_photo_succeeds`) fails for a different reason: `validate_photo_file_id` has no unchanged-photo skip yet, so re-sending the guardian's own current `photo_file_id` still re-runs `assert_file_usable`, which rejects it for the mismatched purpose and the PATCH 422s instead of succeeding.

- [ ] **Step 3: Add `photo_url` to `GuardianSerializer`, and stop re-validating an unchanged photo**

In `apps/api/apps/student_management/serializers.py`, mirror `StudentSerializer.get_photo_url` (already in this file, lines ~125-134) exactly, gated on `uploads.GUARDIAN_PHOTO.key` instead of `uploads.STUDENT_PHOTO.key`. Also fix `validate_photo_file_id` to skip the purpose check when the photo isn't actually changing — `StudentSerializer.validate_photo_file_id` already does this (`value.pk != getattr(self.instance, "photo_file_id", None)`); `GuardianSerializer`'s never did, which means an edit that re-sends a guardian's own current `photo_file_id` unchanged gets re-validated every time and fails outright for any guardian whose photo predates this purpose check:

```python
class GuardianSerializer(serializers.ModelSerializer):
    photo_file_id = _fk(File, source="photo_file", required=False, allow_null=True)
    # Same purpose-gated pattern as StudentSerializer.photo_url — see that field's own
    # comment for why this isn't a plain SignedFileURLField.
    photo_url = serializers.SerializerMethodField()

    class Meta:
        model = Guardian
        fields = (
            "id",
            "user_id",
            "first_name",
            "last_name",
            "phone",
            "alt_phone",
            "email",
            "occupation",
            "employer",
            "national_id",
            "photo_file_id",
            "photo_url",
            "address",
            "custom_fields",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_photo_file_id(self, value: File | None) -> File | None:
        # Mirrors Student.photo_file/StudentDocument.file: a resolved File still
        # needs its purpose and upload-confirmed status checked — the tenant-scoped
        # `_fk()` field only proves the id exists and belongs to this tenant. The
        # current photo passes unchecked (same as StudentSerializer): an edit that
        # re-sends it unchanged must not be blocked by a purpose check that only
        # matters for a *new* file.
        if value is not None and value.pk != getattr(self.instance, "photo_file_id", None):
            services.assert_file_usable(file=value, purpose=uploads.GUARDIAN_PHOTO.key)
        return value

    @extend_schema_field({"type": "string", "format": "uri", "nullable": True})
    def get_photo_url(self, instance: Guardian) -> str | None:
        photo = instance.photo_file
        if photo is None or photo.purpose != uploads.GUARDIAN_PHOTO.key:
            return None
        return get_display_url(photo)
```

- [ ] **Step 3b: Fix the N+1 on guardian search — `select_related("photo_file")`**

`GuardianViewSet`'s existing `get_queryset` (`apps/api/apps/student_management/views.py`) calls `super().get_queryset().distinct()` with no `select_related` — unlike `StudentViewSet`, which already does this for its own `photo_file` lookup. Without it, `get_photo_url` (just added) triggers one extra query per guardian in a list response. Add `.select_related("photo_file")` into the existing chain:

```python
    def get_queryset(self):
        return super().get_queryset().select_related("photo_file").distinct()
```

(`apps/api/apps/student_management/guardians/viewset.py` holds a second, unrouted `GuardianViewSet` — part of the half-finished ADR-0010 per-resource package split. The module doc (`docs/03-modules/student-management.md` §20) states plainly that this package "exists but is not wired into `urls.py` — a separate, backend-only follow-up"; this task does not touch it, matching that documented status rather than half-maintaining dead code.)

- [ ] **Step 4: Confirm all three new tests pass**

- [ ] **Step 5: Write the failing test proving `principal` is a default role for `students.document.view`**

`self.allow(...)` (`StudentManagementAPITestCase.allow`, `apps/api/apps/student_management/tests/base.py`) calls `grant(self.user, *keys)`, which builds a one-off `Role` holding exactly those keys and assigns it straight to the test user — it never reads `default_roles` and never creates a `Role` named `"principal"`. A test built on `self.allow("students.document.view")` would pass identically whether or not `"principal"` is even in `default_roles`, so it cannot prove this change. There is also no `allow_role` helper anywhere in this codebase — don't invent one. Test the registry directly instead, as a plain assertion with no API call, HTTP client, or database fixture at all:

```python
    def test_principal_is_a_default_role_for_document_view(self) -> None:
        from core.rbac.registry import registry

        spec = next(s for s in registry.for_module("students") if s.key == "students.document.view")
        self.assertIn("principal", spec.default_roles)
```

(Add this to `StudentDocumentTests` alongside its other tests — it needs none of that class's `setUp` fixtures, but keeping module-specific registry assertions beside that module's other permission-shaped tests matches how this file is already organized. The registry has no `get(key)` lookup — only `register`, `all()`, `keys()`, `for_module(module)` and `__contains__` — confirmed by reading `apps/api/core/rbac/registry.py` in full, so the spec is found by filtering `for_module("students")`.)

- [ ] **Step 6: Confirm it fails**

`"principal"` is not yet in `DOCUMENT_MANAGERS` or any tuple passed to `students.document.view`'s `registry.register(...)` call, so no spec found via `for_module("students")` has it in `default_roles` yet.

- [ ] **Step 7: Add `principal` to `students.document.view`'s allowed roles, and record the production-backfill gap**

In `apps/api/apps/student_management/permissions.py`:

```python
registry.register(
    "students.document.view",
    "View student documents.",
    (*DOCUMENT_MANAGERS, "principal"),
)
```

This is the only registry change — `.create`/`.delete` stay `DOCUMENT_MANAGERS`-only; `.verify` already includes `principal`. `core.rbac.sync.sync_permissions_on_migrate` (the `post_migrate` hook) upserts the `Permission` row's `module`/`resource`/`action`/`description` from this registry entry on the next `migrate` — but, as explained in this task's intro, it never touches `RolePermission`, so this step alone changes nothing for any `principal` role that already exists anywhere. `seed_all_roles`/`seed_e2e_data` (dev/e2e only) already pick up the new `default_roles` value automatically the next time either runs, since both derive their role list and permission set from the registry on every run — that is the only place this grant actually reaches a `principal` role today.

Add this entry to `docs/deferred-work.md` in the same step, stating the real, platform-wide gap precisely rather than inventing a migration that can't do what its name would claim:

```markdown
- **No production mechanism provisions a tenant's default roles.** `principal`'s new
  `students.document.view` grant (`apps/api/apps/student_management/permissions.py`,
  students Phase 2) reaches a `principal` role only when one is created via
  `seed_all_roles`/`seed_e2e_data` (dev/e2e tooling) — both derive the role's permission
  set from the registry's `default_roles` on every run. Reading `core/rbac/seeding.py`
  and `apps/staff_management/staff/services/invite.py` in full confirms there is no
  production code anywhere that creates a platform-default (`tenant=None`) `Role` row for
  any role except `school_owner` (`ensure_school_owner_role`) — not `principal`, not
  `teacher`, not `school_admin`. The staff invite flow is written to let an admin assign a
  `tenant=None` default role, but nothing ever creates one for a real tenant. A migration
  "backfilling existing tenants' `principal` role" was considered during this phase's plan
  review and rejected for exactly this reason — it would only ever touch dev/e2e seed
  fixtures, giving false confidence that production tenants are covered when none are.
  This is a pre-existing, platform-wide gap in `core.rbac`/`core.tenancy` — building a
  real tenant-provisioning system for default roles is its own spec and plan, not a
  one-permission backfill inside a dashboard-tabs PR.
```

- [ ] **Step 8: Confirm the new test passes**

- [ ] **Step 9: Write the failing tests for a `students.document.view`-gated document `:download` action**

Student documents currently have no download path of their own — the dashboard would otherwise have to call `core/files`' generic `/files/{id}:download`, gated only by `platform.file.view` (every staff role, `apps/api/core/files/permissions.py`'s `ALL_STAFF`), which is too broad for a specific student's documents. Add to `StudentDocumentTests` (same file, same class as Step 1's `_ready_file()` helper):

```python
    def test_downloading_a_document_returns_a_signed_url(self) -> None:
        self.allow("students.document.create", "students.document.view")
        file = self._ready_file()
        create_response = self.client.post(
            f"/api/v1/students/{self.student.pk}/documents",
            {"file_id": str(file.pk), "document_type": "birth_certificate", "title": "Birth cert"},
            format="json",
        )
        document_id = create_response.json()["data"]["id"]

        response = self.client.post(f"/api/v1/student-documents/{document_id}:download")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.json()["data"]["download_url"])

    def test_downloading_a_document_requires_students_document_view_not_platform_file_view(
        self,
    ) -> None:
        """Proves the new action's own gate, not the generic `core/files` one: holding

        `platform.file.view` (every staff role's broad file-list/download permission)
        must NOT be enough on its own to call this student-document-specific action —
        otherwise the whole point of adding a narrower `students.document.view` gate
        here would be undermined by a caller just using the generic permission instead.
        A second user is used rather than re-calling `self.allow(...)` on `self.user`,
        because `grant()` (`apps/school_organization/tests/factories.py`) creates a new
        `Role` and adds it alongside any existing ones — it is additive, not a
        replacement — so reusing `self.user` would leave it holding BOTH permissions
        and prove nothing.
        """
        self.allow("students.document.create", "students.document.view")
        file = self._ready_file()
        create_response = self.client.post(
            f"/api/v1/students/{self.student.pk}/documents",
            {"file_id": str(file.pk), "document_type": "birth_certificate", "title": "Birth cert"},
            format="json",
        )
        document_id = create_response.json()["data"]["id"]

        other_user = UserFactory(tenant=self.tenant)
        grant(other_user, "platform.file.view")
        authenticate(self.client, other_user)

        response = self.client.post(f"/api/v1/student-documents/{document_id}:download")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
```

(`UserFactory`, `grant` and `authenticate` are already imported at the top of `test_guardians_documents.py` from `apps.school_organization.tests.factories` — confirmed by reading the file's import block — so this test needs no new imports.)

Add to `CrossTenantGuardianDocumentTests` (alongside the existing `test_verifying_a_foreign_document_is_404`/`test_deleting_a_foreign_document_is_404`):

```python
    def test_downloading_a_foreign_document_is_404(self) -> None:
        response = self.client.post(
            f"/api/v1/student-documents/{self.foreign['document'].pk}:download"
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
```

- [ ] **Step 10: Confirm both fail**

Neither `StudentDocumentViewSet` nor the URL conf has a `download` action/route yet, so both requests 404 at the routing layer (not the permission layer) — `NoReverseMatch` if hit through Django's reverse resolution, or DRF's own 404 for an unmatched path when hit directly by path string, which is what the test client does here.

- [ ] **Step 11: Add the `:download` action to `StudentDocumentViewSet` and wire its URL**

In `apps/api/apps/student_management/views.py`, extend `StudentDocumentViewSet`:

```python
class StudentDocumentViewSet(
    TenantScopedViewSetMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Top-level access for `DELETE /student-documents/{id}`, and the

    `:verify`/`:download` colon-actions. §4 declares ``students.document.delete`` but §16
    names no endpoint for it — added here so the key is reachable; the module doc gets the
    corresponding update in this PR. `:download` is its own action rather than reusing
    `core/files`' generic `/files/{id}:download`, because that one is gated only by
    `platform.file.view` (every staff role) — too broad for one specific student's
    documents, which need `students.document.view`.
    """

    queryset = StudentDocument.objects
    serializer_class = StudentDocumentSerializer
    required_feature = "module.students"
    required_permission = "students.document.view"
    required_permission_map = {
        "destroy": "students.document.delete",
        "verify": "students.document.verify",
        # Explicit rather than left to the required_permission fallback — same reasoning
        # as FileViewSet.required_permission_map's own "download" entry.
        "download": "students.document.view",
    }
    scope_campus_field = "student__campus_id"

    @extend_schema(...)  # existing verify() stays exactly as it is — unchanged

    @extend_schema(
        summary="Get a signed download URL for a student document",
        request=None,
        responses={200: OpenApiResponse(description="{'download_url': str}")},
    )
    def download(self, request, pk=None) -> Response:
        from core.files.services import get_download_url

        document = self.get_object()
        return ActionResponse.ok({"download_url": get_download_url(document.file)})
```

(`ActionResponse` and `extend_schema`/`OpenApiResponse` are already imported at this file's top — reuse them, don't re-import. The local `from core.files.services import get_download_url` matches this file's own convention of local-importing cross-core helpers, e.g. `record_audit` throughout this same file, rather than a new top-level `core.files` import.)

In `apps/api/apps/student_management/urls.py`, add a route alongside the existing `:verify` one:

```python
    path(
        "student-documents/<uuid:pk>:download",
        StudentDocumentViewSet.as_view({"post": "download"}),
        name="student-documents-download",
    ),
```

- [ ] **Step 12: Confirm the new tests pass**

- [ ] **Step 13: Write the failing tests for the download Content-Disposition header**

In `apps/api/core/files/tests/test_storage.py`, alongside the existing `test_download_links_take_an_expiry_and_a_cache_control` — one test at the presigner level (proves the header reaches the signed URL), one at the `get_download_url` level (proves the real call site actually sets it, per round-3 review: a presigner-level test alone wouldn't have caught `get_download_url`/`NullPresigner`/the `Presigner` Protocol being left out of this change):

```python
    @override_settings(**STORAGE, S3_PUBLIC_ENDPOINT_URL="")
    def test_download_links_take_a_content_disposition(self):
        url = S3Presigner().presign_download(
            storage_key="tenants/t/report.pdf",
            content_disposition='attachment; filename="report.pdf"',
        )

        query = parse_qs(urlsplit(url).query)
        self.assertEqual(
            query.get("response-content-disposition"), ['attachment; filename="report.pdf"']
        )
```

Add a new test class in the same file (needs `File` and `get_download_url`, not imported there yet):

```python
from core.files.models import File
from core.files.services import get_download_url


class GetDownloadUrlTests(SimpleTestCase):
    @override_settings(**STORAGE, S3_PUBLIC_ENDPOINT_URL="")
    def test_sets_a_content_disposition_header_from_the_files_own_name(self):
        # Unsaved instance — SimpleTestCase forbids DB access, but constructing a model
        # in memory without .save() never touches the database.
        file = File(storage_key="tenants/t/report.pdf", original_name="Report Card.pdf")

        url = get_download_url(file)

        query = parse_qs(urlsplit(url).query)
        self.assertIn("response-content-disposition", query)
        self.assertIn("Report Card.pdf", query["response-content-disposition"][0])
```

- [ ] **Step 14: Confirm both fail**

`presign_download` has no `content_disposition` parameter yet, so the first test fails with a `TypeError` on the unexpected keyword argument. `get_download_url` doesn't pass one at all, so the second test's query has no `response-content-disposition` key.

- [ ] **Step 15: Add `content_disposition` to every `Presigner` implementation, and wire `get_download_url` through Django's own RFC 6266 helper**

The round-3 review's exact failure mode: adding `content_disposition` to only `S3Presigner.presign_download` leaves the `Presigner` Protocol and `NullPresigner` — the one every test and local/CI run actually uses (`get_presigner()` returns `NullPresigner` whenever `S3_ENDPOINT_URL` is unset) — without the parameter, so **every** `:download` call anywhere, including `/staff`'s existing export download, would raise `TypeError` the moment `get_download_url` tries to pass it. All three need the parameter together, in `apps/api/core/files/storage.py`:

```python
class Presigner(Protocol):
    def presign_upload(self, *, storage_key: str, mime_type: str) -> PresignedUpload: ...
    def presign_download(
        self,
        *,
        storage_key: str,
        expires_in: int = _DOWNLOAD_EXPIRY_SECONDS,
        cache_control: str | None = None,
        content_disposition: str | None = None,
    ) -> str: ...
    ...
```

```python
class NullPresigner:
    ...
    def presign_download(
        self,
        *,
        storage_key: str,
        expires_in: int = _DOWNLOAD_EXPIRY_SECONDS,
        cache_control: str | None = None,
        content_disposition: str | None = None,
    ) -> str:
        return f"https://null-presigner.invalid/{storage_key}"
```

```python
class S3Presigner:
    ...
    def presign_download(
        self,
        *,
        storage_key: str,
        expires_in: int = _DOWNLOAD_EXPIRY_SECONDS,
        cache_control: str | None = None,
        content_disposition: str | None = None,
    ) -> str:
        params = {"Bucket": self._bucket, "Key": storage_key}
        if cache_control:
            # Storage echoes this back as the response's Cache-Control header.
            params["ResponseCacheControl"] = cache_control
        if content_disposition:
            # Storage echoes this back as the response's Content-Disposition header —
            # forces a real save-as/download dialog regardless of the file's mime type,
            # instead of a browser opening a PDF/image inline and replacing the current tab.
            params["ResponseContentDisposition"] = content_disposition
        return self._signing_client.generate_presigned_url(
            "get_object", Params=params, ExpiresIn=expires_in
        )
```

In `apps/api/core/files/services.py`, change `get_download_url` to pass it, using Django's own `content_disposition_header` (`django.utils.http`, RFC 6266) rather than a raw f-string — a raw `f'attachment; filename="{file.original_name}"'` breaks quoting on a `"` in the name and mishandles a non-ASCII name (e.g. a real Urdu filename), both of which this helper already gets right:

```python
from django.utils.http import content_disposition_header


def get_download_url(file: File) -> str:
    return get_presigner().presign_download(
        storage_key=file.storage_key,
        content_disposition=content_disposition_header(True, file.original_name),
    )
```

This is a generic `core/files` change, applied globally (not scoped to document/export-purpose files only) — every caller of a `:download`-style action gets a real forced download: the new student-document `:download` action above, and `/staff`'s existing export download, which previously relied on the frontend anchor's `download` attribute, something browsers ignore for a cross-origin URL (confirmed via MDN: `download` only applies same-origin). **Task 9 keeps the same programmatic anchor-click pattern `/staff`'s existing download already uses** (consistency with a precedent that already ships and already works, rather than a second, different technique for no real gain) — the backend's `Content-Disposition: attachment` is now what actually forces the save behavior regardless of file type; the anchor's own `download` attribute remains a same-origin filename hint on top of that, exactly as this plan's Global Constraints already states, nothing here removes or replaces it. `/staff`'s existing download code needs no change to its own logic either — it already works, now for the right reason instead of by accident. This also resolves the `deferred-work.md` entry already tracking this exact Content-Disposition gap (recorded before this phase) — Step 17 below removes that entry rather than leaving a stale "still open" note beside a now-closed gap.

- [ ] **Step 16: Confirm all three new storage tests pass**

- [ ] **Step 17: Update the module doc's permission table and endpoint list; remove the now-stale `deferred-work.md` entry**

In `docs/03-modules/student-management.md` §4, change:

```
| `students.document.view` / `.create` / `.verify` / `.delete` | Manage & verify student documents | `school_admin`, `admission_staff`; verify also `principal` |
```

to:

```
| `students.document.view` / `.create` / `.verify` / `.delete` | Manage & verify student documents | `school_admin`, `admission_staff`; view & verify also `principal` (dev/e2e-seeded tenants only — see docs/deferred-work.md) |
```

In §16's endpoint list, add the new `POST /student-documents/{id}:download` action alongside the existing `:verify` entry.

In `docs/deferred-work.md`, remove (or mark resolved, matching this file's own convention for closed entries) the existing entry that already tracks "no `Content-Disposition` forcing a real download" — Step 15 closes it globally, so leaving it in place would describe a gap that no longer exists.

- [ ] **Step 18: Regenerate the API contract**

```bash
apps/api/scripts/generate-openapi.sh
pnpm --filter @schoolhub/api-client generate
```

Confirm `openapi.yaml`'s `Guardian` schema now has a `photo_url` property (`type: string, format: uri, nullable: true`), that it has a new `/student-documents/{id}:download` path (from Step 11's new action), and that `packages/api-client/src/schema.d.ts`'s generated types reflect both — the new `Guardian.photo_url: string | null` field and the new download operation. All must be committed alongside the serializer/view changes in the same commit (`.claude/rules/api-contract.md`) — CI's "OpenAPI schema is current" check fails the build on any drift. The `core/files` Content-Disposition change touches no serializer/view signature, so it alone would not change the OpenAPI schema — the new `:download` action is what does.

- [ ] **Step 19: Write the four remaining failing tests (existing named gaps)**

Add to `GuardianLinkTests` (the class already has `self.student`, `self.tenant`, `tenant_context`, `self.allow(...)` helpers — confirmed by reading the file's existing methods):

```python
    def test_searching_guardians_by_name_returns_matches(self) -> None:
        self.allow("students.guardian.view")
        with tenant_context(self.tenant.id):
            GuardianFactory(tenant=self.tenant, first_name="Ayesha", last_name="Raza")
            GuardianFactory(tenant=self.tenant, first_name="Bilal", last_name="Khan")

        response = self.client.get("/api/v1/guardians", {"search": "Ayesha"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        names = [(row["first_name"], row["last_name"]) for row in response.json()["data"]]
        self.assertIn(("Ayesha", "Raza"), names)
        self.assertNotIn(("Bilal", "Khan"), names)

    def test_retrieving_a_single_guardian_link_succeeds(self) -> None:
        self.allow("students.guardian.view")
        with tenant_context(self.tenant.id):
            guardian = GuardianFactory(tenant=self.tenant)
            link = StudentGuardianFactory(tenant=self.tenant, student=self.student, guardian=guardian)

        response = self.client.get(f"/api/v1/student-guardians/{link.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"]["id"], str(link.pk))
        self.assertEqual(response.json()["data"]["guardian_id"], str(guardian.pk))

    def test_patching_a_guardians_own_fields_succeeds(self) -> None:
        self.allow("students.guardian.view", "students.guardian.update")
        with tenant_context(self.tenant.id):
            guardian = GuardianFactory(tenant=self.tenant, phone="0300-0000000")

        response = self.client.patch(
            f"/api/v1/guardians/{guardian.pk}", {"phone": "0300-1111111"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["phone"], "0300-1111111")
```

Add to `CrossTenantGuardianDocumentTests` (the class's `_build` helper already returns a dict with `student`/`guardian`/`link`/`contact`/`document` keys for both `self.own` and `self.foreign` — confirmed by reading the file in full; `self.foreign['link']` already exists, no fixture change needed). Five tests, not one: the originally-named gap (listing emergency contacts under a foreign student) plus four more the review rounds surfaced — creating a contact under a foreign student and reading another tenant's guardian link must both 404 too, a foreign tenant's guardian must never leak into a search result, and the guardian-link duplicate conflict gets its own test:

```python
    def test_listing_emergency_contacts_under_a_foreign_student_is_404(self) -> None:
        response = self.client.get(
            f"/api/v1/students/{self.foreign['student'].pk}/emergency-contacts"
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_creating_an_emergency_contact_under_a_foreign_student_is_404(self) -> None:
        response = self.client.post(
            f"/api/v1/students/{self.foreign['student'].pk}/emergency-contacts",
            {"name": "Someone", "relationship": "Neighbour", "phone": "0300-0000000"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_reading_a_foreign_tenants_guardian_link_is_404(self) -> None:
        response = self.client.get(f"/api/v1/student-guardians/{self.foreign['link'].pk}")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_searching_guardians_excludes_a_foreign_tenants_guardian(self) -> None:
        """List-leakage, distinct from `test_retrieving_a_foreign_guardian_is_404` above —

        that one proves a direct fetch by id 404s; this one proves the foreign guardian
        doesn't quietly show up in a *search* result instead.
        """
        response = self.client.get(
            "/api/v1/guardians", {"search": self.foreign["guardian"].first_name}
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = {row["id"] for row in response.json()["data"]}
        self.assertNotIn(str(self.foreign["guardian"].pk), ids)
```

Add to `GuardianLinkTests` (alongside the three tests from Step 1 of this block above):

```python
    def test_linking_an_already_linked_guardian_returns_409(self) -> None:
        self.allow("students.guardian.view", "students.guardian.create")
        with tenant_context(self.tenant.id):
            guardian = GuardianFactory(tenant=self.tenant)
            StudentGuardianFactory(tenant=self.tenant, student=self.student, guardian=guardian)

        response = self.client.post(
            f"/api/v1/students/{self.student.pk}/guardians",
            {"guardian_id": str(guardian.pk), "relationship": "father"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.json()["error"]["code"], "conflict")
```

- [ ] **Step 20: Confirm the tests fail by construction (do not run them)**

`test_searching_guardians_by_name_returns_matches` and `test_retrieving_a_single_guardian_link_succeeds` exercise real, already-correct endpoints — they would pass immediately once written, proving the gap was test coverage, not behavior. `test_patching_a_guardians_own_fields_succeeds` likewise. The five cross-tenant/conflict tests exercise `_NestedUnderStudentMixin.get_student()`'s existing 404 behavior (already proven for guardians/documents in the same class), the existing tenant-scoped queryset's exclusion of a foreign guardian from search results, and `StudentGuardian`'s existing `UniqueConstraint` → `IntegrityError` → 409 mapping (`core/api/exceptions.py`) — by construction, all pass immediately too. None of these tests are expected to fail; they close a coverage gap against correct, shipped code, which is the point of this part of the task.

- [ ] **Step 21: Commit**

```bash
git add apps/api/apps/student_management/serializers.py apps/api/apps/student_management/permissions.py apps/api/apps/student_management/views.py apps/api/apps/student_management/urls.py apps/api/apps/student_management/tests/test_guardians_documents.py apps/api/core/files/storage.py apps/api/core/files/services.py apps/api/core/files/tests/test_storage.py apps/api/openapi.yaml packages/api-client/src/schema.d.ts docs/03-modules/student-management.md docs/deferred-work.md
git commit -m "feat(api): add guardian photo_url, gated document download, global Content-Disposition; close test gaps"
```

- [ ] **Step 22: Push and read CI**

---

## Task 2: `Services.guardians`

**Files:**
- Modify: `apps/dashboard/src/services/endpoints.ts`
- Create: `apps/dashboard/src/services/modules/guardians/guardians-service.ts`
- Create: `apps/dashboard/src/services/modules/guardians/guardians-type.ts`
- Create: `apps/dashboard/src/services/modules/guardians/guardians-constant.ts`
- Create: `apps/dashboard/src/services/modules/guardians/guardians-helper.ts`
- Create: `apps/dashboard/src/services/modules/guardians/guardians.schema.ts`
- Create: `apps/dashboard/src/services/modules/guardians/index.ts`
- Create: `apps/dashboard/src/services/modules/guardians/__tests__/guardians-service.test.ts`
- Create: `apps/dashboard/src/services/modules/guardians/__tests__/guardians-helper.test.ts`
- Modify: `apps/dashboard/src/services/index.ts` (register `Services.guardians`; top-level re-exports)
- Modify: `apps/dashboard/src/services/__tests__/index.test.ts`
- Modify: `packages/types/src/student.ts` (`RELATIONSHIP_VALUES`)
- Create: `docs/decisions/0020-client-fan-out-for-unembedded-nested-ids.md`
- Modify: `docs/decisions/README.md`

**Interfaces:**
- Consumes: `apiClient` (`@/lib/auth`), `fetchPage` (`@schoolhub/api-client`), `copyMappedFields` (`@/lib/helpers`).
- Produces: `Services.guardians.{searchGuardians,fetchGuardianById,createGuardian,updateGuardian,linkGuardianToStudent,updateGuardianLink,fetchGuardianLinks}`, `GuardianRecord`, `GuardianLinkRecord`, `GuardianRelationship` types (all via the `Services` barrel, ADR-0011). `guardianFormSchema`/`GuardianFormValues` (`guardians.schema.ts`) and `toCreateGuardianBody`/`toUpdateGuardianBody` (`guardians-helper.ts`) are imported directly by their own module path, not through the barrel — matching this codebase's real existing precedent (`features/auth/login-form.tsx` imports `loginSchema` from `@/services/modules/auth/auth.schema` directly, never through `@/services`). Consumed by Tasks 5, 6, 7. `fetchGuardianById` exists specifically so Task 7's Guardians tab resolves a link's `guardian_id` into a name/phone through `Services`, never a raw `apiClient`/`endpoints` import inside the tab component (ADR-0011). Five-file shape (`-type`/`-constant`/`-helper`/`.schema`/`-service`) from creation, per [ADR-0019](../../decisions/0019-every-module-uses-the-five-file-shape.md) — `Services.guardians` is a brand-new domain as of this plan, so the "from creation" rule applies directly, unlike `students` (Task 3), an existing domain ADR-0019 doesn't retrofit in this PR.

- [ ] **Step 1: Add the new paths to `endpoints.ts`**

`endpoints.files.download` already exists — nothing to add there. Add a new `guardians` block and a `studentGuardians` block, plus two new nested paths on the existing `students` block:

```ts
  guardians: {
    list: "/guardians",
    detail: (id: string) => `/guardians/${id}`,
    /** Nested under one student — `GET` lists that student's links, `POST` creates one.
     * The guardian itself is not created here (see `guardians.list` above). */
    studentLinks: (studentId: string) => `/students/${studentId}/guardians`,
  },
  /** Top-level access to a single link — `PATCH` only (module doc §16: "link flags
   * updatable via PATCH /api/v1/student-guardians/{id}"). */
  studentGuardians: {
    detail: (id: string) => `/student-guardians/${id}`,
  },
```

Add this as a new top-level key in `endpoints`, alongside the existing `schoolOrganization`/`students` blocks (same object, just two more keys — do not remove or reorder anything already there).

- [ ] **Step 2: Write the failing tests**

```ts
import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: mockPost,
      put: jest.fn(),
      patch: mockPatch,
      delete: jest.fn(),
      refresh: jest.fn(),
    })),
  };
});

describe("guardians-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
  });

  it("searchGuardians sends the search term as a query param", async () => {
    const { searchGuardians } = await import("../guardians-service");
    // `GuardianViewSet` doesn't override `pagination_class`, so it inherits the
    // project default `CursorPagination` (apps/api/core/api/pagination.py) — cursor
    // metadata, not `StudentViewSet`'s page-number shape. `fetchPage` itself never
    // inspects this field's contents, but the mock should still reflect the real
    // endpoint's shape rather than a different viewset's.
    mockGet.mockResolvedValue({
      data: [{ id: "g1", first_name: "Ayesha", last_name: "Raza" }],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 20 } },
    });

    const result = await searchGuardians("Ayesha");

    expect(mockGet).toHaveBeenCalledWith(
      "/guardians",
      expect.objectContaining({ query: { search: "Ayesha", page_size: 20 } }),
    );
    expect(result).toEqual([{ id: "g1", first_name: "Ayesha", last_name: "Raza" }]);
  });

  it("createGuardian maps camelCase input to the snake_case request body", async () => {
    const { createGuardian } = await import("../guardians-service");
    mockPost.mockResolvedValue({ data: { id: "g1" } });

    await createGuardian({
      firstName: "Ayesha",
      lastName: "Raza",
      phone: "0300-0000000",
      altPhone: "0300-1111111",
      email: "ayesha@example.com",
      photoFileId: "file-1",
    });

    expect(mockPost).toHaveBeenCalledWith("/guardians", {
      first_name: "Ayesha",
      last_name: "Raza",
      phone: "0300-0000000",
      alt_phone: "0300-1111111",
      email: "ayesha@example.com",
      photo_file_id: "file-1",
    });
  });

  it("createGuardian omits optional fields that were never filled in", async () => {
    const { createGuardian } = await import("../guardians-service");
    mockPost.mockResolvedValue({ data: { id: "g1" } });

    await createGuardian({ firstName: "Ayesha", lastName: "Raza", phone: "0300-0000000" });

    expect(mockPost).toHaveBeenCalledWith("/guardians", {
      first_name: "Ayesha",
      last_name: "Raza",
      phone: "0300-0000000",
    });
  });

  it("fetchGuardianById gets one guardian by id", async () => {
    const { fetchGuardianById } = await import("../guardians-service");
    mockGet.mockResolvedValue({ data: { id: "g1", first_name: "Ayesha", last_name: "Raza" } });

    const result = await fetchGuardianById("g1");

    expect(mockGet).toHaveBeenCalledWith("/guardians/g1");
    expect(result).toEqual({ id: "g1", first_name: "Ayesha", last_name: "Raza" });
  });

  it("updateGuardian PATCHes only the fields given", async () => {
    const { updateGuardian } = await import("../guardians-service");
    mockPatch.mockResolvedValue({ data: { id: "g1" } });

    await updateGuardian("g1", { phone: "0300-2222222" });

    expect(mockPatch).toHaveBeenCalledWith("/guardians/g1", { phone: "0300-2222222" });
  });

  it("linkGuardianToStudent posts relationship and flags to the nested endpoint", async () => {
    const { linkGuardianToStudent } = await import("../guardians-service");
    mockPost.mockResolvedValue({ data: { id: "link-1" } });

    await linkGuardianToStudent("student-1", {
      guardianId: "g1",
      relationship: "father",
      isPrimary: true,
      isFeeResponsible: false,
      canPickUp: true,
      receivesCommunications: true,
      hasPortalAccess: true,
    });

    expect(mockPost).toHaveBeenCalledWith("/students/student-1/guardians", {
      guardian_id: "g1",
      relationship: "father",
      is_primary: true,
      is_fee_responsible: false,
      can_pick_up: true,
      receives_communications: true,
      has_portal_access: true,
    });
  });

  it("updateGuardianLink PATCHes link flags by link id", async () => {
    const { updateGuardianLink } = await import("../guardians-service");
    mockPatch.mockResolvedValue({ data: { id: "link-1" } });

    await updateGuardianLink("link-1", { isPrimary: true });

    expect(mockPatch).toHaveBeenCalledWith("/student-guardians/link-1", { is_primary: true });
  });

  it("fetchGuardianLinks lists a student's guardian links", async () => {
    const { fetchGuardianLinks } = await import("../guardians-service");
    mockGet.mockResolvedValue({
      data: [{ id: "link-1", guardian_id: "g1" }],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 50 } },
    });

    const result = await fetchGuardianLinks("student-1");

    expect(mockGet).toHaveBeenCalledWith(
      "/students/student-1/guardians",
      // 50 (GUARDIAN_LINKS_PAGE_SIZE), not GUARDIAN_SEARCH_PAGE_SIZE's 20 — this lists one
      // student's own links (a small, bounded set), a different call site than the
      // tenant-wide search dropdown.
      expect.objectContaining({ query: { page_size: 50 } }),
    );
    expect(result).toEqual([{ id: "link-1", guardian_id: "g1" }]);
  });
});
```

- [ ] **Step 3: Confirm the tests fail by construction, then write `guardians-type.ts`**

```ts
import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shape — see `docs/decisions/0017-generated-wire-types-for-new-domains.md`. */
export type GuardianRecord = ApiSchemas["Guardian"];
export type GuardianLinkRecord = ApiSchemas["StudentGuardian"];
export type GuardianRelationship = GuardianLinkRecord["relationship"];

export interface CreateGuardianInput {
  firstName: string;
  lastName: string;
  phone: string;
  altPhone?: string;
  email?: string;
  photoFileId?: string;
}

export type UpdateGuardianInput = Partial<CreateGuardianInput>;

export interface LinkGuardianInput {
  guardianId: string;
  relationship: GuardianRelationship;
  isPrimary: boolean;
  isFeeResponsible: boolean;
  canPickUp: boolean;
  receivesCommunications: boolean;
  hasPortalAccess: boolean;
}

/** Every field optional — this is always a partial update of an existing link's
 * flags/relationship, never a full replace. `isPrimary` is deliberately never set here;
 * see this plan's Global Constraints on why promotion is its own one-click action. */
export interface UpdateGuardianLinkInput {
  relationship?: GuardianRelationship;
  isFeeResponsible?: boolean;
  canPickUp?: boolean;
  receivesCommunications?: boolean;
  hasPortalAccess?: boolean;
  isPrimary?: boolean;
}
```

- [ ] **Step 3a: Write `guardians-constant.ts`**

Per [ADR-0019](../../decisions/0019-every-module-uses-the-five-file-shape.md), a new domain gets this file from creation — here it holds real content from the start (the page-size tuning and the body-field maps `guardians-helper.ts` needs next), unlike a domain with nothing yet to put in it:

```ts
import type {
  CreateGuardianInput,
  LinkGuardianInput,
  UpdateGuardianLinkInput,
} from "./guardians-type";

/** The guardians module's constants — collected here so the service functions below, and
 * any future caller, share one definition instead of repeating a literal. */

/** Reference-data-sized page for a live search dropdown — not `MAX_PAGE_SIZE` (reserved
 * for a small, bounded reference list like campuses/houses): a tenant-wide guardian
 * search can realistically match far more than that, and a search dropdown only ever
 * shows a handful of results at once regardless. */
export const GUARDIAN_SEARCH_PAGE_SIZE = 20;

/** A student realistically has a handful of guardian links — large enough that no
 * student ever needs a second page, distinct from `GUARDIAN_SEARCH_PAGE_SIZE`'s
 * tenant-wide search dropdown use. */
export const GUARDIAN_LINKS_PAGE_SIZE = 50;

/** camelCase `CreateGuardianInput`/`UpdateGuardianInput` key -> the API's snake_case body
 * key. Drives `toCreateGuardianBody`/`toUpdateGuardianBody` (`guardians-helper.ts`) —
 * kept here, not inline in those functions, matching `students-constant.ts`'s
 * `STUDENT_BODY_FIELDS` convention exactly. */
export const GUARDIAN_BODY_FIELDS: ReadonlyArray<readonly [keyof CreateGuardianInput, string]> = [
  ["firstName", "first_name"],
  ["lastName", "last_name"],
  ["phone", "phone"],
  ["altPhone", "alt_phone"],
  ["email", "email"],
  ["photoFileId", "photo_file_id"],
];

/** Same convention, for `linkGuardianToStudent`'s request body (the full create-a-link
 * shape, including the guardian being linked). Kept SEPARATE from
 * `GUARDIAN_LINK_UPDATE_BODY_FIELDS` below rather than one shared list typed on the
 * union of both inputs' keys — `copyMappedFields<T>`'s field-list parameter type is
 * `keyof T`, derived from whichever single input type it's actually called with, so a
 * list typed `keyof (LinkGuardianInput & UpdateGuardianLinkInput)` (a wider key union
 * including `guardianId`, which `UpdateGuardianLinkInput` doesn't have) fails to
 * typecheck the moment it's passed where `keyof UpdateGuardianLinkInput` is expected. */
export const GUARDIAN_LINK_BODY_FIELDS: ReadonlyArray<readonly [keyof LinkGuardianInput, string]> = [
  ["guardianId", "guardian_id"],
  ["relationship", "relationship"],
  ["isPrimary", "is_primary"],
  ["isFeeResponsible", "is_fee_responsible"],
  ["canPickUp", "can_pick_up"],
  ["receivesCommunications", "receives_communications"],
  ["hasPortalAccess", "has_portal_access"],
];

/** `updateGuardianLink`'s own request body — everything in `GUARDIAN_LINK_BODY_FIELDS`
 * above EXCEPT `guardianId` (a link's own guardian is never reassigned by this call). */
export const GUARDIAN_LINK_UPDATE_BODY_FIELDS: ReadonlyArray<
  readonly [keyof UpdateGuardianLinkInput, string]
> = [
  ["relationship", "relationship"],
  ["isPrimary", "is_primary"],
  ["isFeeResponsible", "is_fee_responsible"],
  ["canPickUp", "can_pick_up"],
  ["receivesCommunications", "receives_communications"],
  ["hasPortalAccess", "has_portal_access"],
];
```

- [ ] **Step 3b: Write `guardians-helper.ts`, with its own failing test first**

Write `apps/dashboard/src/services/modules/guardians/__tests__/guardians-helper.test.ts`:

```ts
import {
  formValuesToCreateGuardianInput,
  toCreateGuardianBody,
  toUpdateGuardianBody,
} from "../guardians-helper";

describe("guardians-helper", () => {
  it("toCreateGuardianBody omits an unset optional entirely", () => {
    const body = toCreateGuardianBody({ firstName: "Ayesha", lastName: "Raza", phone: "0300-0000000" });

    expect(body).toEqual({ first_name: "Ayesha", last_name: "Raza", phone: "0300-0000000" });
  });

  it("toUpdateGuardianBody sends an explicit empty string, to clear a field", () => {
    const body = toUpdateGuardianBody({ altPhone: "" });

    expect(body).toEqual({ alt_phone: "" });
  });

  it("toUpdateGuardianBody omits a field that was never provided at all", () => {
    const body = toUpdateGuardianBody({ phone: "0300-1111111" });

    expect(body).toEqual({ phone: "0300-1111111" });
  });

  it("formValuesToCreateGuardianInput maps the form's snake_case fields to camelCase, omitting empty optionals", () => {
    const input = formValuesToCreateGuardianInput({
      first_name: "Ayesha",
      last_name: "Raza",
      phone: "0300-0000000",
      alt_phone: "",
      email: "",
      photo_file_id: "",
    });

    expect(input).toEqual({ firstName: "Ayesha", lastName: "Raza", phone: "0300-0000000" });
  });
});
```

Confirm it fails (`guardians-helper.ts` doesn't exist yet), then write it:

```ts
import { copyMappedFields } from "@/lib/helpers";
import {
  GUARDIAN_BODY_FIELDS,
  GUARDIAN_LINK_BODY_FIELDS,
  GUARDIAN_LINK_UPDATE_BODY_FIELDS,
} from "./guardians-constant";
import type { GuardianFormValues } from "./guardians.schema";
import type {
  CreateGuardianInput,
  LinkGuardianInput,
  UpdateGuardianInput,
  UpdateGuardianLinkInput,
} from "./guardians-type";

/**
 * The guardians module's pure helper functions — single source of truth, so a mapper
 * isn't reimplemented per call site. Plain data in, plain data out; no React, no API
 * calls.
 */

/** `GuardianFormValues` (snake_case, the Zod form shape) -> `CreateGuardianInput`
 * (camelCase, the service input shape), omitting an unset optional entirely. Shared by
 * `GuardianFormDialog`'s create branch (Task 5) and `GuardianPickerDialog`'s inline
 * create-tab (Task 6) — both build a brand-new guardian from the identical form. */
export function formValuesToCreateGuardianInput(values: GuardianFormValues): CreateGuardianInput {
  return {
    firstName: values.first_name,
    lastName: values.last_name,
    phone: values.phone,
    ...(values.alt_phone ? { altPhone: values.alt_phone } : {}),
    ...(values.email ? { email: values.email } : {}),
    ...(values.photo_file_id ? { photoFileId: values.photo_file_id } : {}),
  };
}

/** camelCase `CreateGuardianInput` -> the API's snake_case body, omitting an unset
 * optional entirely rather than sending it as empty — there is no existing guardian yet
 * for an omitted field to "leave unchanged", so there's nothing to clear. */
export function toCreateGuardianBody(input: CreateGuardianInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, GUARDIAN_BODY_FIELDS, (value) => Boolean(value), body);
  return body;
}

/** camelCase `UpdateGuardianInput` -> the API's snake_case body. Gated on `!== undefined`,
 * not truthiness: an explicit empty string (clearing `alt_phone`/`email`) must reach the
 * request body rather than being silently dropped — unlike `toCreateGuardianBody` above,
 * there IS a current value here that an omitted field would otherwise leave unchanged. */
export function toUpdateGuardianBody(input: UpdateGuardianInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, GUARDIAN_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}

export function toLinkGuardianBody(input: LinkGuardianInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, GUARDIAN_LINK_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}

export function toUpdateGuardianLinkBody(input: UpdateGuardianLinkInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, GUARDIAN_LINK_UPDATE_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}
```

Confirm the three `guardians-helper.test.ts` cases now pass.

- [ ] **Step 3c: Write `guardians.schema.ts`**

```ts
import { z } from "zod";

/**
 * The guardians module's Zod schemas — single source of truth for `GuardianFormDialog`
 * (Task 5, create/edit a guardian's own fields) and `GuardianPickerDialog`'s inline
 * create-tab (Task 6), so the same 5-field schema isn't redeclared in both places.
 */
export const guardianFormSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  phone: z.string().min(1),
  alt_phone: z.string().optional(),
  email: z.string().optional(),
  photo_file_id: z.string().optional(),
});

export type GuardianFormValues = z.infer<typeof guardianFormSchema>;
```

- [ ] **Step 4: Write `guardians-service.ts`**

```ts
import { fetchPage } from "@schoolhub/api-client";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { GUARDIAN_LINKS_PAGE_SIZE, GUARDIAN_SEARCH_PAGE_SIZE } from "./guardians-constant";
import {
  toCreateGuardianBody,
  toLinkGuardianBody,
  toUpdateGuardianBody,
  toUpdateGuardianLinkBody,
} from "./guardians-helper";
import type {
  CreateGuardianInput,
  GuardianLinkRecord,
  GuardianRecord,
  LinkGuardianInput,
  UpdateGuardianInput,
  UpdateGuardianLinkInput,
} from "./guardians-type";

export type {
  CreateGuardianInput,
  GuardianLinkRecord,
  GuardianRecord,
  GuardianRelationship,
  LinkGuardianInput,
  UpdateGuardianInput,
  UpdateGuardianLinkInput,
} from "./guardians-type";

export async function searchGuardians(search: string): Promise<GuardianRecord[]> {
  const { items } = await fetchPage<GuardianRecord>(apiClient, endpoints.guardians.list, {
    query: { search, page_size: GUARDIAN_SEARCH_PAGE_SIZE },
  });
  return items;
}

export async function fetchGuardianById(id: string): Promise<GuardianRecord> {
  const { data } = await apiClient.get<GuardianRecord>(endpoints.guardians.detail(id));
  return data;
}

export async function createGuardian(input: CreateGuardianInput): Promise<GuardianRecord> {
  const { data } = await apiClient.post<GuardianRecord>(
    endpoints.guardians.list,
    toCreateGuardianBody(input),
  );
  return data;
}

export async function updateGuardian(
  id: string,
  input: UpdateGuardianInput,
): Promise<GuardianRecord> {
  const { data } = await apiClient.patch<GuardianRecord>(
    endpoints.guardians.detail(id),
    toUpdateGuardianBody(input),
  );
  return data;
}

export async function linkGuardianToStudent(
  studentId: string,
  input: LinkGuardianInput,
): Promise<GuardianLinkRecord> {
  const { data } = await apiClient.post<GuardianLinkRecord>(
    endpoints.guardians.studentLinks(studentId),
    toLinkGuardianBody(input),
  );
  return data;
}

export async function updateGuardianLink(
  linkId: string,
  input: UpdateGuardianLinkInput,
): Promise<GuardianLinkRecord> {
  const { data } = await apiClient.patch<GuardianLinkRecord>(
    endpoints.studentGuardians.detail(linkId),
    toUpdateGuardianLinkBody(input),
  );
  return data;
}

export async function fetchGuardianLinks(studentId: string): Promise<GuardianLinkRecord[]> {
  const { items } = await fetchPage<GuardianLinkRecord>(
    apiClient,
    endpoints.guardians.studentLinks(studentId),
    { query: { page_size: GUARDIAN_LINKS_PAGE_SIZE } },
  );
  return items;
}
```

`createGuardian`/`updateGuardian`/`linkGuardianToStudent`/`updateGuardianLink` no longer hand-roll their own field-by-field body mapping — `guardians-helper.ts` (Step 3b) does it once, via `copyMappedFields` (`@/lib/helpers`), the same convention `students-helper.ts`'s `toStudentBody` already established. Step 2's tests above assert the same request bodies as before; this is a pure internal refactor, not a behavior change.

- [ ] **Step 5: Write `index.ts`**

```ts
import {
  createGuardian,
  fetchGuardianById,
  fetchGuardianLinks,
  linkGuardianToStudent,
  searchGuardians,
  updateGuardian,
  updateGuardianLink,
} from "./guardians-service";

export const GuardiansService = {
  searchGuardians,
  fetchGuardianById,
  createGuardian,
  updateGuardian,
  linkGuardianToStudent,
  updateGuardianLink,
  fetchGuardianLinks,
};
export type {
  CreateGuardianInput,
  GuardianLinkRecord,
  GuardianRecord,
  GuardianRelationship,
  LinkGuardianInput,
  UpdateGuardianInput,
  UpdateGuardianLinkInput,
} from "./guardians-service";
```

- [ ] **Step 6: Register the domain in `src/services/index.ts`**

```ts
import { GuardiansService } from "./modules/guardians";
```

Add this import alongside the existing ones (alphabetical, so between `FilesService` and `JobsService`). Add `guardians: GuardiansService,` to the `Services` object, between `schoolOrganization` and `staff` (matching the object's existing alphabetical-ish grouping — not load-bearing, just consistent). Add this re-export alongside the existing `StudentRecord` one — `UpdateGuardianLinkInput` is included here because Task 7's `GuardianLinkFlagsDialog` imports it from `@/services` (this file), not from the guardians module directly (ADR-0011: feature code imports only `@/services`, never a service module's own path):

```ts
export type {
  GuardianLinkRecord,
  GuardianRecord,
  GuardianRelationship,
  UpdateGuardianLinkInput,
} from "./modules/guardians";
```

Update `src/services/__tests__/index.test.ts`'s exact-keys assertion (`Object.keys(Services)` or equivalent, matching however the existing test asserts the full domain list) to include `"guardians"`.

- [ ] **Step 7: Add `RELATIONSHIP_VALUES` to `packages/types`**

`StudentGuardian.relationship`'s 6-value enum (Global Constraints) needs a runtime array to drive the `<Select>`s in Tasks 6 and 7 — the generated `GuardianRelationship` type alone gives no array to iterate. Add this to `packages/types/src/student.ts`, alongside the existing `GENDER_VALUES`:

```ts
export const RELATIONSHIP_VALUES = [
  "father",
  "mother",
  "grandparent",
  "sibling",
  "legal_guardian",
  "other",
] as const;
export type RelationshipValue = (typeof RELATIONSHIP_VALUES)[number];
```

One array, one place — Tasks 6 and 7 both import `RELATIONSHIP_VALUES` from `@schoolhub/types` rather than each declaring their own copy.

Also add a compile-time link to `guardians-type.ts` so the two can't silently drift apart — `packages/types` can't import `GuardianRelationship` itself (it's a lower-level shared package; `apps/dashboard` depends on it, never the reverse), so the check lives on the dashboard side, where both types are already in scope:

```ts
import { RELATIONSHIP_VALUES } from "@schoolhub/types";

// Compile-time link, checked in BOTH directions — a one-way `satisfies` alone only
// catches a removed/renamed backend value (every RELATIONSHIP_VALUES entry must still be
// a real GuardianRelationship); it would silently miss an ADDED one, since adding a
// value only widens the union GuardianRelationship, which stays trivially assignable.
RELATIONSHIP_VALUES satisfies readonly GuardianRelationship[];

// The other direction: every GuardianRelationship must actually appear in
// RELATIONSHIP_VALUES. If the backend adds a 7th relationship value and this file isn't
// updated, this fails to compile instead of silently leaving it off the dashboard's
// `<Select>`s.
type _AssertRelationshipValuesAreExhaustive =
  GuardianRelationship extends (typeof RELATIONSHIP_VALUES)[number]
    ? true
    : [
        "RELATIONSHIP_VALUES (packages/types) is missing a value from the generated GuardianRelationship enum — add it there",
        GuardianRelationship,
      ];
const _relationshipValuesAreExhaustive: _AssertRelationshipValuesAreExhaustive = true;
```

(Append this import + assertion to the bottom of `guardians-type.ts` from Step 3 above — it needs `GuardianRelationship`, already defined there, and `RELATIONSHIP_VALUES`, just added to `packages/types` in this step.)

- [ ] **Step 8: Confirm the tests pass by construction**

- [ ] **Step 9: Confirm ADR-0020 is recorded**

This task's own fan-out design (`fetchGuardianById` per unique `guardian_id`, resolved through `Services.guardians` rather than an embedded backend summary) is the decision [ADR-0020](../../decisions/0020-client-fan-out-for-unembedded-nested-ids.md) records. The ADR file and its `docs/decisions/README.md` index row already exist on disk (written during plan revision) — commit them alongside this task's own files rather than opening a separate docs-only commit for them.

- [ ] **Step 10: Commit**

```bash
git add apps/dashboard/src/services/endpoints.ts apps/dashboard/src/services/modules/guardians apps/dashboard/src/services/index.ts apps/dashboard/src/services/__tests__/index.test.ts packages/types/src/student.ts docs/decisions/0020-client-fan-out-for-unembedded-nested-ids.md docs/decisions/README.md
git commit -m "feat(dashboard): add Services.guardians"
```

- [ ] **Step 11: Push and read CI**

---

## Task 3: `Services.students` emergency-contacts/documents additions

**Files:**
- Modify: `apps/dashboard/src/services/endpoints.ts`
- Modify: `apps/dashboard/src/services/modules/students/students-service.ts`
- Modify: `apps/dashboard/src/services/modules/students/students-type.ts`
- Modify: `apps/dashboard/src/services/modules/students/students-constant.ts`
- Modify: `apps/dashboard/src/services/modules/students/index.ts`
- Modify: `apps/dashboard/src/services/modules/students/__tests__/students-service.test.ts`
- Modify: `apps/dashboard/src/services/index.ts` (top-level re-export — Tasks 8/9 import from `@/services`, not the module path)

**Interfaces:**
- Consumes: `apiClient`, `fetchPage`.
- Produces: `Services.students.{fetchEmergencyContacts,addEmergencyContact,fetchDocuments,uploadDocumentRecord,deleteDocument,verifyDocument,getDocumentDownloadUrl}`, `EmergencyContactRecord`, `StudentDocumentRecord`, `DocumentVerificationDecision` types, re-exported from `@/services`. Consumed by Tasks 8, 9. `getDocumentDownloadUrl` wraps Task 1's new `POST /student-documents/{id}:download` action — genuinely distinct from the existing `Services.jobs.fetchFileDownloadUrl` (`apps/dashboard/src/services/modules/jobs/jobs-service.ts`, wraps the generic `/files/{id}:download`), which stays exactly as it is for `/staff`'s export download. This isn't a duplicate wrapper around the same endpoint: it calls a different, more narrowly `students.document.view`-gated route, keyed on the document's own id rather than its underlying file id.

Added directly into the existing `students-service.ts`/`students-type.ts`/`students-constant.ts` — not a second, separate `student-relations-*` domain. `students` already has the full five-file shape ([ADR-0019](../../decisions/0019-every-module-uses-the-five-file-shape.md) names it, alongside `staff`, as a domain that already grew into it) — this task adds to those existing files, it doesn't create a new split. A student's emergency contacts/documents are exactly the same resource family as the student record itself (nested under it, not independent), unlike guardians (Task 2), which are genuinely their own tenant-wide-searchable resource and earn their own domain under ADR-0019's "every new domain, from creation" rule.

- [ ] **Step 1: Add the new paths to `endpoints.ts`**

Add two nested paths to the existing `students` block (`list`, `detail`, `withdraw` stay exactly as they are) and one new top-level `studentDocuments` block:

```ts
  students: {
    list: "/students",
    detail: (id: string) => `/students/${id}`,
    withdraw: (id: string) => `/students/${id}:withdraw`,
    emergencyContacts: (studentId: string) => `/students/${studentId}/emergency-contacts`,
    documents: (studentId: string) => `/students/${studentId}/documents`,
  },
  /** Top-level access to a single document — `DELETE` and the `:verify`/`:download`
   * colon-actions. Upload (create) always goes through the nested `students.documents`
   * path above, where the student is unambiguous from the URL. */
  studentDocuments: {
    detail: (id: string) => `/student-documents/${id}`,
    verify: (id: string) => `/student-documents/${id}:verify`,
    download: (id: string) => `/student-documents/${id}:download`,
  },
```

- [ ] **Step 2: Write the failing tests**

This file already exists (`apps/dashboard/src/services/modules/students/__tests__/students-service.test.ts`) with its own `mockGet`/`mockPost`/`mockPatch` and a `jest.mock("@schoolhub/api-client", ...)` at the top. `deleteDocument` needs `apiClient.delete`, which the existing mock wires as a bare inline `jest.fn()` (not a named const, since nothing has used it yet) — change that one line to a named `mockDelete` so the new tests can assert against it:

```diff
+const mockDelete = jest.fn();
+
 jest.mock("@schoolhub/api-client", () => {
   const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
   return {
     ...actual,
     createApiClient: jest.fn((_config: ApiClientConfig) => ({
       get: mockGet,
       post: mockPost,
       put: jest.fn(),
       patch: mockPatch,
-      delete: jest.fn(),
+      delete: mockDelete,
       refresh: jest.fn(),
     })),
   };
 });
```

Then add a new top-level `describe` block below the file's existing one, with its own `beforeEach` resetting the three mocks it uses:

```ts
describe("students-service — emergency contacts and documents", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockDelete.mockReset();
  });

  it("fetchEmergencyContacts lists a student's contacts, ordered by priority", async () => {
    const { fetchEmergencyContacts } = await import("../students-service");
    // EmergencyContactLinkViewSet doesn't override pagination_class, so it inherits the
    // project default CursorPagination (apps/api/core/api/pagination.py) — only
    // StudentViewSet (this file's other tests) uses page numbers.
    mockGet.mockResolvedValue({
      data: [{ id: "c1", priority: 1 }],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 50 } },
    });

    const result = await fetchEmergencyContacts("student-1");

    expect(mockGet).toHaveBeenCalledWith(
      "/students/student-1/emergency-contacts",
      expect.objectContaining({ query: { ordering: "priority", page_size: 50 } }),
    );
    expect(result).toEqual([{ id: "c1", priority: 1 }]);
  });

  it("addEmergencyContact posts the contact fields, omitting unfilled optionals", async () => {
    const { addEmergencyContact } = await import("../students-service");
    mockPost.mockResolvedValue({ data: { id: "c1" } });

    await addEmergencyContact("student-1", {
      name: "Hamza Raza",
      relationship: "Uncle",
      phone: "0300-0000000",
      priority: 2,
    });

    expect(mockPost).toHaveBeenCalledWith("/students/student-1/emergency-contacts", {
      name: "Hamza Raza",
      relationship: "Uncle",
      phone: "0300-0000000",
      priority: 2,
    });
  });

  it("fetchDocuments lists a student's documents", async () => {
    const { fetchDocuments } = await import("../students-service");
    mockGet.mockResolvedValue({
      data: [{ id: "d1" }],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 50 } },
    });

    const result = await fetchDocuments("student-1");

    expect(mockGet).toHaveBeenCalledWith(
      "/students/student-1/documents",
      expect.objectContaining({ query: { page_size: 50 } }),
    );
    expect(result).toEqual([{ id: "d1" }]);
  });

  it("uploadDocumentRecord posts the already-uploaded file's id plus metadata", async () => {
    const { uploadDocumentRecord } = await import("../students-service");
    mockPost.mockResolvedValue({ data: { id: "d1" } });

    await uploadDocumentRecord("student-1", {
      fileId: "file-1",
      documentType: "birth_certificate",
      title: "Birth certificate",
    });

    expect(mockPost).toHaveBeenCalledWith("/students/student-1/documents", {
      file_id: "file-1",
      document_type: "birth_certificate",
      title: "Birth certificate",
    });
  });

  it("uploadDocumentRecord includes notes and expiresAt only when given", async () => {
    const { uploadDocumentRecord } = await import("../students-service");
    mockPost.mockResolvedValue({ data: { id: "d1" } });

    await uploadDocumentRecord("student-1", {
      fileId: "file-1",
      documentType: "other",
      title: "Note",
      notes: "Handwritten note from the guardian",
      expiresAt: "2027-01-01",
    });

    expect(mockPost).toHaveBeenCalledWith("/students/student-1/documents", {
      file_id: "file-1",
      document_type: "other",
      title: "Note",
      notes: "Handwritten note from the guardian",
      expires_at: "2027-01-01",
    });
  });

  it("deleteDocument deletes by document id", async () => {
    const { deleteDocument } = await import("../students-service");
    mockDelete.mockResolvedValue({});

    await deleteDocument("d1");

    expect(mockDelete).toHaveBeenCalledWith("/student-documents/d1");
  });

  it("verifyDocument posts the decision to the colon-action", async () => {
    const { verifyDocument } = await import("../students-service");
    mockPost.mockResolvedValue({ data: { id: "d1", verification_status: "verified" } });

    const result = await verifyDocument("d1", "verified");

    expect(mockPost).toHaveBeenCalledWith("/student-documents/d1:verify", { decision: "verified" });
    expect(result).toEqual({ id: "d1", verification_status: "verified" });
  });

  it("getDocumentDownloadUrl posts to the document's own :download action and returns the url", async () => {
    const { getDocumentDownloadUrl } = await import("../students-service");
    mockPost.mockResolvedValue({ data: { download_url: "https://files.example.com/x?sig=abc" } });

    const result = await getDocumentDownloadUrl("d1");

    expect(mockPost).toHaveBeenCalledWith("/student-documents/d1:download");
    expect(result).toBe("https://files.example.com/x?sig=abc");
  });
});
```

- [ ] **Step 3: Confirm the tests fail by construction, then add the new types to `students-type.ts`**

Add these to the existing `students-type.ts` (alongside `CreateStudentInput`/`StudentRecord`/etc. — don't disturb those):

```ts
export type EmergencyContactRecord = ApiSchemas["EmergencyContact"];
export type StudentDocumentRecord = ApiSchemas["StudentDocument"];
/** The generated enum (`schema.d.ts`'s `DocumentVerificationDecisionEnum`, already
 * `"verified" | "rejected"`) — aliased, not hand-written, per ADR-0017. */
export type DocumentVerificationDecision = ApiSchemas["DocumentVerificationDecisionEnum"];

export interface AddEmergencyContactInput {
  name: string;
  relationship: string;
  phone: string;
  altPhone?: string;
  priority: number;
  notes?: string;
}

export interface UploadDocumentInput {
  fileId: string;
  documentType: string;
  title: string;
  notes?: string;
  expiresAt?: string;
}
```

(`ApiSchemas` is already imported at the top of this file for `StudentRecord`'s own `ApiSchemas["Student"]` — reuse that import, don't add a second one.)

- [ ] **Step 4: Add the new functions to `students-service.ts`**

Add these import lines to the file's existing imports (it has no `fetchPage` import yet — `fetchStudentsPage` uses it already, confirm and reuse rather than duplicating; `RELATION_PAGE_SIZE` is added to `students-constant.ts` in Step 6 below — add this import now, the constant exists by the time this task is actually run end-to-end since both steps land in the same commit):

```ts
import { RELATION_PAGE_SIZE } from "./students-constant";
import type {
  AddEmergencyContactInput,
  DocumentVerificationDecision,
  EmergencyContactRecord,
  StudentDocumentRecord,
  UploadDocumentInput,
} from "./students-type";
```

Add these to the file's existing `export type { ... } from "./students-type";` re-export block, and append the six new functions after the existing `withdrawStudent`:

```ts
export async function fetchEmergencyContacts(studentId: string): Promise<EmergencyContactRecord[]> {
  const { items } = await fetchPage<EmergencyContactRecord>(
    apiClient,
    endpoints.students.emergencyContacts(studentId),
    { query: { ordering: "priority", page_size: RELATION_PAGE_SIZE } },
  );
  return items;
}

export async function addEmergencyContact(
  studentId: string,
  input: AddEmergencyContactInput,
): Promise<EmergencyContactRecord> {
  const { data } = await apiClient.post<EmergencyContactRecord>(
    endpoints.students.emergencyContacts(studentId),
    {
      name: input.name,
      relationship: input.relationship,
      phone: input.phone,
      ...(input.altPhone ? { alt_phone: input.altPhone } : {}),
      priority: input.priority,
      ...(input.notes ? { notes: input.notes } : {}),
    },
  );
  return data;
}

export async function fetchDocuments(studentId: string): Promise<StudentDocumentRecord[]> {
  const { items } = await fetchPage<StudentDocumentRecord>(
    apiClient,
    endpoints.students.documents(studentId),
    { query: { page_size: RELATION_PAGE_SIZE } },
  );
  return items;
}

export async function uploadDocumentRecord(
  studentId: string,
  input: UploadDocumentInput,
): Promise<StudentDocumentRecord> {
  const { data } = await apiClient.post<StudentDocumentRecord>(
    endpoints.students.documents(studentId),
    {
      file_id: input.fileId,
      document_type: input.documentType,
      title: input.title,
      ...(input.notes ? { notes: input.notes } : {}),
      ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
    },
  );
  return data;
}

export async function deleteDocument(documentId: string): Promise<void> {
  await apiClient.delete(endpoints.studentDocuments.detail(documentId));
}

export async function verifyDocument(
  documentId: string,
  decision: DocumentVerificationDecision,
): Promise<StudentDocumentRecord> {
  const { data } = await apiClient.post<StudentDocumentRecord>(
    endpoints.studentDocuments.verify(documentId),
    { decision },
  );
  return data;
}

/** Task 1's own `students.document.view`-gated action — distinct from the generic
 * `Services.jobs.fetchFileDownloadUrl`, which stays `/staff`'s export download path. */
export async function getDocumentDownloadUrl(documentId: string): Promise<string> {
  const { data } = await apiClient.post<{ download_url: string }>(
    endpoints.studentDocuments.download(documentId),
  );
  return data.download_url;
}
```

- [ ] **Step 5: Wire the new functions into `students/index.ts`**

The existing file imports `createStudent,fetchStudentById,fetchStudentsPage,updateStudent,withdrawStudent` from `./students-service` and re-exports their types from `./students-service`. Extend that same import and the same re-export — there is no second file to import from:

```ts
import {
  addEmergencyContact,
  createStudent,
  deleteDocument,
  fetchDocuments,
  fetchEmergencyContacts,
  fetchStudentById,
  fetchStudentsPage,
  getDocumentDownloadUrl,
  updateStudent,
  uploadDocumentRecord,
  verifyDocument,
  withdrawStudent,
} from "./students-service";

export const StudentsService = {
  fetchStudentsPage,
  fetchStudentById,
  createStudent,
  updateStudent,
  withdrawStudent,
  fetchEmergencyContacts,
  addEmergencyContact,
  fetchDocuments,
  uploadDocumentRecord,
  deleteDocument,
  verifyDocument,
  getDocumentDownloadUrl,
};
export type {
  AddEmergencyContactInput,
  CreateStudentInput,
  DocumentVerificationDecision,
  EmergencyContactRecord,
  StudentDocumentRecord,
  StudentRecord,
  StudentsPageQuery,
  UpdateStudentInput,
  UploadDocumentInput,
  WithdrawStudentInput,
} from "./students-service";
```

- [ ] **Step 5b: Re-export the new types from the top-level `src/services/index.ts`**

Tasks 8 and 9 import `EmergencyContactRecord`, `StudentDocumentRecord` and `DocumentVerificationDecision` from `@/services` (the top-level barrel), not from `./modules/students` directly (ADR-0011) — that barrel only re-exports `StudentRecord` today. In `apps/dashboard/src/services/index.ts`, extend the existing line:

```diff
-export type { StudentRecord } from "./modules/students";
+export type {
+  DocumentVerificationDecision,
+  EmergencyContactRecord,
+  StudentDocumentRecord,
+  StudentRecord,
+} from "./modules/students";
```

- [ ] **Step 6: Add `DOCUMENT_TYPES` to `students-constant.ts`**

The 6 seeded defaults, matching `en.json`/`ur.json`'s existing `students.documents.type.*` keys exactly (Task 4 confirms these are already fully translated in both locales — this constant must name the same six, in the same order the Select should offer them):

```ts
export const DOCUMENT_TYPES = [
  "birth_certificate",
  "prior_transfer_certificate",
  "immunization_record",
  "photo_id",
  "prior_report_card",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Nested under one student — a handful of rows, fetched in one page. Matches the real
 * `EmergencyContactLinkViewSet`/`StudentDocumentLinkViewSet` precedent: both are
 * nested-under-one-student lists with no independent pagination UI. */
export const RELATION_PAGE_SIZE = 50;
```

Both constants live here, not inline in `students-service.ts` or `document-upload-dialog.tsx` (Task 9) — the same "one place a reviewer can check" rationale this file's own header comment already states for `STUDENT_BODY_FIELDS`/`SORT_FIELD`.

- [ ] **Step 7: Confirm all tests pass by construction**

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/services/endpoints.ts apps/dashboard/src/services/modules/students apps/dashboard/src/services/index.ts
git commit -m "feat(dashboard): add emergency-contact and document relations to Services.students"
```

- [ ] **Step 9: Push and read CI**

---

## Task 4: i18n — reconcile the existing `students.tabs`/`guardians`/`emergencyContacts`/`documents` keys

**Files:**
- Modify: `apps/dashboard/messages/en.json`, `apps/dashboard/messages/ur.json`

**Interfaces:**
- Produces: every i18n key Tasks 5-10's components read. Consumed by Tasks 5, 6, 7, 8, 9, 10.

`students.tabs`, `students.guardians`, `students.emergencyContacts`, `students.documents` already exist in both files (pre-dashboard-shell-reset work, confirmed real and fully translated in both locales by reading the files directly) — this task edits them in place, it does not create the namespaces from scratch.

- [ ] **Step 1: Remove the one near-duplicate**

Delete `"close": "Close"` from `students.guardians` in `en.json`, and `"close": "بند کریں"` from the same object in `ur.json`. Every dialog in this phase uses `tCommon("close")` (Phase 1's established convention — see `apps/dashboard/AGENTS.md`'s "reuse `common.*` for generic verbs" rule), never a per-namespace duplicate.

- [ ] **Step 2: Add the fields `GuardianFormDialog` needs that the existing scaffold doesn't have**

In `en.json`'s `students.guardians.fields`, add alongside the existing `firstName`/`lastName`/`phone`/`relationship`:

```json
"altPhone": "Alternate phone",
"email": "Email"
```

In `en.json`'s `students.guardians`, add these two new top-level keys (dialog titles distinct from the existing `link`/`createNew`, which stay exactly as they are — `link` is the picker dialog's own title, `createNew` is the tab label inside it):

```json
"editGuardianTitle": "Edit guardian",
"editLinkTitle": "Edit link",
"createGuardian": "Create guardian"
```

(`createGuardian` is the picker's inline create-form submit button, Task 6 — distinct from `createNew`, the tab label that opens that form.)

Matching Urdu additions in `ur.json`'s `students.guardians.fields` and `students.guardians`:

```json
"altPhone": "متبادل فون",
"email": "ای میل"
```

```json
"editGuardianTitle": "سرپرست میں ترمیم کریں",
"editLinkTitle": "تعلق میں ترمیم کریں",
"createGuardian": "سرپرست بنائیں"
```

- [ ] **Step 3: Add the emergency-contact field label and permanence notice**

`emergencyContacts.priority` already exists as the *display* string (`"Priority {priority}"`, shown on an existing contact's row) — this is a separate concern from the *input label* on the add form, which doesn't exist yet. Add to `en.json`'s `students.emergencyContacts.fields` (alongside the existing `name`/`relationship`/`phone`/`altPhone`/`notes`):

```json
"priority": "Priority"
```

Add to `en.json`'s `students.emergencyContacts`, alongside `addDescription`:

```json
"permanentNotice": "This can't be edited or removed after saving — double-check the details first."
```

Matching Urdu in `ur.json`:

```json
"priority": "ترجیح"
```

```json
"permanentNotice": "محفوظ کرنے کے بعد اسے تبدیل یا حذف نہیں کیا جا سکتا — پہلے تفصیلات دوبارہ چیک کر لیں۔"
```

- [ ] **Step 4: Add the document-delete confirmation copy**

`documents.delete` already exists as the button label. Add a matching confirmation description to `en.json`'s `students.documents`:

```json
"deleteConfirmTitle": "Delete this document?",
"deleteConfirmDescription": "This cannot be undone. The uploaded file itself is not removed from storage, only this record."
```

Matching Urdu in `ur.json`:

```json
"deleteConfirmTitle": "یہ دستاویز حذف کریں؟",
"deleteConfirmDescription": "اسے واپس نہیں لیا جا سکتا۔ اپ لوڈ کردہ فائل خود اسٹوریج سے نہیں ہٹائی جاتی، صرف یہ ریکارڈ حذف ہوتا ہے۔"
```

- [ ] **Step 5: Add the search-empty and load-error keys the review round surfaced**

The existing `guardians.empty` ("No guardians linked yet.") is the *tab's* empty-list state — the picker's zero-search-results state is a different message and needs its own key, never the same one (Review Focus item 1). Each of the three tabs also needs a load-error message, distinct from its empty state (Review Focus item 5); the retry button itself reuses `tCommon("retry")` ("Try again"), already in `common.retry` — no new button-label key needed. Add to `en.json`:

```json
// students.guardians
"searchEmpty": "No guardians match that search.",
"loadError": "Couldn't load this student's guardians.",
"guardianLoadError": "Couldn't load this guardian."
```

```json
// students.emergencyContacts
"loadError": "Couldn't load this student's emergency contacts."
```

```json
// students.documents
"loadError": "Couldn't load this student's documents."
```

Matching Urdu in `ur.json`:

```json
// students.guardians
"searchEmpty": "اس تلاش سے کوئی سرپرست نہیں ملا۔",
"loadError": "اس طالب علم کے سرپرستوں کو لوڈ نہیں کیا جا سکا۔",
"guardianLoadError": "اس سرپرست کو لوڈ نہیں کیا جا سکا۔"
```

```json
// students.emergencyContacts
"loadError": "اس طالب علم کے ہنگامی رابطوں کو لوڈ نہیں کیا جا سکا۔"
```

```json
// students.documents
"loadError": "اس طالب علم کی دستاویزات لوڈ نہیں کی جا سکیں۔"
```

Also fix the one remaining hardcoded English string the review round found: Task 9's delete-confirmation `AlertDialogCancel` button must read `tCommon("cancel")` (`common.cancel`, "Cancel" — already exists, no new key needed here), not a literal `"Cancel"` string.

- [ ] **Step 6: Add the toast-error fallback keys the review round's error-handling fix needs**

"Mutations don't fail silently" (Global Constraints) needs a fallback message per failing action — shown only when the server's own error has no better one (`resolveErrorMessage`'s fallback argument). Add to `en.json`:

```json
// students.guardians
"promoteFailed": "Couldn't make this guardian primary."
```

```json
// students.emergencyContacts
"addFailed": "Couldn't add this emergency contact."
```

```json
// students.documents
"verifyFailed": "Couldn't update this document's verification status.",
"deleteFailed": "Couldn't delete this document.",
"downloadFailed": "Couldn't get a download link for this document."
```

Matching Urdu in `ur.json`:

```json
// students.guardians
"promoteFailed": "اس سرپرست کو بنیادی نہیں بنایا جا سکا۔"
```

```json
// students.emergencyContacts
"addFailed": "یہ ہنگامی رابطہ شامل نہیں کیا جا سکا۔"
```

```json
// students.documents
"verifyFailed": "اس دستاویز کی تصدیقی حیثیت اپ ڈیٹ نہیں کی جا سکی۔",
"deleteFailed": "یہ دستاویز حذف نہیں کی جا سکی۔",
"downloadFailed": "اس دستاویز کے لیے ڈاؤن لوڈ لنک حاصل نہیں کیا جا سکا۔"
```

Also add the `loadingLabel` announcements `Button`'s discriminated union requires wherever `isLoading` is passed (ADR-0009) — these are screen-reader text, not visible button labels, so they can be terse. Add to `en.json`:

```json
// students.guardians
"submitting": "Saving…",
"linking": "Linking…"
```

```json
// students.emergencyContacts
"submitting": "Saving…"
```

Matching Urdu in `ur.json`:

```json
// students.guardians
"submitting": "محفوظ ہو رہا ہے…",
"linking": "منسلک ہو رہا ہے…"
```

```json
// students.emergencyContacts
"submitting": "محفوظ ہو رہا ہے…"
```

(The Documents tab's own upload button reuses its already-existing `documents.uploading` key for its `loadingLabel` — no new key needed there.)

- [ ] **Step 7: Add the shared `common.photoUpload.*` keys for the relocated `PhotoUploadField`**

Task 5's `PhotoUploadField` moves to `apps/dashboard/src/components/` (a neutral location, not under `features/students/`) specifically so it can be shared by any future form outside the students feature — staff's own copy is the named candidate (Task 12's deferred-work entry). A component living outside `features/students/` reading the `students` i18n namespace would defeat that: add a new shared `common.photoUpload` object to `en.json`'s top-level `common` block (after the existing `resizeColumn`, the object's last key):

```json
"photoUpload": {
  "photo": "Photo",
  "uploading": "Uploading photo…",
  "onFile": "Photo on file",
  "uploadFailed": "The photo could not be uploaded."
}
```

Matching Urdu in `ur.json`'s top-level `common` block:

```json
"photoUpload": {
  "photo": "تصویر",
  "uploading": "تصویر اپ لوڈ ہو رہی ہے…",
  "onFile": "تصویر محفوظ ہے",
  "uploadFailed": "تصویر اپ لوڈ نہیں ہو سکی۔"
}
```

These are copies of the existing `students.fields.photo`/`photoUploading`/`photoOnFile`/`photoUploadFailed` strings (kept there too, unchanged — `StudentPhotoField`'s own wrapper still has students-specific copy elsewhere, and nothing else in the `students` namespace reads these four keys well enough to justify deleting and re-pointing them). `PhotoUploadField` itself reads `common.photoUpload.*` via `useTranslations("common")`, not `useTranslations("students")`, once Task 5 relocates it.

- [ ] **Step 8: Verify via CI's i18n types-check**

(`messages.types-check.ts`, per Phase 1's own convention — no local run; CI's `frontend` workflow checks both locale files stay structurally identical.)

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/messages/en.json apps/dashboard/messages/ur.json
git commit -m "feat(dashboard): add the guardian/emergency-contact/document field and dialog copy"
```

- [ ] **Step 10: Push and read CI**

---

## Task 5: Shared `PhotoUploadField` + `GuardianFormDialog` (create/edit a guardian's own fields, with a photo)

**Files:**
- Create: `apps/dashboard/src/components/photo-upload-field.tsx`
- Create: `apps/dashboard/src/components/__tests__/photo-upload-field.test.tsx`
- Modify: `apps/dashboard/src/features/students/student-photo-field.tsx` — becomes a thin wrapper
- Modify: `apps/dashboard/src/features/students/__tests__/student-photo-field.test.tsx` — same cases, now exercised through the wrapper
- Modify: `apps/dashboard/src/test-utils.tsx` — add shared `stubObjectUrls`/`stubImageLoading`
- Modify: `apps/dashboard/src/features/students/__tests__/student-form-dialog.test.tsx` — drop its local `stubObjectUrls`/`stubImageLoading`, import from `@/test-utils`
- Modify: `apps/dashboard/src/features/staff/__tests__/staff-form-dialog.test.tsx` — drop its local `stubImageLoading`, import from `@/test-utils`
- Modify: `apps/dashboard/src/lib/error-message.ts` — add `applyServerFieldErrors` (see Step 3a)
- Modify: `apps/dashboard/src/lib/__tests__/error-message.test.ts`
- Create: `apps/dashboard/src/features/students/guardian-form-dialog.tsx`
- Create: `apps/dashboard/src/features/students/__tests__/guardian-form-dialog.test.tsx`

**Interfaces:**
- Consumes: `Services.guardians.{createGuardian,updateGuardian}`, `Services.files.uploadFile` (Task 2, Phase 1).
- Produces: `PhotoUploadField` (shared, at `@/components/photo-upload-field`), `applyServerFieldErrors` (shared, at `@/lib/error-message` — the server-field-error-mapping loop this task and Task 7's `GuardianLinkFlagsDialog` both need, extracted once rather than duplicated a second time), `GuardianFormFields({ form, savedPhotoFileId?, savedPhotoUrl?, onUploadStart, onUploadingChange })` (the guardian person-fields JSX alone — exported from `guardian-form-dialog.tsx` so Task 6's picker can render the identical fields in its own inline create-tab without a second, nested dialog; see that task), `GuardianFormDialog({ open, onOpenChange, mode, guardian?, onSaved })` (this dialog's own chrome/mutation wrapped around `GuardianFormFields`). `mode: "create"` needs no `guardian` prop; `mode: "edit"` requires one (the already-fetched record — this component never fetches a guardian itself). `onSaved(guardian: GuardianRecord)` fires after a successful create or update, so the caller decides what happens next (Task 6 links a newly created guardian; Task 7's edit action just needs the tab to refetch). Consumed by Tasks 6, 7.

Students, staff and now guardians each need the identical three-step-upload-plus-preview flow — this is the third copy, and this repo's own convention (`docs/02-architecture/repo-structure.md` §2; see this plan's Alternatives Considered) is to extract on the third copy, not the fourth. `PhotoUploadField` is that extraction, used here by both the student and guardian forms. It lives at `@/components/photo-upload-field.tsx` — a neutral location outside `features/students/` — specifically so a future caller outside the students feature (staff is the named one) can adopt it without an import that reaches into another feature's folder; its `uploadPurpose` prop is a plain `string` (not a students/guardians-only union) and its copy lives in the shared `common.photoUpload.*` i18n namespace (Task 4), not `students.*`, for the same reason. Staff's route (`apps/dashboard/src/app/(app)/staff/`) is not migrated to it in this PR — Task 12 records that as a named, deliberate gap in `docs/deferred-work.md`, not a silently-left third copy.

- [ ] **Step 1: Write the failing test for the shared field, then `photo-upload-field.tsx`**

`PhotoUploadField` is generic over any form whose values include `first_name`/`last_name`/`photo_file_id` — both `StudentFormValues` and the new `GuardianFormValues` (Step 4 below) already use those exact snake_case field names, matching the wire shape directly (Phase 1's own convention). It takes the saved photo's id/url as plain strings, not a whole record, so it never needs to know about `StudentRecord` vs `GuardianRecord`.

**First, move `stubObjectUrls`/`stubImageLoading` into `@/test-utils`.** Both already exist as local copies in `student-form-dialog.test.tsx` (and `stubImageLoading` again in `staff-form-dialog.test.tsx`) — this test would be a third (and, for the image stub, fourth) copy. Add both to `apps/dashboard/src/test-utils.tsx`, exported alongside the existing `renderWithProviders`:

```tsx
/** jsdom has no object URLs; a picked file's local preview needs one. */
export function stubObjectUrls(url: string) {
  const saved = ["createObjectURL", "revokeObjectURL"].map(
    (name) => [name, Object.getOwnPropertyDescriptor(URL, name)] as const,
  );
  Object.defineProperty(URL, "createObjectURL", { value: jest.fn(() => url), configurable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: jest.fn(), configurable: true });
  return () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(URL, name, descriptor);
      else Reflect.deleteProperty(URL, name);
    }
  };
}

/** jsdom never loads images, so Radix's `AvatarImage` would wait forever without this. */
export function stubImageLoading() {
  const complete = jest.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
  const width = jest.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1);
  return () => {
    complete.mockRestore();
    width.mockRestore();
  };
}
```

Then delete both functions' local definitions from `student-form-dialog.test.tsx` and `staff-form-dialog.test.tsx`, importing them from `@/test-utils` instead (same call sites, no other change — this is a pure dedup, not a behavior change to either file's existing tests). Add both files to this task's `git add` list (Step 7) alongside everything else, since this is a small mechanical cleanup that belongs in the same commit as the component that triggered the third/fourth copy, not a follow-up.

Write `apps/dashboard/src/components/__tests__/photo-upload-field.test.tsx` next — a minimal host component supplies the `form`, since this field is never rendered on its own in real use:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { Form } from "@schoolhub/ui";

import { Services } from "@/services";
import { renderWithProviders, stubImageLoading, stubObjectUrls } from "@/test-utils";

import { PhotoUploadField, type PhotoUploadFieldValues } from "../photo-upload-field";

jest.mock("@/services", () => ({
  Services: { files: { uploadFile: jest.fn() } },
}));

const mockUploadFile = Services.files.uploadFile as jest.MockedFunction<
  typeof Services.files.uploadFile
>;

function TestHost({
  uploadPurpose = "guardian.photo",
  savedPhotoFileId,
  savedPhotoUrl,
  onUploadingChange = jest.fn(),
}: {
  uploadPurpose?: string;
  savedPhotoFileId?: string | null;
  savedPhotoUrl?: string | null;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const form = useForm<PhotoUploadFieldValues>({
    defaultValues: { first_name: "Ayesha", last_name: "Raza", photo_file_id: savedPhotoFileId ?? "" },
  });
  return (
    <Form {...form}>
      <PhotoUploadField
        form={form}
        uploadPurpose={uploadPurpose}
        savedPhotoFileId={savedPhotoFileId}
        savedPhotoUrl={savedPhotoUrl}
        onUploadStart={() => () => true}
        onUploadingChange={onUploadingChange}
      />
    </Form>
  );
}

describe("PhotoUploadField", () => {
  beforeEach(() => {
    mockUploadFile.mockReset();
  });

  it("uploads the picked file with the given purpose and sets photo_file_id on success", async () => {
    mockUploadFile.mockResolvedValue("file-123");
    const restoreObjectUrls = stubObjectUrls("blob:new-photo");

    renderWithProviders(<TestHost uploadPurpose="guardian.photo" />);
    await userEvent.upload(
      screen.getByLabelText(/photo/i),
      new File(["x"], "photo.jpg", { type: "image/jpeg" }),
    );

    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledWith(expect.any(File), "guardian.photo");
    });
    restoreObjectUrls();
  });

  it("shows the upload's real error message on failure", async () => {
    mockUploadFile.mockRejectedValue(
      new Error("'image/gif' is not allowed for 'guardian.photo' uploads."),
    );
    const restoreObjectUrls = stubObjectUrls("blob:rejected-photo");

    renderWithProviders(<TestHost uploadPurpose="guardian.photo" />);
    await userEvent.upload(
      screen.getByLabelText(/photo/i),
      new File(["x"], "photo.gif", { type: "image/gif" }),
    );

    expect(
      await screen.findByText("'image/gif' is not allowed for 'guardian.photo' uploads."),
    ).toBeInTheDocument();
    restoreObjectUrls();
  });

  it("previews the saved photo when photo_file_id matches the saved record", () => {
    // jsdom never loads images, so Radix's `AvatarImage` would wait forever without this
    // stub (same `stubImageLoading` pattern `student-form-dialog.test.tsx` already uses).
    // Queried via a plain CSS selector, not `getByRole("img")`: the component's
    // `AvatarImage` sets `alt=""` deliberately (decorative — the fallback initials are
    // the real accessible content), which computes an accessibility role of
    // "presentation", not "img".
    const restoreImageLoading = stubImageLoading();
    const { container } = renderWithProviders(
      <TestHost savedPhotoFileId="file-1" savedPhotoUrl="https://storage.test/ayesha.png" />,
    );

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://storage.test/ayesha.png",
    );
    restoreImageLoading();
  });
});
```

Implement `apps/dashboard/src/components/photo-upload-field.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@schoolhub/ui";
import { useWatch, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";

import { getInitials, stableSignedUrl } from "@/lib/helpers";
import { Services } from "@/services";

/** The minimal shape `PhotoUploadField` needs from any host form — both
 * `StudentFormValues` and `GuardianFormValues` satisfy this already, since both use the
 * API's own snake_case field names directly (Phase 1's established convention). */
export interface PhotoUploadFieldValues extends FieldValues {
  first_name: string;
  last_name: string;
  photo_file_id?: string;
}

export interface PhotoUploadFieldProps<TFieldValues extends PhotoUploadFieldValues> {
  form: UseFormReturn<TFieldValues>;
  /** A plain string, not a closed union — `@/components/` is outside any one feature, so
   * this never hardcodes which `core/files` purposes exist. The caller passes whichever
   * `Services.files.uploadFile` purpose its own form needs (`"student.photo"`,
   * `"guardian.photo"`, or a future one neither of today's callers knows about yet). */
  uploadPurpose: string;
  /** The saved record's own photo id/url, plain strings rather than a whole record —
   * this component has no business knowing `StudentRecord` from `GuardianRecord`.
   * Both `undefined` in create mode. */
  savedPhotoFileId?: string | null;
  savedPhotoUrl?: string | null;
  /** Called as an upload starts. The check it returns reports whether the dialog is still in
   * the same open session, for the same record, as when that upload started. */
  onUploadStart: () => () => boolean;
  /** Lets the dialog disable Save while an upload is in flight. Must be referentially
   * stable (pass a `useState` setter): it is an effect dependency below, and a new
   * identity every render would re-run that effect's cleanup mid-upload. */
  onUploadingChange: (uploading: boolean) => void;
}

/**
 * The shared photo picker: a preview (the freshly picked file, else the saved photo), the
 * three-step upload through `Services.files.uploadFile`, and its own uploading/error
 * state. Extracted from the student form's original `StudentPhotoField` (Phase 1) — the
 * third near-identical copy (students, staff, guardians) is this repo's own signal to
 * stop duplicating and share.
 *
 * The upload state lives here, not in the host dialog: a dialog that only mounts this
 * field while open starts it fresh on every open with no reset effect needed. Only "an
 * upload is in flight" is lifted, through `onUploadingChange`, because the dialog's Save
 * button needs it.
 */
export function PhotoUploadField<TFieldValues extends PhotoUploadFieldValues>({
  form,
  uploadPurpose,
  savedPhotoFileId,
  savedPhotoUrl,
  onUploadStart,
  onUploadingChange,
}: PhotoUploadFieldProps<TFieldValues>) {
  const t = useTranslations("common.photoUpload");
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [firstName, lastName, photoFileId] = useWatch({
    control: form.control,
    name: ["first_name", "last_name", "photo_file_id"] as Path<TFieldValues>[],
  }) as [string, string, string | undefined];

  // Only a still-mounted instance may report back to the dialog: an upload from a closed
  // session settling late must not re-enable Save while the next session's own upload is in
  // flight. Set inside the effect, not at init, so React's dev-mode remount restores it.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Unmounting mid-upload (the dialog closed) must not leave Save disabled.
      onUploadingChange(false);
    };
  }, [onUploadingChange]);

  // Revokes each object URL once a newer one (or none) replaces it, and the last on unmount.
  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    };
  }, [localPreviewUrl]);

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Lets the same file be picked again after a failure — an unchanged value fires no event.
    event.target.value = "";
    if (!file) return;

    const isCurrentSession = onUploadStart();
    setLocalPreviewUrl(URL.createObjectURL(file));
    setUploadStatus("uploading");
    setUploadError(null);
    onUploadingChange(true);

    let outcome: { fileId: string } | { error: string };
    try {
      outcome = { fileId: await Services.files.uploadFile(file, uploadPurpose) };
    } catch (error) {
      // `uploadFile` rejects with a `FileUploadError` whose message is already specific: the
      // backend's own validation text (a disallowed type, a size limit), or the failed step.
      outcome = { error: error instanceof Error ? error.message : t("uploadFailed") };
    }

    if (!mountedRef.current) return;
    onUploadingChange(false);
    // One guard for both outcomes: a result from an earlier open session, or for a different
    // record, is dropped whether it succeeded or failed — never written into this form and
    // never shown as this session's error.
    if (!isCurrentSession()) {
      setUploadStatus("idle");
      setLocalPreviewUrl(null);
      return;
    }
    if ("fileId" in outcome) {
      form.setValue("photo_file_id" as Path<TFieldValues>, outcome.fileId as never, {
        shouldDirty: true,
      });
      setUploadStatus("idle");
    } else {
      setUploadStatus("error");
      setUploadError(outcome.error);
      // The picked file never landed, so the preview goes back to what Save would keep.
      setLocalPreviewUrl(null);
    }
  }

  // The saved photo, until a replacement is picked: once `photo_file_id` no longer matches
  // the record's, the saved link is for the old photo.
  const resolvedSavedUrl =
    savedPhotoFileId !== undefined && photoFileId === (savedPhotoFileId ?? "")
      ? stableSignedUrl(savedPhotoUrl ?? null)
      : null;
  const previewUrl = localPreviewUrl ?? resolvedSavedUrl;

  return (
    <FormField
      control={form.control}
      name={"photo_file_id" as Path<TFieldValues>}
      render={() => (
        <FormItem>
          <FormLabel>{t("photo")}</FormLabel>
          <div className="flex items-center gap-3">
            <Avatar className="size-12 shrink-0">
              {previewUrl ? <AvatarImage src={previewUrl} alt="" /> : null}
              <AvatarFallback>{getInitials(`${firstName} ${lastName}`)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 space-y-1">
              <FormControl>
                <Input
                  type="file"
                  accept="image/jpeg,image/png"
                  disabled={uploadStatus === "uploading"}
                  onChange={(event) => {
                    void handlePhotoChange(event);
                  }}
                />
              </FormControl>
              {uploadStatus === "uploading" ? (
                <p className="text-xs text-muted-foreground">{t("uploading")}</p>
              ) : null}
              {uploadStatus === "error" && uploadError ? (
                <p className="text-xs text-destructive" role="alert">
                  {uploadError}
                </p>
              ) : null}
              {uploadStatus !== "uploading" && !previewUrl && photoFileId ? (
                <p className="text-xs text-muted-foreground">{t("onFile")}</p>
              ) : null}
            </div>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
```

(Reads `common.photoUpload.photo`/`uploading`/`onFile`/`uploadFailed` (Task 4, Step 7) — a shared namespace, since this file lives outside `features/students/` and must not assume a `students`-specific `useTranslations` scope is even available to it. `StudentPhotoField`'s own wrapper (Step 2) keeps using the existing `students.fields.*` copy for anything that stays student-specific.)

- [ ] **Step 2: Turn `student-photo-field.tsx` into a thin wrapper**

Replace its body (keeping the same exported `StudentPhotoField`/`StudentPhotoFieldProps` names and call sites in `student-form-dialog.tsx` unchanged — this is a pure internal refactor):

```tsx
"use client";

import type { UseFormReturn } from "react-hook-form";
import type { StudentRecord } from "@/services";
import { PhotoUploadField } from "@/components/photo-upload-field";
import type { StudentFormValues } from "./student-form-schema";

export interface StudentPhotoFieldProps {
  form: UseFormReturn<StudentFormValues>;
  savedRecord?: StudentRecord;
  onUploadStart: () => () => boolean;
  onUploadingChange: (uploading: boolean) => void;
}

/** Thin wrapper around the shared `PhotoUploadField`, fixed to the student purpose and
 * `StudentRecord`'s own saved-photo fields. */
export function StudentPhotoField({
  form,
  savedRecord,
  onUploadStart,
  onUploadingChange,
}: StudentPhotoFieldProps) {
  return (
    <PhotoUploadField
      form={form}
      uploadPurpose="student.photo"
      savedPhotoFileId={savedRecord?.photo_file_id}
      savedPhotoUrl={savedRecord?.photo_url}
      onUploadStart={onUploadStart}
      onUploadingChange={onUploadingChange}
    />
  );
}
```

Its existing test file keeps the same test cases (they exercise behavior through this wrapper exactly as they did before — nothing about `StudentPhotoField`'s external behavior changes) but now implicitly covers `PhotoUploadField` as well; `photo-upload-field.test.tsx` (Step 1) adds the cases that are easiest to prove generically (e.g. the purpose string actually reaching `Services.files.uploadFile`) rather than duplicating every student-specific case.

- [ ] **Step 3: Confirm `guardianFormSchema` already exists (Task 2), and add the shared `applyServerFieldErrors` helper**

The guardian form's Zod schema (`guardianFormSchema`/`GuardianFormValues`) is NOT declared here — it lives in `apps/dashboard/src/services/modules/guardians/guardians.schema.ts` (Task 2, Step 4c), per [ADR-0019](../../decisions/0019-every-module-uses-the-five-file-shape.md): a new domain's five-file shape includes its own `.schema.ts` from creation, and `Services.guardians` is a brand-new domain as of this plan. This also lets Task 6's picker import the exact same schema for its inline create-tab, rather than reaching into this component file for it (the round-3 review's own finding: a component importing another component's exported schema is precisely the cross-module reach [ADR-0018](../../decisions/0018-per-module-file-split-for-growing-domains.md)/ADR-0019 mean to prevent). `PhotoUploadField` (Step 1) never needs this schema either way, since it's generic over any form matching `PhotoUploadFieldValues`, not tied to `GuardianFormValues` specifically.

This dialog and Task 7's `GuardianLinkFlagsDialog` both map a `422`'s per-field `error.fieldErrors()` onto their own `react-hook-form` instance, falling back to a dialog-level alert when nothing matches — identical logic, two copies. Add a shared helper to the existing `apps/dashboard/src/lib/error-message.ts` (alongside `resolveErrorMessage`, which it reuses for the fallback case):

```ts
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";

/**
 * Maps a failed mutation's server field errors onto a react-hook-form instance, falling
 * back to a dialog-level message when nothing matches a known field — the one mapping
 * loop every form dialog in this module needs, instead of each redeclaring it.
 */
export function applyServerFieldErrors<TValues extends FieldValues>({
  error,
  form,
  knownFields,
  tErrors,
  fallback,
  setFormError,
}: {
  error: unknown;
  form: Pick<UseFormReturn<TValues>, "setError" | "clearErrors">;
  knownFields: readonly string[];
  tErrors: ErrorCodeTranslator;
  fallback: string;
  setFormError: (message: string | null) => void;
}): void {
  setFormError(null);
  form.clearErrors();
  if (!(error instanceof ApiError)) {
    setFormError(fallback);
    return;
  }
  let matchedAField = false;
  for (const [field, issue] of Object.entries(error.fieldErrors())) {
    if (field !== "non_field" && knownFields.includes(field)) {
      form.setError(field as Path<TValues>, { type: "server", message: issue });
      matchedAField = true;
    }
  }
  if (!matchedAField) {
    setFormError(resolveErrorMessage(error, tErrors, fallback, "non_field"));
  }
}
```

(`ApiError` is already imported at the top of `error-message.ts` for `resolveErrorMessage`'s own `instanceof` check — reuse it, don't re-import. `knownFields` is passed as `Object.keys(someSchema.shape)` by each caller, rather than this helper importing a specific schema, so it stays generic across every form that uses it.)

Add a matching test to `apps/dashboard/src/lib/__tests__/error-message.test.ts`: a minimal `form` stub (`{ setError: jest.fn(), clearErrors: jest.fn() }`) confirms a matched field calls `setError` with that field and skips `setFormError`, and an unmatched field calls `setFormError` with the resolved message instead.

- [ ] **Step 4: Write the failing tests**

```tsx
import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import type { GuardianRecord } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { GuardianFormDialog } from "../guardian-form-dialog";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    guardians: { createGuardian: jest.fn(), updateGuardian: jest.fn() },
    files: { uploadFile: jest.fn() },
  },
}));

const mockCreateGuardian = Services.guardians.createGuardian as jest.MockedFunction<
  typeof Services.guardians.createGuardian
>;
const mockUpdateGuardian = Services.guardians.updateGuardian as jest.MockedFunction<
  typeof Services.guardians.updateGuardian
>;

function guardianRecord(overrides: Partial<GuardianRecord> = {}): GuardianRecord {
  return {
    id: "g1",
    user_id: null,
    first_name: "Ayesha",
    last_name: "Raza",
    phone: "0300-0000000",
    alt_phone: null,
    email: null,
    occupation: null,
    employer: null,
    national_id: null,
    photo_file_id: null,
    photo_url: null,
    address: null,
    custom_fields: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("GuardianFormDialog", () => {
  const onOpenChange = jest.fn();
  const onSaved = jest.fn();

  beforeEach(() => {
    mockCreateGuardian.mockReset();
    mockUpdateGuardian.mockReset();
    onOpenChange.mockReset();
    onSaved.mockReset();
  });

  it("creates a guardian with the required fields and calls onSaved", async () => {
    mockCreateGuardian.mockResolvedValue(guardianRecord());
    const user = userEvent.setup();

    renderWithProviders(
      <GuardianFormDialog open mode="create" onOpenChange={onOpenChange} onSaved={onSaved} />,
    );

    await user.type(screen.getByLabelText(/first name/i), "Ayesha");
    await user.type(screen.getByLabelText(/last name/i), "Raza");
    await user.type(screen.getByLabelText(/^phone$/i), "0300-0000000");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mockCreateGuardian).toHaveBeenCalledWith({
        firstName: "Ayesha",
        lastName: "Raza",
        phone: "0300-0000000",
      });
    });
    expect(onSaved).toHaveBeenCalledWith(guardianRecord());
  });

  it("blocks submission when a required field is empty", async () => {
    renderWithProviders(
      <GuardianFormDialog open mode="create" onOpenChange={onOpenChange} onSaved={onSaved} />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: /save/i }));

    expect(mockCreateGuardian).not.toHaveBeenCalled();
  });

  it("pre-fills from the given record in edit mode and PATCHes only on submit", async () => {
    const record = guardianRecord({ alt_phone: "0300-1111111" });

    renderWithProviders(
      <GuardianFormDialog
        open
        mode="edit"
        guardian={record}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    );

    expect(screen.getByDisplayValue("Ayesha")).toBeInTheDocument();
    expect(screen.getByDisplayValue("0300-1111111")).toBeInTheDocument();

    mockUpdateGuardian.mockResolvedValue(guardianRecord({ phone: "0300-9999999" }));
    const phoneInput = screen.getByLabelText(/^phone$/i);
    await userEvent.setup().clear(phoneInput);
    await userEvent.setup().type(phoneInput, "0300-9999999");
    await userEvent.setup().click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mockUpdateGuardian).toHaveBeenCalledWith(
        "g1",
        expect.objectContaining({ phone: "0300-9999999" }),
      );
    });
  });

  it("clearing an optional field in edit mode sends an explicit empty value, not an omission", async () => {
    const record = guardianRecord({ alt_phone: "0300-1111111" });
    mockUpdateGuardian.mockResolvedValue(guardianRecord({ alt_phone: "" }));

    renderWithProviders(
      <GuardianFormDialog
        open
        mode="edit"
        guardian={record}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    );

    await userEvent.setup().clear(screen.getByLabelText(/alternate phone/i));
    await userEvent.setup().click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mockUpdateGuardian).toHaveBeenCalledWith("g1", expect.objectContaining({ altPhone: "" }));
    });
  });

  it("shows the server's real error when creating fails", async () => {
    mockCreateGuardian.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "Validation failed.",
        status: 422,
        url: "/guardians",
        details: [{ field: "phone", issue: "Enter a valid phone number." }],
      }),
    );

    renderWithProviders(
      <GuardianFormDialog open mode="create" onOpenChange={onOpenChange} onSaved={onSaved} />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/first name/i), "Ayesha");
    await user.type(screen.getByLabelText(/last name/i), "Raza");
    await user.type(screen.getByLabelText(/^phone$/i), "bad");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText("Enter a valid phone number.")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Confirm the tests fail by construction, then write `guardian-form-dialog.tsx`**

Split into an outer shell and an inner form body that only mounts while `open` is true, keyed by which guardian (if any) is being edited. This is the fix this plan's independent review asked for in place of a `useEffect` + `// eslint-disable-next-line react-hooks/set-state-in-effect` reset (a new suppression this plan must not add — ADR-0014's baseline only shrinks): remounting the inner component via `key` gives every open a fresh `useForm()` call with the right `defaultValues`, with no reset effect needed at all.

```tsx
"use client";

import { useRef, useState, type SyntheticEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import {
  Alert,
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@schoolhub/ui";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { useIsDesktopShell } from "@/hooks/use-is-desktop-shell";
import { applyServerFieldErrors } from "@/lib/error-message";
import { Services } from "@/services";
import type { GuardianRecord } from "@/services";
import { formValuesToCreateGuardianInput } from "@/services/modules/guardians/guardians-helper";
import {
  guardianFormSchema,
  type GuardianFormValues,
} from "@/services/modules/guardians/guardians.schema";
import { PhotoUploadField } from "@/components/photo-upload-field";

const EMPTY_DEFAULTS: GuardianFormValues = {
  first_name: "",
  last_name: "",
  phone: "",
  alt_phone: "",
  email: "",
  photo_file_id: "",
};

function toFormValues(guardian: GuardianRecord): GuardianFormValues {
  return {
    first_name: guardian.first_name,
    last_name: guardian.last_name,
    phone: guardian.phone,
    alt_phone: guardian.alt_phone ?? "",
    email: guardian.email ?? "",
    photo_file_id: guardian.photo_file_id ?? "",
  };
}

export interface GuardianFormFieldsProps {
  form: UseFormReturn<GuardianFormValues>;
  /** The saved guardian's own photo id/url — omitted entirely (both `undefined`) when
   * there is no existing guardian yet, i.e. every call from the picker's create-tab. */
  savedPhotoFileId?: string | null;
  savedPhotoUrl?: string | null;
  onUploadStart: () => () => boolean;
  onUploadingChange: (uploading: boolean) => void;
}

/** The guardian person-fields themselves (first/last name, phone, alt phone, email,
 * photo) — exported so `GuardianPickerDialog`'s (Task 6) inline create-tab can render
 * the exact same fields without nesting a second `ResponsiveDialog` inside its own (not
 * supported on mobile — see this plan's Alternatives Considered). `GuardianFormBody`
 * below is this component plus the dialog chrome (title/footer/mutation) around it; the
 * picker's create-tab supplies its own chrome instead. Both live in `features/students/`,
 * so this is a same-feature import, not a cross-module one. */
export function GuardianFormFields({
  form,
  savedPhotoFileId,
  savedPhotoUrl,
  onUploadStart,
  onUploadingChange,
}: GuardianFormFieldsProps) {
  const t = useTranslations("students");
  return (
    <>
      <FormField
        control={form.control}
        name="first_name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("guardians.fields.firstName")}</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="last_name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("guardians.fields.lastName")}</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="phone"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("guardians.fields.phone")}</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="alt_phone"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("guardians.fields.altPhone")}</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("guardians.fields.email")}</FormLabel>
            <FormControl>
              <Input type="email" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <PhotoUploadField
        form={form}
        uploadPurpose="guardian.photo"
        savedPhotoFileId={savedPhotoFileId}
        savedPhotoUrl={savedPhotoUrl}
        onUploadStart={onUploadStart}
        onUploadingChange={onUploadingChange}
      />
    </>
  );
}

export interface GuardianFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  /** Required when `mode === "edit"` — this dialog never fetches a guardian itself; the
   * caller already has the record (from the tab's own guardian-details fan-out, or from
   * a just-created guardian in the picker flow). */
  guardian?: GuardianRecord;
  onSaved: (guardian: GuardianRecord) => void;
}

/** The shell: owns `ResponsiveDialog`'s open state and nothing else. `GuardianFormBody`
 * only mounts while `open` is true, keyed by the guardian's id (or `"create"`) — so
 * switching from editing one guardian to another, or from edit to create, always starts
 * a fresh form instance with the right defaults, with no reset effect. */
export function GuardianFormDialog({
  open,
  onOpenChange,
  mode,
  guardian,
  onSaved,
}: GuardianFormDialogProps) {
  const tCommon = useTranslations("common");
  const t = useTranslations("students");
  const isMobile = !useIsDesktopShell();

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {mode === "create" ? t("guardians.createNew") : t("guardians.editGuardianTitle")}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {open ? (
          <GuardianFormBody
            key={mode === "edit" ? guardian?.id : "create"}
            mode={mode}
            guardian={guardian}
            isMobile={isMobile}
            onOpenChange={onOpenChange}
            onSaved={onSaved}
          />
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

interface GuardianFormBodyProps {
  mode: "create" | "edit";
  guardian?: GuardianRecord;
  isMobile: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (guardian: GuardianRecord) => void;
}

function GuardianFormBody({
  mode,
  guardian,
  isMobile,
  onOpenChange,
  onSaved,
}: GuardianFormBodyProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");

  // Captured once per mount (this component remounts fresh on every open — see the
  // `key` at the call site), so every upload from this open session shares one id; a
  // result settling after this instance has already unmounted is simply dropped by
  // `PhotoUploadField`'s own `mountedRef` check, with nothing here to coordinate.
  const openSessionRef = useRef(Symbol("guardian-form-open"));
  const isSubmittingRef = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPhotoUploading, setIsPhotoUploading] = useState(false);

  const form = useForm<GuardianFormValues>({
    resolver: zodResolver(guardianFormSchema),
    defaultValues: mode === "edit" && guardian ? toFormValues(guardian) : EMPTY_DEFAULTS,
  });

  const mutation = useMutation({
    mutationFn: (values: GuardianFormValues) => {
      if (mode === "create") {
        return Services.guardians.createGuardian(formValuesToCreateGuardianInput(values));
      }
      // Edit: alt_phone/email are sent as-given, including an explicit empty string —
      // not gated on truthiness like create's omit-if-empty above. A truthiness gate
      // here would mean clearing one of these back to empty silently does nothing,
      // since an omitted field means "leave unchanged" to `updateGuardian`'s own
      // `toUpdateGuardianBody` (`guardians-helper.ts`), which gates on `!== undefined`.
      const input = {
        firstName: values.first_name,
        lastName: values.last_name,
        phone: values.phone,
        altPhone: values.alt_phone,
        email: values.email,
        ...(values.photo_file_id ? { photoFileId: values.photo_file_id } : {}),
      };
      return Services.guardians.updateGuardian((guardian as GuardianRecord).id, input);
    },
    onSuccess: (saved) => {
      onOpenChange(false);
      onSaved(saved);
    },
    onError: (error) => {
      applyServerFieldErrors({
        error,
        form,
        knownFields: Object.keys(guardianFormSchema.shape),
        tErrors,
        fallback: t("form.submitFailed"),
        setFormError,
      });
    },
  });

  function captureUploadSession() {
    const uploadSession = openSessionRef.current;
    return () => openSessionRef.current === uploadSession;
  }

  function onSubmit(event: SyntheticEvent) {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    form
      .handleSubmit(
        (values) => {
          mutation.mutate(values, { onSettled: () => (isSubmittingRef.current = false) });
        },
        () => {
          isSubmittingRef.current = false;
        },
      )(event)
      .catch((error: unknown) => {
        isSubmittingRef.current = false;
        console.error(error);
      });
  }

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={onSubmit}
        className={isMobile ? "flex min-h-0 grow flex-col" : undefined}
      >
        <ResponsiveDialogBody
          className={
            isMobile ? "space-y-4 overflow-y-auto" : "max-h-[65vh] space-y-4 overflow-y-auto pe-1"
          }
        >
          {formError && <Alert variant="destructive">{formError}</Alert>}
          <GuardianFormFields
            form={form}
            savedPhotoFileId={mode === "edit" ? guardian?.photo_file_id : undefined}
            savedPhotoUrl={mode === "edit" ? guardian?.photo_url : undefined}
            onUploadStart={captureUploadSession}
            onUploadingChange={setIsPhotoUploading}
          />
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="submit"
            isLoading={mutation.isPending || isPhotoUploading}
            loadingLabel={t("guardians.submitting")}
          >
            {tCommon("save")}
          </Button>
        </ResponsiveDialogFooter>
      </form>
    </Form>
  );
}
```

- [ ] **Step 6: Confirm the tests pass by construction**

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/components/photo-upload-field.tsx apps/dashboard/src/components/__tests__/photo-upload-field.test.tsx apps/dashboard/src/features/students/student-photo-field.tsx apps/dashboard/src/features/students/__tests__/student-photo-field.test.tsx apps/dashboard/src/test-utils.tsx apps/dashboard/src/features/students/__tests__/student-form-dialog.test.tsx apps/dashboard/src/features/staff/__tests__/staff-form-dialog.test.tsx apps/dashboard/src/lib/error-message.ts apps/dashboard/src/lib/__tests__/error-message.test.ts apps/dashboard/src/features/students/guardian-form-dialog.tsx apps/dashboard/src/features/students/__tests__/guardian-form-dialog.test.tsx
git commit -m "feat(dashboard): add the shared PhotoUploadField and the guardian create/edit form dialog"
```

- [ ] **Step 8: Push and read CI**

---

## Task 6: `GuardianPickerDialog` (search-existing or create-new, then link)

**Files:**
- Create: `apps/dashboard/src/features/students/guardian-picker-dialog.tsx`
- Create: `apps/dashboard/src/features/students/__tests__/guardian-picker-dialog.test.tsx`

**Interfaces:**
- Consumes: `Services.guardians.{searchGuardians,createGuardian,linkGuardianToStudent}` (Task 2), `guardianFormSchema`/`GuardianFormValues` (Task 2's `guardians.schema.ts`, imported directly by path), `GuardianFormFields` (Task 5's `guardian-form-dialog.tsx` — the guardian person-fields JSX, reused as-is for this dialog's own inline create-tab; this task deliberately does NOT render the whole `GuardianFormDialog` component, to avoid nesting one `ResponsiveDialog` inside another), `RELATIONSHIP_VALUES` (`@schoolhub/types`, Task 2's Step 7), `useDebouncedValue` (`@/hooks/use-debounced-value`, already exists).
- Produces: `GuardianPickerDialog({ open, onOpenChange, studentId, excludedGuardianIds, isFirstGuardian, onLinked })`. `excludedGuardianIds` (the student's already-linked guardians' ids) hides them from search results, since linking one again would only ever hit the backend's duplicate-link conflict. `isFirstGuardian` is `true` when the student currently has zero links, so the very first guardian linked becomes primary by default (module doc §11), not left for the user to remember to set via a separate action. `onLinked()` fires after a successful link (no payload — the caller just needs to know to refetch). Consumed by Task 7, which supplies both new props from the links list it already has.

One `ResponsiveDialog`, two internal steps — never a dialog nested inside another. `ResponsiveDialog` wraps a Radix `Dialog` on desktop and a `vaul` `Drawer` on mobile; nesting a second `ResponsiveDialog` inside this one would need `Drawer.NestedRoot` on the mobile branch, which `packages/ui` doesn't expose (confirmed: no `NestedRoot` export anywhere in the package). So "create new" is not a nested `GuardianFormDialog` — it's the **choose** step's "Create new" tab, with the same fields (`guardianFormSchema`/`GuardianFormValues`, `PhotoUploadField`) inlined directly into this dialog, ending in its own `createMutation`. Either path out of the **choose** step — picking a search result, or successfully creating a guardian — sets one `selectedGuardian` state and advances to the **link** step (relationship + the four non-primary flags' defaults + "Link guardian"). This is also what makes linking retry-safe: if `linkMutation` fails after a guardian was just created, retrying only re-runs `linkMutation` — `selectedGuardian` already holds the created guardian's id, so nothing re-creates it.

- [ ] **Step 1: Write the failing tests**

```tsx
import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import type { GuardianRecord } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { GuardianPickerDialog } from "../guardian-picker-dialog";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    guardians: {
      searchGuardians: jest.fn(),
      createGuardian: jest.fn(),
      updateGuardian: jest.fn(),
      linkGuardianToStudent: jest.fn(),
    },
    files: { uploadFile: jest.fn() },
  },
}));

const mockSearchGuardians = Services.guardians.searchGuardians as jest.MockedFunction<
  typeof Services.guardians.searchGuardians
>;
const mockCreateGuardian = Services.guardians.createGuardian as jest.MockedFunction<
  typeof Services.guardians.createGuardian
>;
const mockLinkGuardianToStudent = Services.guardians.linkGuardianToStudent as jest.MockedFunction<
  typeof Services.guardians.linkGuardianToStudent
>;

function guardianRecord(overrides: Partial<GuardianRecord> = {}): GuardianRecord {
  return {
    id: "g1",
    user_id: null,
    first_name: "Ayesha",
    last_name: "Raza",
    phone: "0300-0000000",
    alt_phone: null,
    email: null,
    occupation: null,
    employer: null,
    national_id: null,
    photo_file_id: null,
    photo_url: null,
    address: null,
    custom_fields: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("GuardianPickerDialog", () => {
  const onOpenChange = jest.fn();
  const onLinked = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers({ advanceTimers: true });
    mockSearchGuardians.mockReset();
    mockCreateGuardian.mockReset();
    mockLinkGuardianToStudent.mockReset();
    onOpenChange.mockReset();
    onLinked.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("searches, selects a result, picks a relationship, and links", async () => {
    mockSearchGuardians.mockResolvedValue([guardianRecord()]);
    mockLinkGuardianToStudent.mockResolvedValue({ id: "link-1" } as never);
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    renderWithProviders(
      <GuardianPickerDialog
        open
        studentId="student-1"
        onOpenChange={onOpenChange}
        onLinked={onLinked}
      />,
    );

    await user.type(screen.getByLabelText(/search by name or phone/i), "Ayesha");
    await waitFor(() => {
      expect(mockSearchGuardians).toHaveBeenCalledWith("Ayesha");
    });
    // The results Select renders its options only once opened (Radix mounts
    // SelectContent in a portal on open) — the trigger's own accessible name is the
    // "search existing" tab label (the component's own comment on SelectTrigger explains
    // why), distinct from the plain-text search input above.
    await user.click(await screen.findByRole("combobox", { name: /search existing/i }));
    await user.click(await screen.findByRole("option", { name: /ayesha raza/i }));
    await user.click(screen.getByRole("combobox", { name: /relationship/i }));
    await user.click(screen.getByRole("option", { name: /^mother$/i }));
    await user.click(screen.getByRole("button", { name: /link guardian/i }));

    await waitFor(() => {
      expect(mockLinkGuardianToStudent).toHaveBeenCalledWith(
        "student-1",
        expect.objectContaining({
          guardianId: "g1",
          relationship: "mother",
          isPrimary: false,
          isFeeResponsible: false,
          canPickUp: true,
          receivesCommunications: true,
          hasPortalAccess: true,
        }),
      );
    });
    expect(onLinked).toHaveBeenCalled();
  });

  it("shows no-results copy when a search matches nothing, with create-new still reachable", async () => {
    mockSearchGuardians.mockResolvedValue([]);
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    renderWithProviders(
      <GuardianPickerDialog
        open
        studentId="student-1"
        onOpenChange={onOpenChange}
        onLinked={onLinked}
      />,
    );

    await user.type(screen.getByLabelText(/search by name or phone/i), "Nobody");
    await waitFor(() => {
      expect(mockSearchGuardians).toHaveBeenCalledWith("Nobody");
    });
    // The real copy (Task 4, Step 5) — distinct from the Guardians tab's own
    // "No guardians linked yet." empty state and from common.noResults ("No records
    // found."), which belongs to table-style lists, not this search box.
    expect(await screen.findByText("No guardians match that search.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /create new/i })).toBeInTheDocument();
  });

  it("creates a new guardian from the inline create fields, then links it — and never re-creates on a link retry", async () => {
    mockCreateGuardian.mockResolvedValue(guardianRecord({ id: "g2", first_name: "Bilal" }));
    // First link attempt fails (e.g. a transient conflict); the user clicks "Link
    // guardian" again without the create step running a second time.
    mockLinkGuardianToStudent
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce({ id: "link-2" } as never);
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    renderWithProviders(
      <GuardianPickerDialog
        open
        studentId="student-1"
        onOpenChange={onOpenChange}
        onLinked={onLinked}
      />,
    );

    // The create-new tab's own fields, inlined into this same dialog — no nested dialog
    // (packages/ui's ResponsiveDialog has no supported nested-drawer pattern on mobile).
    await user.click(screen.getByRole("tab", { name: /create new/i }));
    await user.type(await screen.findByLabelText(/first name/i), "Bilal");
    await user.type(screen.getByLabelText(/last name/i), "Khan");
    await user.type(screen.getByLabelText(/^phone$/i), "0300-2222222");
    await user.click(screen.getByRole("button", { name: /create guardian/i }));

    await waitFor(() => {
      expect(mockCreateGuardian).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: "Bilal", lastName: "Khan" }),
      );
    });
    // The dialog advances to its link step: the just-created guardian is shown as
    // selected, the tabs are gone, and only the relationship remains to be picked.
    expect(await screen.findByText("Bilal Khan")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /create new/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: /relationship/i }));
    await user.click(screen.getByRole("option", { name: /^father$/i }));
    await user.click(screen.getByRole("button", { name: /link guardian/i }));
    await waitFor(() => {
      expect(mockLinkGuardianToStudent).toHaveBeenCalledTimes(1);
    });

    // Retry after the failure — createGuardian must not be called a second time.
    await user.click(screen.getByRole("button", { name: /link guardian/i }));
    await waitFor(() => {
      expect(mockLinkGuardianToStudent).toHaveBeenCalledTimes(2);
    });
    expect(mockCreateGuardian).toHaveBeenCalledTimes(1);
    expect(mockLinkGuardianToStudent).toHaveBeenLastCalledWith(
      "student-1",
      expect.objectContaining({ guardianId: "g2", relationship: "father" }),
    );
    expect(onLinked).toHaveBeenCalledTimes(1);
  });

  it("surfaces the server's real 409 when linking an already-linked guardian", async () => {
    mockSearchGuardians.mockResolvedValue([guardianRecord()]);
    // The real shape a duplicate link produces: StudentGuardian's UniqueConstraint ->
    // IntegrityError -> core/api/exceptions.py's 409 `conflict` mapping — not an
    // invented 422.
    mockLinkGuardianToStudent.mockRejectedValue(
      new ApiError({
        code: "conflict",
        message: "The request conflicts with existing data.",
        status: 409,
        url: "/students/student-1/guardians",
        details: [{ field: "non_field", issue: "The request conflicts with existing data." }],
      }),
    );
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    renderWithProviders(
      <GuardianPickerDialog
        open
        studentId="student-1"
        onOpenChange={onOpenChange}
        onLinked={onLinked}
      />,
    );

    await user.type(screen.getByLabelText(/search by name or phone/i), "Ayesha");
    await user.click(await screen.findByRole("combobox", { name: /search existing/i }));
    await user.click(await screen.findByRole("option", { name: /ayesha raza/i }));
    await user.click(screen.getByRole("combobox", { name: /relationship/i }));
    await user.click(screen.getByRole("option", { name: /^mother$/i }));
    await user.click(screen.getByRole("button", { name: /link guardian/i }));

    expect(
      await screen.findByText("The request conflicts with existing data."),
    ).toBeInTheDocument();
    expect(onLinked).not.toHaveBeenCalled();
  });

  it("excludes already-linked guardians from search results", async () => {
    mockSearchGuardians.mockResolvedValue([
      guardianRecord({ id: "g1", first_name: "Ayesha" }),
      guardianRecord({ id: "g3", first_name: "Zainab" }),
    ]);
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    renderWithProviders(
      <GuardianPickerDialog
        open
        studentId="student-1"
        excludedGuardianIds={["g1"]}
        onOpenChange={onOpenChange}
        onLinked={onLinked}
      />,
    );

    await user.type(screen.getByLabelText(/search by name or phone/i), "a");
    await waitFor(() => {
      expect(mockSearchGuardians).toHaveBeenCalled();
    });
    await user.click(await screen.findByRole("combobox", { name: /search existing/i }));
    expect(await screen.findByRole("option", { name: /zainab/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /ayesha/i })).not.toBeInTheDocument();
  });

  it("makes the first guardian linked primary by default", async () => {
    mockSearchGuardians.mockResolvedValue([guardianRecord()]);
    mockLinkGuardianToStudent.mockResolvedValue({ id: "link-1" } as never);
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    renderWithProviders(
      <GuardianPickerDialog
        open
        studentId="student-1"
        isFirstGuardian
        onOpenChange={onOpenChange}
        onLinked={onLinked}
      />,
    );

    await user.type(screen.getByLabelText(/search by name or phone/i), "Ayesha");
    await user.click(await screen.findByRole("combobox", { name: /search existing/i }));
    await user.click(await screen.findByRole("option", { name: /ayesha raza/i }));
    await user.click(screen.getByRole("combobox", { name: /relationship/i }));
    await user.click(screen.getByRole("option", { name: /^mother$/i }));
    await user.click(screen.getByRole("button", { name: /link guardian/i }));

    await waitFor(() => {
      expect(mockLinkGuardianToStudent).toHaveBeenCalledWith(
        "student-1",
        expect.objectContaining({ isPrimary: true }),
      );
    });
  });
});
```

- [ ] **Step 2: Confirm the tests fail by construction, then write `guardian-picker-dialog.tsx`**

Same shell/body split as `GuardianFormDialog` (Task 5): the outer component owns `ResponsiveDialog`'s open state only; the inner body mounts fresh (keyed by `studentId`) only while `open`, so there is no reset-on-close effect anywhere in this file. Internally the body has two steps — `"choose"` (search-or-create tabs) and `"link"` (selected guardian + relationship) — both rendered inside this one dialog, never a second nested one:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { RELATIONSHIP_VALUES, type RelationshipValue } from "@schoolhub/types";
import {
  Alert,
  Button,
  Form,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@schoolhub/ui";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { ApiError, Services } from "@/services";
import type { GuardianRecord } from "@/services";
import { formValuesToCreateGuardianInput } from "@/services/modules/guardians/guardians-helper";
import {
  guardianFormSchema,
  type GuardianFormValues,
} from "@/services/modules/guardians/guardians.schema";
import { GuardianFormFields } from "./guardian-form-dialog";

export interface GuardianPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  /** This student's already-linked guardians' ids — hidden from search results, since
   * picking one would only ever hit the backend's duplicate-link conflict. */
  excludedGuardianIds?: string[];
  /** `true` when the student currently has zero guardian links — the one being linked
   * now becomes primary by default (module doc §11), not left for a separate action. */
  isFirstGuardian?: boolean;
  onLinked: () => void;
}

export function GuardianPickerDialog({
  open,
  onOpenChange,
  studentId,
  excludedGuardianIds = [],
  isFirstGuardian = false,
  onLinked,
}: GuardianPickerDialogProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("guardians.link")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {open ? (
          <GuardianPickerBody
            key={studentId}
            studentId={studentId}
            excludedGuardianIds={excludedGuardianIds}
            isFirstGuardian={isFirstGuardian}
            onOpenChange={onOpenChange}
            onLinked={onLinked}
          />
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

interface GuardianPickerBodyProps {
  studentId: string;
  excludedGuardianIds: string[];
  isFirstGuardian: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: () => void;
}

const CREATE_DEFAULTS: GuardianFormValues = {
  first_name: "",
  last_name: "",
  phone: "",
  alt_phone: "",
  email: "",
  photo_file_id: "",
};

function GuardianPickerBody({
  studentId,
  excludedGuardianIds,
  isFirstGuardian,
  onOpenChange,
  onLinked,
}: GuardianPickerBodyProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  const [step, setStep] = useState<"choose" | "link">("choose");
  const [tab, setTab] = useState<"search" | "create">("search");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);
  const [selectedGuardian, setSelectedGuardian] = useState<GuardianRecord | null>(null);
  const [relationship, setRelationship] = useState<RelationshipValue | "">("");
  // Gates the "required" message below — without it, the message shows the instant this
  // step renders, before the user has had any chance to pick a relationship at all.
  const [linkAttempted, setLinkAttempted] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isPhotoUploading, setIsPhotoUploading] = useState(false);

  const excluded = new Set(excludedGuardianIds);
  const searchQuery = useQuery({
    queryKey: queryKeys.list("guardians", "search", { search }),
    queryFn: () => Services.guardians.searchGuardians(search),
    enabled: step === "choose" && tab === "search" && search.length > 0,
  });
  const searchResults = (searchQuery.data ?? []).filter((g) => !excluded.has(g.id));

  const createForm = useForm<GuardianFormValues>({
    resolver: zodResolver(guardianFormSchema),
    defaultValues: CREATE_DEFAULTS,
  });

  const createMutation = useMutation({
    mutationFn: (values: GuardianFormValues) =>
      Services.guardians.createGuardian(formValuesToCreateGuardianInput(values)),
    onSuccess: (created) => {
      setSelectedGuardian(created);
      setStep("link");
    },
    onError: (error) => {
      setCreateError(
        error instanceof ApiError
          ? resolveErrorMessage(error, tErrors, t("form.submitFailed"), "non_field")
          : t("form.submitFailed"),
      );
    },
  });

  const linkMutation = useMutation({
    mutationFn: async (guardianId: string) => {
      if (!relationship) throw new Error("relationship is required");
      return Services.guardians.linkGuardianToStudent(studentId, {
        guardianId,
        relationship,
        isPrimary: isFirstGuardian,
        isFeeResponsible: false,
        canPickUp: true,
        receivesCommunications: true,
        hasPortalAccess: true,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.list("students", "guardian-links", { studentId }),
      });
      onOpenChange(false);
      onLinked();
    },
    onError: (error) => {
      setLinkError(
        error instanceof ApiError
          ? resolveErrorMessage(error, tErrors, t("form.submitFailed"), "non_field")
          : t("form.submitFailed"),
      );
    },
  });

  function selectSearchResult(guardian: GuardianRecord) {
    setSelectedGuardian(guardian);
    setStep("link");
  }

  function backToChoose() {
    setStep("choose");
    setSelectedGuardian(null);
    setRelationship("");
    setLinkAttempted(false);
    setLinkError(null);
  }

  function handleLink() {
    setLinkAttempted(true);
    setLinkError(null);
    if (!relationship) return;
    if (selectedGuardian) linkMutation.mutate(selectedGuardian.id);
  }

  if (step === "link" && selectedGuardian) {
    return (
      <>
        <ResponsiveDialogBody className="space-y-4">
          {linkError && <Alert variant="destructive">{linkError}</Alert>}
          <div className="flex items-center justify-between rounded-md border p-3 text-sm">
            <span>
              {selectedGuardian.first_name} {selectedGuardian.last_name}
            </span>
            <Button type="button" variant="link" className="h-auto p-0" onClick={backToChoose}>
              {tCommon("edit")}
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="picker-relationship">{t("guardians.fields.relationship")}</Label>
            <Select
              value={relationship}
              onValueChange={(value) => setRelationship(value as RelationshipValue)}
            >
              <SelectTrigger id="picker-relationship" aria-label={t("guardians.fields.relationship")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RELATIONSHIP_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`guardians.relationship.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {linkAttempted && !relationship ? (
              <p className="text-sm text-destructive">{tCommon("requiredField")}</p>
            ) : null}
          </div>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            disabled={!relationship || linkMutation.isPending}
            isLoading={linkMutation.isPending}
            loadingLabel={t("guardians.linking")}
            onClick={handleLink}
          >
            {t("guardians.link")}
          </Button>
        </ResponsiveDialogFooter>
      </>
    );
  }

  return (
    <>
      <ResponsiveDialogBody className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("guardians.linkDescription")}</p>

        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as "search" | "create");
          }}
        >
          <TabsList variant="line">
            <TabsTrigger value="search">{t("guardians.searchExisting")}</TabsTrigger>
            <TabsTrigger value="create">{t("guardians.createNew")}</TabsTrigger>
          </TabsList>

          <TabsContent value="search" className="space-y-2">
            <Input
              aria-label={t("guardians.searchPlaceholder")}
              placeholder={t("guardians.searchPlaceholder")}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            {searchQuery.isFetching ? <Skeleton className="h-9 w-full" /> : null}
            {search.length > 0 && !searchQuery.isFetching && searchResults.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("guardians.searchEmpty")}</p>
            ) : null}
            {searchResults.length > 0 ? (
              <Select
                value=""
                onValueChange={(value) => {
                  const picked = searchResults.find((g) => g.id === value);
                  if (picked) selectSearchResult(picked);
                }}
              >
                {/* Distinct from the search input's own accessible name above, which
                 * describes typing a query, not choosing from its results. */}
                <SelectTrigger aria-label={t("guardians.searchExisting")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {searchResults.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.first_name} {g.last_name} · {g.phone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </TabsContent>

          <TabsContent value="create" className="space-y-3">
            {/* The create form's own fields, inlined — no nested dialog. Submitting
             * advances straight to the link step via createMutation's onSuccess above. */}
            <Form {...createForm}>
              <form
                noValidate
                onSubmit={createForm.handleSubmit((values) => {
                  setCreateError(null);
                  createMutation.mutate(values);
                })}
                className="space-y-3"
              >
                {createError && <Alert variant="destructive">{createError}</Alert>}
                <GuardianFormFields
                  form={createForm}
                  onUploadStart={() => () => true}
                  onUploadingChange={setIsPhotoUploading}
                />
                <Button
                  type="submit"
                  isLoading={createMutation.isPending || isPhotoUploading}
                  loadingLabel={t("guardians.submitting")}
                  className="w-full"
                >
                  {t("guardians.createGuardian")}
                </Button>
              </form>
            </Form>
          </TabsContent>
        </Tabs>
      </ResponsiveDialogBody>
      <ResponsiveDialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          {tCommon("cancel")}
        </Button>
      </ResponsiveDialogFooter>
    </>
  );
}
```

Add one new i18n key this inline form needs that the picker didn't before — `students.guardians.createGuardian` ("Create guardian"), distinct from `createNew` (the tab label) — fold it into Task 4's Step 2 (same place the other `GuardianFormDialog`-adjacent keys were added) rather than a separate i18n task here.

- [ ] **Step 3: Confirm the tests pass by construction**

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/features/students/guardian-picker-dialog.tsx apps/dashboard/src/features/students/__tests__/guardian-picker-dialog.test.tsx
git commit -m "feat(dashboard): add the guardian search-or-create linking dialog"
```

- [ ] **Step 5: Push and read CI**

---

## Task 7: `StudentGuardiansTab` + `GuardianLinkFlagsDialog`

**Files:**
- Modify: `apps/dashboard/src/services/modules/guardians/guardians.schema.ts` (add `linkFlagsSchema`)
- Create: `apps/dashboard/src/features/students/guardian-link-flags-dialog.tsx`
- Create: `apps/dashboard/src/features/students/student-guardians-tab.tsx`
- Create: `apps/dashboard/src/features/students/__tests__/guardian-link-flags-dialog.test.tsx`
- Create: `apps/dashboard/src/features/students/__tests__/student-guardians-tab.test.tsx`

**Interfaces:**
- Consumes: `Services.guardians.{fetchGuardianLinks,updateGuardianLink}` (Task 2), `GuardianFormDialog` (Task 5), `GuardianPickerDialog` (Task 6).
- Produces: `StudentGuardiansTab({ studentId, canCreate, canUpdate })`; `linkFlagsSchema`/`LinkFlagsFormValues`, added to Task 2's `guardians.schema.ts` (ADR-0019's five-file shape — this is a guardian-link form schema, the same domain `guardianFormSchema` already lives in, not inline in a component file). Consumed by Task 10.

- [ ] **Step 0: Add `linkFlagsSchema` to Task 2's `guardians.schema.ts`**

```ts
import { RELATIONSHIP_VALUES } from "@schoolhub/types";

// `relationship` has no `.optional()`/`.default()` — the Select always has a starting
// value from the link being edited, so an empty state (and the plain-required-field
// error that would need) never happens here, unlike the picker's own relationship step
// (Task 6), which starts genuinely unset.
export const linkFlagsSchema = z.object({
  relationship: z.enum(RELATIONSHIP_VALUES),
  isFeeResponsible: z.boolean(),
  canPickUp: z.boolean(),
  receivesCommunications: z.boolean(),
  hasPortalAccess: z.boolean(),
});

export type LinkFlagsFormValues = z.infer<typeof linkFlagsSchema>;
```

(`z` is already imported at the top of `guardians.schema.ts` for `guardianFormSchema` — reuse it.)

- [ ] **Step 1: Write `guardian-link-flags-dialog.tsx`'s failing tests**

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import type { GuardianLinkRecord } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { GuardianLinkFlagsDialog } from "../guardian-link-flags-dialog";

jest.mock("@/services", () => ({
  Services: { guardians: { updateGuardianLink: jest.fn() } },
}));

const mockUpdateGuardianLink = Services.guardians.updateGuardianLink as jest.MockedFunction<
  typeof Services.guardians.updateGuardianLink
>;

function linkRecord(overrides: Partial<GuardianLinkRecord> = {}): GuardianLinkRecord {
  return {
    id: "link-1",
    student_id: "student-1",
    guardian_id: "g1",
    relationship: "father",
    is_primary: false,
    is_fee_responsible: false,
    can_pick_up: true,
    receives_communications: true,
    has_portal_access: true,
    access_revoked_reason: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("GuardianLinkFlagsDialog", () => {
  const onOpenChange = jest.fn();
  const onSaved = jest.fn();

  beforeEach(() => {
    mockUpdateGuardianLink.mockReset();
    onOpenChange.mockReset();
    onSaved.mockReset();
  });

  it("pre-fills from the given link and PATCHes only the changed flags", async () => {
    mockUpdateGuardianLink.mockResolvedValue(linkRecord({ is_fee_responsible: true }));

    renderWithProviders(
      <GuardianLinkFlagsDialog
        open
        link={linkRecord()}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    );

    expect(screen.getByRole("checkbox", { name: /fee responsible/i })).not.toBeChecked();
    await userEvent.setup().click(screen.getByRole("checkbox", { name: /fee responsible/i }));
    await userEvent.setup().click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mockUpdateGuardianLink).toHaveBeenCalledWith(
        "link-1",
        expect.objectContaining({ isFeeResponsible: true }),
      );
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("never sends isPrimary — this dialog cannot promote or demote", async () => {
    mockUpdateGuardianLink.mockResolvedValue(linkRecord());

    renderWithProviders(
      <GuardianLinkFlagsDialog
        open
        link={linkRecord()}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    );

    expect(screen.queryByText(/primary/i)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mockUpdateGuardianLink).toHaveBeenCalled();
    });
    const [, body] = mockUpdateGuardianLink.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).not.toHaveProperty("isPrimary");
  });
});
```

- [ ] **Step 2: Confirm those tests fail by construction, then write `guardian-link-flags-dialog.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { RELATIONSHIP_VALUES } from "@schoolhub/types";
import {
  Alert,
  Button,
  Checkbox,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { applyServerFieldErrors } from "@/lib/error-message";
import { Services } from "@/services";
import type { GuardianLinkRecord } from "@/services";
import {
  linkFlagsSchema,
  type LinkFlagsFormValues,
} from "@/services/modules/guardians/guardians.schema";

const FLAG_FIELDS = [
  ["isFeeResponsible", "feeResponsible"],
  ["canPickUp", "canPickUp"],
  ["receivesCommunications", "receivesCommunications"],
  ["hasPortalAccess", "hasPortalAccess"],
] as const satisfies readonly [keyof LinkFlagsFormValues, string][];

function toFormValues(link: GuardianLinkRecord): LinkFlagsFormValues {
  return {
    relationship: link.relationship,
    isFeeResponsible: link.is_fee_responsible,
    canPickUp: link.can_pick_up,
    receivesCommunications: link.receives_communications,
    hasPortalAccess: link.has_portal_access,
  };
}

export interface GuardianLinkFlagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  link: GuardianLinkRecord;
  onSaved: () => void;
}

/**
 * Relationship + the four non-primary flags. `isPrimary` is deliberately never read or
 * written here — see this plan's Global Constraints on why promotion is its own
 * one-click row action, not a checkbox in this dialog.
 *
 * No reset-on-open effect: the caller (`student-guardians-tab.tsx`) only ever renders
 * this component at all while there is a link being edited (`{editingLink && <...>}`),
 * so every open is already a fresh mount — `useForm`'s `defaultValues` below already
 * gets the right starting values with no effect needed.
 */
export function GuardianLinkFlagsDialog({
  open,
  onOpenChange,
  link,
  onSaved,
}: GuardianLinkFlagsDialogProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");

  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<LinkFlagsFormValues>({
    resolver: zodResolver(linkFlagsSchema),
    defaultValues: toFormValues(link),
  });

  const mutation = useMutation({
    mutationFn: (values: LinkFlagsFormValues) =>
      Services.guardians.updateGuardianLink(link.id, values),
    onSuccess: () => {
      onOpenChange(false);
      onSaved();
    },
    onError: (error) => {
      // Same shared field-error-mapping helper as `GuardianFormDialog` (Task 5): a
      // matched field gets its own `FormMessage`; anything else falls back to the
      // dialog-level alert.
      applyServerFieldErrors({
        error,
        form,
        knownFields: Object.keys(linkFlagsSchema.shape),
        tErrors,
        fallback: t("form.submitFailed"),
        setFormError,
      });
    },
  });

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-md" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("guardians.editLinkTitle")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <Form {...form}>
          <form
            noValidate
            onSubmit={form.handleSubmit((values) => {
              mutation.mutate(values);
            })}
          >
            <ResponsiveDialogBody className="space-y-4">
              {formError && <Alert variant="destructive">{formError}</Alert>}
              <FormField
                control={form.control}
                name="relationship"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("guardians.fields.relationship")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger aria-label={t("guardians.fields.relationship")}>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {RELATIONSHIP_VALUES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(`guardians.relationship.${value}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {FLAG_FIELDS.map(([key, labelKey]) => (
                <FormField
                  key={key}
                  control={form.control}
                  name={key}
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center gap-2 space-y-0">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <FormLabel className="font-normal">
                        {t(`guardians.flags.${labelKey}`)}
                      </FormLabel>
                    </FormItem>
                  )}
                />
              ))}
            </ResponsiveDialogBody>
            <ResponsiveDialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                }}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                isLoading={mutation.isPending}
                loadingLabel={t("guardians.submitting")}
              >
                {tCommon("save")}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </Form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
```

- [ ] **Step 3: Confirm `guardian-link-flags-dialog.tsx`'s tests pass by construction, then commit it alone**

```bash
git add apps/dashboard/src/services/modules/guardians/guardians.schema.ts apps/dashboard/src/features/students/guardian-link-flags-dialog.tsx apps/dashboard/src/features/students/__tests__/guardian-link-flags-dialog.test.tsx
git commit -m "feat(dashboard): add the guardian link flags edit dialog"
```

- [ ] **Step 4: Write `student-guardians-tab.tsx`'s failing tests**

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { Services } from "@/services";
import type { GuardianLinkRecord, GuardianRecord } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { StudentGuardiansTab } from "../student-guardians-tab";

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    guardians: {
      fetchGuardianLinks: jest.fn(),
      fetchGuardianById: jest.fn(),
      updateGuardianLink: jest.fn(),
      updateGuardian: jest.fn(),
      searchGuardians: jest.fn(),
      createGuardian: jest.fn(),
      linkGuardianToStudent: jest.fn(),
    },
    files: { uploadFile: jest.fn() },
  },
}));

const mockFetchGuardianLinks = Services.guardians.fetchGuardianLinks as jest.MockedFunction<
  typeof Services.guardians.fetchGuardianLinks
>;
const mockFetchGuardianById = Services.guardians.fetchGuardianById as jest.MockedFunction<
  typeof Services.guardians.fetchGuardianById
>;
const mockUpdateGuardianLink = Services.guardians.updateGuardianLink as jest.MockedFunction<
  typeof Services.guardians.updateGuardianLink
>;
const mockToastError = toast.error as jest.MockedFunction<typeof toast.error>;

function linkRecord(overrides: Partial<GuardianLinkRecord> = {}): GuardianLinkRecord {
  return {
    id: "link-1",
    student_id: "student-1",
    guardian_id: "g1",
    relationship: "father",
    is_primary: false,
    is_fee_responsible: false,
    can_pick_up: true,
    receives_communications: true,
    has_portal_access: true,
    access_revoked_reason: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function guardianRecord(overrides: Partial<GuardianRecord> = {}): GuardianRecord {
  return {
    id: "g1",
    user_id: null,
    first_name: "Ayesha",
    last_name: "Raza",
    phone: "0300-0000000",
    alt_phone: null,
    email: null,
    occupation: null,
    employer: null,
    national_id: null,
    photo_file_id: null,
    photo_url: null,
    address: null,
    custom_fields: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("StudentGuardiansTab", () => {
  beforeEach(() => {
    mockFetchGuardianLinks.mockReset();
    mockFetchGuardianById.mockReset();
    mockUpdateGuardianLink.mockReset();
    mockToastError.mockReset();
  });

  it("shows empty copy when the student has no guardians linked", async () => {
    mockFetchGuardianLinks.mockResolvedValue([]);

    renderWithProviders(<StudentGuardiansTab studentId="student-1" canCreate canUpdate />);

    expect(await screen.findByText(/no guardians linked yet/i)).toBeInTheDocument();
  });

  it("shows a load-error state, distinct from the empty state, when the links fetch fails", async () => {
    mockFetchGuardianLinks.mockRejectedValue(new Error("network down"));

    renderWithProviders(<StudentGuardiansTab studentId="student-1" canCreate canUpdate />);

    expect(await screen.findByText(/couldn't load this student's guardians/i)).toBeInTheDocument();
    expect(screen.queryByText(/no guardians linked yet/i)).not.toBeInTheDocument();
  });

  it("lists a linked guardian with their relationship and flags, resolved through Services.guardians.fetchGuardianById", async () => {
    mockFetchGuardianLinks.mockResolvedValue([
      linkRecord({ is_fee_responsible: true, can_pick_up: true }),
    ]);
    mockFetchGuardianById.mockResolvedValue(guardianRecord());

    renderWithProviders(<StudentGuardiansTab studentId="student-1" canCreate canUpdate />);

    expect(await screen.findByText(/father/i)).toBeInTheDocument();
    expect(await screen.findByText(/ayesha raza/i)).toBeInTheDocument();
    expect(mockFetchGuardianById).toHaveBeenCalledWith("g1");
  });

  it("shows a per-row load-error with retry when a guardian lookup fails, not a stuck placeholder", async () => {
    mockFetchGuardianLinks.mockResolvedValue([linkRecord()]);
    mockFetchGuardianById.mockRejectedValueOnce(new Error("lookup failed"));
    mockFetchGuardianById.mockResolvedValueOnce(guardianRecord());

    renderWithProviders(<StudentGuardiansTab studentId="student-1" canCreate canUpdate />);

    expect(await screen.findByText(/couldn't load this guardian/i)).toBeInTheDocument();
    expect(screen.queryByText("…")).not.toBeInTheDocument();

    // The real retry-button copy: `common.retry` is "Try again", not "Retry".
    await userEvent.setup().click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => {
      expect(mockFetchGuardianById).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText(/ayesha raza/i)).toBeInTheDocument();
  });

  it("promotes a non-primary link to primary with one click, no dialog", async () => {
    mockFetchGuardianLinks.mockResolvedValue([linkRecord({ is_primary: false })]);
    mockFetchGuardianById.mockResolvedValue(guardianRecord());
    mockUpdateGuardianLink.mockResolvedValue(linkRecord({ is_primary: true }));

    renderWithProviders(<StudentGuardiansTab studentId="student-1" canCreate canUpdate />);

    const button = await screen.findByRole("button", { name: /make primary/i });
    await userEvent.setup().click(button);

    await waitFor(() => {
      expect(mockUpdateGuardianLink).toHaveBeenCalledWith("link-1", { isPrimary: true });
    });
  });

  it("shows a toast and leaves the row unchanged when promoting to primary fails", async () => {
    mockFetchGuardianLinks.mockResolvedValue([linkRecord({ is_primary: false })]);
    mockFetchGuardianById.mockResolvedValue(guardianRecord());
    mockUpdateGuardianLink.mockRejectedValue(new Error("server exploded"));

    renderWithProviders(<StudentGuardiansTab studentId="student-1" canCreate canUpdate />);

    await userEvent.setup().click(await screen.findByRole("button", { name: /make primary/i }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
    expect(screen.getByRole("button", { name: /make primary/i })).toBeInTheDocument();
  });

  it("hides every action for a caller without create/update permission", async () => {
    mockFetchGuardianLinks.mockResolvedValue([linkRecord()]);
    mockFetchGuardianById.mockResolvedValue(guardianRecord());

    renderWithProviders(
      <StudentGuardiansTab studentId="student-1" canCreate={false} canUpdate={false} />,
    );

    await screen.findByText(/father/i);
    expect(screen.queryByRole("button", { name: /link guardian/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /make primary/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit link/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Confirm the tests fail by construction, then write `student-guardians-tab.tsx`**

```tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryObserverResult,
} from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Badge, Button, Skeleton } from "@schoolhub/ui";

import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import type { GuardianLinkRecord, GuardianRecord } from "@/services";
import { GuardianFormDialog } from "./guardian-form-dialog";
import { GuardianLinkFlagsDialog } from "./guardian-link-flags-dialog";
import { GuardianPickerDialog } from "./guardian-picker-dialog";

const FLAG_LABELS: { key: keyof GuardianLinkRecord; labelKey: string }[] = [
  { key: "is_fee_responsible", labelKey: "feeResponsible" },
  { key: "can_pick_up", labelKey: "canPickUp" },
  { key: "receives_communications", labelKey: "receivesCommunications" },
  { key: "has_portal_access", labelKey: "hasPortalAccess" },
];

export interface StudentGuardiansTabProps {
  studentId: string;
  canCreate: boolean;
  canUpdate: boolean;
}

export function StudentGuardiansTab({ studentId, canCreate, canUpdate }: StudentGuardiansTabProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingGuardian, setEditingGuardian] = useState<GuardianRecord | null>(null);
  const [editingLink, setEditingLink] = useState<GuardianLinkRecord | null>(null);

  const linksQuery = useQuery({
    queryKey: queryKeys.list("students", "guardian-links", { studentId }),
    queryFn: () => Services.guardians.fetchGuardianLinks(studentId),
  });
  const links = linksQuery.data ?? [];

  // The link list never embeds the guardian's own name/phone (confirmed real API shape
  // — see this plan's Global Constraints) — fan out one GET per unique guardian id,
  // through `Services.guardians.fetchGuardianById` (Task 2), never a direct
  // `apiClient`/`endpoints` import inside this component (ADR-0011).
  // Memoized on `links`, not recomputed as a fresh array every render — `combine` below
  // closes over this, and TanStack Query's own guidance is that `combine` must be
  // referentially stable (wrap it in `useCallback`) or its memoization never holds.
  const guardianIds = useMemo(
    () => [...new Set(links.map((link) => link.guardian_id))],
    [links],
  );
  // `combine` turns N independent query results into one lookup this component actually
  // wants: per-id data where it resolved, and which ids failed — a bare useQueries array
  // forces re-deriving this from scratch on every render and makes it easy to drop a
  // failed lookup silently (the bug this exact shape was added to fix).
  const combineGuardianResults = useCallback(
    (results: QueryObserverResult<GuardianRecord>[]) => ({
      byId: new Map(
        results
          .map((result) => result.data)
          .filter((g): g is GuardianRecord => Boolean(g))
          .map((g) => [g.id, g] as const),
      ),
      failedIds: new Set(
        results
          .map((result, index) => (result.isError ? guardianIds[index] : null))
          .filter((id): id is string => id !== null),
      ),
      refetchAllFailed: () => {
        for (const result of results) {
          if (result.isError) void result.refetch();
        }
      },
    }),
    [guardianIds],
  );
  const guardianResults = useQueries({
    queries: guardianIds.map((guardianId) => ({
      queryKey: queryKeys.detail("guardians", "guardians", guardianId),
      queryFn: () => Services.guardians.fetchGuardianById(guardianId),
    })),
    combine: combineGuardianResults,
  });
  const guardiansById = guardianResults.byId;
  const failedGuardianIds = guardianResults.failedIds;
  const retryFailedGuardians = guardianResults.refetchAllFailed;

  function invalidateLinks() {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.list("students", "guardian-links", { studentId }),
    });
  }

  const promoteMutation = useMutation({
    mutationFn: (linkId: string) =>
      Services.guardians.updateGuardianLink(linkId, { isPrimary: true }),
    onSuccess: invalidateLinks,
    onError: (error) => {
      toast.error(resolveErrorMessage(error, tErrors, t("guardians.promoteFailed")));
    },
  });

  if (linksQuery.isPending) {
    return <Skeleton className="h-24 w-full" />;
  }

  if (linksQuery.isError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{t("guardians.loadError")}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void linksQuery.refetch();
          }}
        >
          {tCommon("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{t("guardians.title")}</h3>
        {canCreate && (
          <Button
            size="sm"
            onClick={() => {
              setPickerOpen(true);
            }}
          >
            {t("guardians.link")}
          </Button>
        )}
      </div>

      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("guardians.empty")}</p>
      ) : (
        <div className="space-y-3">
          {links.map((link) => {
            const guardian = guardiansById.get(link.guardian_id);
            const guardianFailed = failedGuardianIds.has(link.guardian_id);
            return (
              <div key={link.id} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    {guardianFailed ? (
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-destructive">{t("guardians.guardianLoadError")}</p>
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0"
                          onClick={retryFailedGuardians}
                        >
                          {tCommon("retry")}
                        </Button>
                      </div>
                    ) : guardian ? (
                      <p className="text-sm font-medium text-foreground">
                        {guardian.first_name} {guardian.last_name}
                      </p>
                    ) : (
                      <Skeleton className="h-4 w-32" />
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t(`guardians.relationship.${link.relationship}`)}
                      {guardian ? ` · ${guardian.phone}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {link.is_primary ? (
                      <Badge>{t("guardians.primary")}</Badge>
                    ) : (
                      canUpdate && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={promoteMutation.isPending}
                          onClick={() => {
                            promoteMutation.mutate(link.id);
                          }}
                        >
                          {t("guardians.makePrimary")}
                        </Button>
                      )
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {FLAG_LABELS.filter(({ key }) => link[key]).map(({ labelKey }) => (
                    <Badge key={labelKey} variant="outline">
                      {t(`guardians.flags.${labelKey}`)}
                    </Badge>
                  ))}
                </div>
                {canUpdate && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingLink(link);
                      }}
                    >
                      {t("guardians.editLinkTitle")}
                    </Button>
                    {guardian && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingGuardian(guardian);
                        }}
                      >
                        {t("guardians.editGuardianTitle")}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pickerOpen && (
        <GuardianPickerDialog
          open
          studentId={studentId}
          excludedGuardianIds={links.map((link) => link.guardian_id)}
          isFirstGuardian={links.length === 0}
          onOpenChange={(open) => {
            if (!open) setPickerOpen(false);
          }}
          onLinked={invalidateLinks}
        />
      )}
      {editingLink && (
        <GuardianLinkFlagsDialog
          open
          link={editingLink}
          onOpenChange={(open) => {
            if (!open) setEditingLink(null);
          }}
          onSaved={invalidateLinks}
        />
      )}
      {editingGuardian && (
        <GuardianFormDialog
          open
          mode="edit"
          guardian={editingGuardian}
          onOpenChange={(open) => {
            if (!open) setEditingGuardian(null);
          }}
          onSaved={() => {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.detail("guardians", "guardians", editingGuardian.id),
            });
            setEditingGuardian(null);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Confirm `student-guardians-tab.tsx`'s tests pass by construction**

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/features/students/student-guardians-tab.tsx apps/dashboard/src/features/students/__tests__/student-guardians-tab.test.tsx
git commit -m "feat(dashboard): add the students guardians tab"
```

- [ ] **Step 8: Push and read CI**

---

## Task 8: `StudentEmergencyContactsTab`

**Files:**
- Modify: `apps/dashboard/src/services/modules/students/students.schema.ts` (add `emergencyContactSchema`)
- Create: `apps/dashboard/src/features/students/student-emergency-contacts-tab.tsx`
- Create: `apps/dashboard/src/features/students/__tests__/student-emergency-contacts-tab.test.tsx`

**Interfaces:**
- Consumes: `Services.students.{fetchEmergencyContacts,addEmergencyContact}` (Task 3).
- Produces: `StudentEmergencyContactsTab({ studentId, canCreate })`; `emergencyContactSchema`/`EmergencyContactFormInput`/`EmergencyContactFormValues`, added to the existing `students.schema.ts` (ADR-0019's five-file shape — a form schema belongs there, not inline in a component file) alongside whatever `studentFormSchema` it already holds. Consumed by Task 10.

- [ ] **Step 0: Add `emergencyContactSchema` to the existing `students.schema.ts`**

```ts
export const emergencyContactSchema = z.object({
  name: z.string().min(1),
  relationship: z.string().min(1),
  phone: z.string().min(1),
  altPhone: z.string().optional(),
  priority: z.coerce.number().int().min(1),
  notes: z.string().optional(),
});

/** `z.coerce.number()` on `priority` makes this schema's input and output types
 * genuinely differ (a form field's live value before Zod coerces it, vs. the coerced
 * `number` after) — both are exported so `useForm` can be given all three of its
 * generics explicitly where this schema is used (see `student-emergency-contacts-tab.tsx`). */
export type EmergencyContactFormInput = z.input<typeof emergencyContactSchema>;
export type EmergencyContactFormValues = z.output<typeof emergencyContactSchema>;
```

(Confirm `z` is already imported in this file for the existing `studentFormSchema` — reuse it, don't re-import.)

**Review Focus #3** (a gated action rendered for a caller without the permission) applies here: the add button and form must be genuinely absent when `canCreate` is false, not merely disabled.

- [ ] **Step 1: Write the failing tests**

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import type { EmergencyContactRecord } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { StudentEmergencyContactsTab } from "../student-emergency-contacts-tab";

jest.mock("@/services", () => ({
  Services: {
    students: {
      fetchEmergencyContacts: jest.fn(),
      addEmergencyContact: jest.fn(),
    },
  },
}));

const mockFetchEmergencyContacts = Services.students.fetchEmergencyContacts as jest.MockedFunction<
  typeof Services.students.fetchEmergencyContacts
>;
const mockAddEmergencyContact = Services.students.addEmergencyContact as jest.MockedFunction<
  typeof Services.students.addEmergencyContact
>;

function contactRecord(overrides: Partial<EmergencyContactRecord> = {}): EmergencyContactRecord {
  return {
    id: "c1",
    student_id: "student-1",
    name: "Hamza Raza",
    relationship: "Uncle",
    phone: "0300-0000000",
    alt_phone: null,
    priority: 1,
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("StudentEmergencyContactsTab", () => {
  beforeEach(() => {
    mockFetchEmergencyContacts.mockReset();
    mockAddEmergencyContact.mockReset();
  });

  it("shows empty copy when there are no contacts yet", async () => {
    mockFetchEmergencyContacts.mockResolvedValue([]);

    renderWithProviders(<StudentEmergencyContactsTab studentId="student-1" canCreate />);

    expect(await screen.findByText(/no emergency contacts added yet/i)).toBeInTheDocument();
  });

  it("lists contacts ordered by priority with no edit or delete control", async () => {
    mockFetchEmergencyContacts.mockResolvedValue([contactRecord()]);

    renderWithProviders(<StudentEmergencyContactsTab studentId="student-1" canCreate />);

    await screen.findByText("Hamza Raza");
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("adds a contact, defaulting priority to one past the current count", async () => {
    mockFetchEmergencyContacts.mockResolvedValue([contactRecord()]);
    mockAddEmergencyContact.mockResolvedValue(contactRecord({ id: "c2", priority: 2 }));
    const user = userEvent.setup();

    renderWithProviders(<StudentEmergencyContactsTab studentId="student-1" canCreate />);

    await user.click(await screen.findByRole("button", { name: /add contact/i }));
    expect(screen.getByLabelText(/^priority$/i)).toHaveValue(2);
    await user.type(screen.getByLabelText(/^name$/i), "Zainab Malik");
    await user.type(screen.getByLabelText(/relationship/i), "Aunt");
    await user.type(screen.getByLabelText(/^phone$/i), "0300-3333333");
    // Scoped to the open dialog: the tab's own "Add contact" trigger button stays
    // rendered behind it and shares this exact text, so an unscoped query here would
    // match two elements.
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^add contact$/i }));

    await waitFor(() => {
      expect(mockAddEmergencyContact).toHaveBeenCalledWith(
        "student-1",
        expect.objectContaining({
          name: "Zainab Malik",
          relationship: "Aunt",
          phone: "0300-3333333",
          priority: 2,
        }),
      );
    });
  });

  it("hides the add action for a caller without create permission", async () => {
    mockFetchEmergencyContacts.mockResolvedValue([]);

    renderWithProviders(<StudentEmergencyContactsTab studentId="student-1" canCreate={false} />);

    await screen.findByText(/no emergency contacts added yet/i);
    expect(screen.queryByRole("button", { name: /add contact/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Confirm the tests fail by construction, then write `student-emergency-contacts-tab.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Skeleton,
} from "@schoolhub/ui";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  emergencyContactSchema,
  type EmergencyContactFormInput,
  type EmergencyContactFormValues,
} from "@/services/modules/students/students.schema";

export interface StudentEmergencyContactsTabProps {
  studentId: string;
  canCreate: boolean;
}

export function StudentEmergencyContactsTab({
  studentId,
  canCreate,
}: StudentEmergencyContactsTabProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const [dialogOpen, setDialogOpen] = useState(false);

  const contactsQuery = useQuery({
    queryKey: queryKeys.list("students", "emergency-contacts", { studentId }),
    queryFn: () => Services.students.fetchEmergencyContacts(studentId),
  });
  const contacts = contactsQuery.data ?? [];

  if (contactsQuery.isPending) {
    return <Skeleton className="h-24 w-full" />;
  }

  if (contactsQuery.isError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{t("emergencyContacts.loadError")}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void contactsQuery.refetch();
          }}
        >
          {tCommon("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{t("emergencyContacts.title")}</h3>
        {canCreate && (
          <Button
            size="sm"
            onClick={() => {
              setDialogOpen(true);
            }}
          >
            {t("emergencyContacts.add")}
          </Button>
        )}
      </div>

      {contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("emergencyContacts.empty")}</p>
      ) : (
        <div className="space-y-3">
          {contacts.map((contact) => (
            <div key={contact.id} className="space-y-1 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{contact.name}</p>
                <Badge variant="outline">
                  {t("emergencyContacts.priority", { priority: contact.priority })}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {contact.relationship} · {contact.phone}
                {contact.alt_phone ? ` / ${contact.alt_phone}` : ""}
              </p>
              {contact.notes ? (
                <p className="text-xs text-muted-foreground">{contact.notes}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {dialogOpen && (
        <AddEmergencyContactDialog
          studentId={studentId}
          nextPriority={contacts.length + 1}
          onOpenChange={(open) => {
            if (!open) setDialogOpen(false);
          }}
        />
      )}
    </div>
  );
}

function AddEmergencyContactDialog({
  studentId,
  nextPriority,
  onOpenChange,
}: {
  studentId: string;
  nextPriority: number;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  // Three generics, not one: `priority`'s `z.coerce.number()` makes this schema's input
  // type (a form field's live, pre-submit value — effectively `unknown` until coerced)
  // differ from its output type (`number`, after Zod resolves it) — `zodResolver`'s
  // return type reflects that asymmetry, and `useForm<EmergencyContactFormValues>`
  // alone (implicitly also the output type) doesn't typecheck against it.
  const form = useForm<EmergencyContactFormInput, unknown, EmergencyContactFormValues>({
    resolver: zodResolver(emergencyContactSchema),
    defaultValues: {
      name: "",
      relationship: "",
      phone: "",
      altPhone: "",
      priority: nextPriority,
      notes: "",
    },
  });

  const mutation = useMutation({
    mutationFn: (values: EmergencyContactFormValues) =>
      Services.students.addEmergencyContact(studentId, {
        name: values.name,
        relationship: values.relationship,
        phone: values.phone,
        ...(values.altPhone ? { altPhone: values.altPhone } : {}),
        priority: values.priority,
        ...(values.notes ? { notes: values.notes } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.list("students", "emergency-contacts", { studentId }),
      });
      onOpenChange(false);
    },
    // Toast, not an inline field/alert error, per this plan's Global Constraints — an
    // add-contact failure is one of the named mutations that must surface via toast.
    onError: (error) => {
      toast.error(resolveErrorMessage(error, tErrors, t("emergencyContacts.addFailed")));
    },
  });

  return (
    <ResponsiveDialog open onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-md" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("emergencyContacts.add")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <Form {...form}>
          <form
            noValidate
            onSubmit={form.handleSubmit((values) => {
              mutation.mutate(values);
            })}
          >
            <ResponsiveDialogBody className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("emergencyContacts.addDescription")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("emergencyContacts.permanentNotice")}
              </p>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("emergencyContacts.fields.name")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="relationship"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("emergencyContacts.fields.relationship")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("emergencyContacts.fields.phone")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="altPhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("emergencyContacts.fields.altPhone")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("emergencyContacts.fields.priority")}</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("emergencyContacts.fields.notes")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </ResponsiveDialogBody>
            <ResponsiveDialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                }}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                isLoading={mutation.isPending}
                loadingLabel={t("emergencyContacts.submitting")}
              >
                {t("emergencyContacts.add")}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </Form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
```

- [ ] **Step 3: Confirm the tests pass by construction**

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/services/modules/students/students.schema.ts apps/dashboard/src/features/students/student-emergency-contacts-tab.tsx apps/dashboard/src/features/students/__tests__/student-emergency-contacts-tab.test.tsx
git commit -m "feat(dashboard): add the students emergency contacts tab"
```

- [ ] **Step 5: Push and read CI**

---

## Task 9: `StudentDocumentsTab` + `DocumentUploadDialog`

**Files:**
- Modify: `apps/dashboard/src/services/modules/students/students.schema.ts` (add `documentFormSchema`)
- Create: `apps/dashboard/src/features/students/document-upload-dialog.tsx`
- Create: `apps/dashboard/src/features/students/student-documents-tab.tsx`
- Create: `apps/dashboard/src/features/students/__tests__/document-upload-dialog.test.tsx`
- Create: `apps/dashboard/src/features/students/__tests__/student-documents-tab.test.tsx`

**Interfaces:**
- Consumes: `Services.students.{fetchDocuments,uploadDocumentRecord,deleteDocument,verifyDocument,getDocumentDownloadUrl}` (Task 3), `Services.files.uploadFile` (Phase 1).
- Produces: `StudentDocumentsTab({ studentId, canCreate, canVerify, canDelete })`; `documentFormSchema`/`DocumentFormValues`, added to the existing `students.schema.ts` (ADR-0019 — not inline in a component file). Consumed by Task 10.

- [ ] **Step 0: Add `documentFormSchema` to the existing `students.schema.ts`**

```ts
// The file itself stays outside this schema, as its own `useState` on the dialog — same
// convention `PhotoUploadField` (Task 5) already established for an uncontrolled `<input
// type="file">`, which has no meaningful RHF "value" to validate against. Only the
// metadata fields go through RHF + zod.
export const documentFormSchema = z.object({
  documentType: z.string().min(1),
  title: z.string().min(1),
  notes: z.string().optional(),
  expiresAt: z.string().optional(),
});

export type DocumentFormValues = z.infer<typeof documentFormSchema>;
```

(Reuse this file's existing `z` import.)

**Review Focus #4** (an upload failing at a specific step must show that step's real message) applies here.

- [ ] **Step 1: Write `document-upload-dialog.tsx`'s failing tests**

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { DocumentUploadDialog } from "../document-upload-dialog";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    files: { uploadFile: jest.fn() },
    students: { uploadDocumentRecord: jest.fn() },
  },
}));

const mockUploadFile = Services.files.uploadFile as jest.MockedFunction<
  typeof Services.files.uploadFile
>;
const mockUploadDocumentRecord = Services.students.uploadDocumentRecord as jest.MockedFunction<
  typeof Services.students.uploadDocumentRecord
>;

describe("DocumentUploadDialog", () => {
  const onOpenChange = jest.fn();
  const onUploaded = jest.fn();

  beforeEach(() => {
    mockUploadFile.mockReset();
    mockUploadDocumentRecord.mockReset();
    onOpenChange.mockReset();
    onUploaded.mockReset();
  });

  it("uploads the file then creates the document record with the chosen type and title", async () => {
    mockUploadFile.mockResolvedValue("file-1");
    mockUploadDocumentRecord.mockResolvedValue({ id: "d1" } as never);
    const user = userEvent.setup();

    renderWithProviders(
      <DocumentUploadDialog
        open
        studentId="student-1"
        onOpenChange={onOpenChange}
        onUploaded={onUploaded}
      />,
    );

    await user.upload(
      screen.getByLabelText(/^file$/i),
      new File(["x"], "birth-cert.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("combobox", { name: /document type/i }));
    await user.click(screen.getByRole("option", { name: /birth certificate/i }));
    await user.type(screen.getByLabelText(/^title$/i), "Birth certificate");
    await user.click(screen.getByRole("button", { name: /^upload document$/i }));

    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledWith(expect.any(File), "student.document");
    });
    await waitFor(() => {
      expect(mockUploadDocumentRecord).toHaveBeenCalledWith(
        "student-1",
        expect.objectContaining({
          fileId: "file-1",
          documentType: "birth_certificate",
          title: "Birth certificate",
        }),
      );
    });
    expect(onUploaded).toHaveBeenCalled();
  });

  it("shows the real step-specific error when the upload itself fails", async () => {
    class FakeUploadError extends Error {}
    mockUploadFile.mockRejectedValue(new FakeUploadError("The file could not be uploaded to storage."));
    const user = userEvent.setup();

    renderWithProviders(
      <DocumentUploadDialog
        open
        studentId="student-1"
        onOpenChange={onOpenChange}
        onUploaded={onUploaded}
      />,
    );

    await user.upload(
      screen.getByLabelText(/^file$/i),
      new File(["x"], "doc.pdf", { type: "application/pdf" }),
    );
    await user.type(screen.getByLabelText(/^title$/i), "Doc");
    await user.click(screen.getByRole("button", { name: /^upload document$/i }));

    expect(
      await screen.findByText("The file could not be uploaded to storage."),
    ).toBeInTheDocument();
    expect(mockUploadDocumentRecord).not.toHaveBeenCalled();
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("blocks submission until a file and a title are both present", async () => {
    renderWithProviders(
      <DocumentUploadDialog
        open
        studentId="student-1"
        onOpenChange={onOpenChange}
        onUploaded={onUploaded}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: /^upload document$/i }));

    expect(mockUploadFile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Confirm those tests fail by construction, then write `document-upload-dialog.tsx`**

```tsx
"use client";

import { useState, type ChangeEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import {
  Alert,
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { resolveErrorMessage } from "@/lib/error-message";
import { ApiError, Services } from "@/services";
import { DOCUMENT_TYPES } from "@/services/modules/students/students-constant";
import {
  documentFormSchema,
  type DocumentFormValues,
} from "@/services/modules/students/students.schema";

export interface DocumentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  onUploaded: () => void;
}

export function DocumentUploadDialog({
  open,
  onOpenChange,
  studentId,
  onUploaded,
}: DocumentUploadDialogProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");

  const [file, setFile] = useState<File | null>(null);
  // Keeps a successful upload's id across a failed metadata-POST retry — `core/files`'
  // `File` rows can't be deleted, so retrying the whole mutation would otherwise
  // re-upload the same file and leave the first attempt as a permanent orphan row.
  const [uploadedFileId, setUploadedFileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<DocumentFormValues>({
    resolver: zodResolver(documentFormSchema),
    defaultValues: {
      documentType: DOCUMENT_TYPES[0],
      title: "",
      notes: "",
      expiresAt: "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: DocumentFormValues) => {
      const fileId =
        uploadedFileId ?? (await Services.files.uploadFile(file as File, "student.document"));
      setUploadedFileId(fileId);
      return Services.students.uploadDocumentRecord(studentId, {
        fileId,
        documentType: values.documentType,
        title: values.title,
        ...(values.notes ? { notes: values.notes } : {}),
        ...(values.expiresAt ? { expiresAt: values.expiresAt } : {}),
      });
    },
    onSuccess: () => {
      onOpenChange(false);
      onUploaded();
    },
    onError: (err) => {
      // `Services.files.uploadFile` rejects with a `FileUploadError` (a plain `Error`
      // subclass) whose message is already the real step-specific text — never an
      // `ApiError`. `uploadDocumentRecord`'s own failure, by contrast, is a real
      // `ApiError` from the backend (e.g. a validation error), which needs
      // `resolveErrorMessage` to surface its field-level detail instead of a generic
      // message.
      setError(
        err instanceof ApiError
          ? resolveErrorMessage(err, tErrors, t("form.submitFailed"), "non_field")
          : err instanceof Error
            ? err.message
            : t("form.submitFailed"),
      );
    },
  });

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    // A freshly picked file replaces whatever was uploaded before — never post a new
    // pick's metadata against an older file's id.
    setUploadedFileId(null);
  }

  function onSubmit(values: DocumentFormValues) {
    if (!file && !uploadedFileId) return;
    setError(null);
    mutation.mutate(values);
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-md" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("documents.upload")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <Form {...form}>
          <form noValidate onSubmit={form.handleSubmit(onSubmit)}>
            <ResponsiveDialogBody className="space-y-3">
              <p className="text-sm text-muted-foreground">{t("documents.uploadDescription")}</p>
              {error && <Alert variant="destructive">{error}</Alert>}
              <div className="space-y-1.5">
                <Label htmlFor="document-file">{t("documents.fields.file")}</Label>
                <Input id="document-file" type="file" onChange={handleFileChange} />
              </div>
              <FormField
                control={form.control}
                name="documentType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("documents.fields.documentType")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger aria-label={t("documents.fields.documentType")}>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {DOCUMENT_TYPES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(`documents.type.${value}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("documents.fields.title")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="expiresAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("documents.fields.expiresAt")}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("documents.fields.notes")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </ResponsiveDialogBody>
            <ResponsiveDialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                }}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={(!file && !uploadedFileId) || mutation.isPending}
                isLoading={mutation.isPending}
                loadingLabel={t("documents.uploading")}
              >
                {mutation.isPending ? t("documents.uploading") : t("documents.upload")}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        </Form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
```

- [ ] **Step 3: Confirm `document-upload-dialog.tsx`'s tests pass by construction, then commit it alone**

```bash
git add apps/dashboard/src/services/modules/students/students.schema.ts apps/dashboard/src/features/students/document-upload-dialog.tsx apps/dashboard/src/features/students/__tests__/document-upload-dialog.test.tsx
git commit -m "feat(dashboard): add the student document upload dialog"
```

- [ ] **Step 4: Write `student-documents-tab.tsx`'s failing tests**

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { Services } from "@/services";
import type { StudentDocumentRecord } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { StudentDocumentsTab } from "../student-documents-tab";

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

jest.mock("@/services", () => ({
  Services: {
    students: {
      fetchDocuments: jest.fn(),
      verifyDocument: jest.fn(),
      deleteDocument: jest.fn(),
      uploadDocumentRecord: jest.fn(),
      getDocumentDownloadUrl: jest.fn(),
    },
    files: { uploadFile: jest.fn() },
  },
}));

const mockFetchDocuments = Services.students.fetchDocuments as jest.MockedFunction<
  typeof Services.students.fetchDocuments
>;
const mockVerifyDocument = Services.students.verifyDocument as jest.MockedFunction<
  typeof Services.students.verifyDocument
>;
const mockDeleteDocument = Services.students.deleteDocument as jest.MockedFunction<
  typeof Services.students.deleteDocument
>;
const mockGetDocumentDownloadUrl = Services.students.getDocumentDownloadUrl as jest.MockedFunction<
  typeof Services.students.getDocumentDownloadUrl
>;
const mockToastError = toast.error as jest.MockedFunction<typeof toast.error>;

function documentRecord(overrides: Partial<StudentDocumentRecord> = {}): StudentDocumentRecord {
  return {
    id: "d1",
    student_id: "student-1",
    file_id: "file-1",
    document_type: "birth_certificate",
    // Deliberately NOT "Birth certificate" — that's the default type's own label
    // (`documents.type.birth_certificate`, `en.json`), rendered as a second, separate
    // text node in the same row. A title matching it would make `findByText` match two
    // elements and throw a multiple-elements error.
    title: "Ayesha's birth certificate",
    notes: null,
    verification_status: "pending",
    verified_by: null,
    verified_at: null,
    expires_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("StudentDocumentsTab", () => {
  beforeEach(() => {
    mockFetchDocuments.mockReset();
    mockVerifyDocument.mockReset();
    mockDeleteDocument.mockReset();
    mockGetDocumentDownloadUrl.mockReset();
    mockToastError.mockReset();
  });

  it("shows empty copy when there are no documents yet", async () => {
    mockFetchDocuments.mockResolvedValue([]);

    renderWithProviders(
      <StudentDocumentsTab studentId="student-1" canCreate canVerify canDelete />,
    );

    expect(await screen.findByText(/no documents uploaded yet/i)).toBeInTheDocument();
  });

  it("shows verify/reject only for a pending document, and only when permitted", async () => {
    mockFetchDocuments.mockResolvedValue([documentRecord({ verification_status: "pending" })]);

    renderWithProviders(
      <StudentDocumentsTab studentId="student-1" canCreate canVerify canDelete />,
    );

    await screen.findByText("Ayesha's birth certificate");
    expect(screen.getByRole("button", { name: /^verify$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
  });

  it("hides verify/reject for an already-verified document", async () => {
    mockFetchDocuments.mockResolvedValue([documentRecord({ verification_status: "verified" })]);

    renderWithProviders(
      <StudentDocumentsTab studentId="student-1" canCreate canVerify canDelete />,
    );

    await screen.findByText("Ayesha's birth certificate");
    expect(screen.queryByRole("button", { name: /^verify$/i })).not.toBeInTheDocument();
  });

  it("requests a fresh signed URL on every download click, not a cached one", async () => {
    mockFetchDocuments.mockResolvedValue([documentRecord()]);
    mockGetDocumentDownloadUrl.mockResolvedValue("https://files.example.com/x?sig=abc");
    const user = userEvent.setup();

    renderWithProviders(
      <StudentDocumentsTab studentId="student-1" canCreate canVerify canDelete />,
    );

    const button = await screen.findByRole("button", { name: /download/i });
    await user.click(button);
    await user.click(button);

    // Clicked twice, asserting two real calls (not one cached result reused) is what
    // actually pins "fetched fresh per click" — a signed URL has a server-side TTL, so
    // reusing one eventually hands out an expired link. The anchor-click mechanics are
    // `staff-toolbar.tsx`'s own already-proven pattern, reused verbatim here, not
    // re-tested per call site.
    await waitFor(() => {
      expect(mockGetDocumentDownloadUrl).toHaveBeenCalledTimes(2);
    });
    expect(mockGetDocumentDownloadUrl).toHaveBeenCalledWith("d1");
  });

  it("shows a toast when the download URL fetch fails", async () => {
    mockFetchDocuments.mockResolvedValue([documentRecord()]);
    mockGetDocumentDownloadUrl.mockRejectedValue(new Error("network down"));

    renderWithProviders(
      <StudentDocumentsTab studentId="student-1" canCreate canVerify canDelete />,
    );

    await userEvent.setup().click(await screen.findByRole("button", { name: /download/i }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
  });

  it("confirms before deleting", async () => {
    mockFetchDocuments.mockResolvedValue([documentRecord()]);
    mockDeleteDocument.mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderWithProviders(
      <StudentDocumentsTab studentId="student-1" canCreate canVerify canDelete />,
    );

    await user.click(await screen.findByRole("button", { name: /^delete$/i }));
    expect(mockDeleteDocument).not.toHaveBeenCalled();
    // Scoped to the open confirmation dialog: its own confirm button reuses the exact
    // same "Delete" label as the row's trigger button that just opened it.
    const confirmDialog = await screen.findByRole("alertdialog");
    await user.click(within(confirmDialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(mockDeleteDocument).toHaveBeenCalledWith("d1");
    });
  });

  it("hides every gated action for a caller with none of the permissions", async () => {
    mockFetchDocuments.mockResolvedValue([documentRecord({ verification_status: "pending" })]);

    renderWithProviders(
      <StudentDocumentsTab
        studentId="student-1"
        canCreate={false}
        canVerify={false}
        canDelete={false}
      />,
    );

    await screen.findByText("Ayesha's birth certificate");
    expect(screen.queryByRole("button", { name: /upload document/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^verify$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete$/i })).not.toBeInTheDocument();
    // Download has no permission gate (students.document.view already governs whether the
    // tab is reachable at all), so it stays visible.
    expect(screen.getByRole("button", { name: /download/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Confirm the tests fail by construction, then write `student-documents-tab.tsx`**

```tsx
"use client";

import { useState } from "react";
import { format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Skeleton,
} from "@schoolhub/ui";

import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import type { DocumentVerificationDecision, StudentDocumentRecord } from "@/services";
import { DOCUMENT_TYPES } from "@/services/modules/students/students-constant";
import { DocumentUploadDialog } from "./document-upload-dialog";

const STATUS_VARIANT: Record<StudentDocumentRecord["verification_status"], "success" | "warning" | "destructive"> = {
  pending: "warning",
  verified: "success",
  rejected: "destructive",
};

/** A tenant's document can carry a `document_type` outside the 6 seeded defaults (an
 * older or externally-written row) — render the raw value rather than indexing into the
 * fixed `documents.type.*` i18n map and hitting a missing key. */
function documentTypeLabel(t: ReturnType<typeof useTranslations>, type: string): string {
  return (DOCUMENT_TYPES as readonly string[]).includes(type) ? t(`documents.type.${type}`) : type;
}

/** Mirrors `staff-detail-sheet.tsx`'s own local `formatDate` — a raw ISO string is never
 * shown to the user. */
function formatExpiry(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, "PPP");
}

export interface StudentDocumentsTabProps {
  studentId: string;
  canCreate: boolean;
  canVerify: boolean;
  canDelete: boolean;
}

export function StudentDocumentsTab({
  studentId,
  canCreate,
  canVerify,
  canDelete,
}: StudentDocumentsTabProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const documentsQuery = useQuery({
    queryKey: queryKeys.list("students", "documents", { studentId }),
    queryFn: () => Services.students.fetchDocuments(studentId),
  });
  const documents = documentsQuery.data ?? [];

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.list("students", "documents", { studentId }),
    });
  }

  const verifyMutation = useMutation({
    mutationFn: ({
      documentId,
      decision,
    }: {
      documentId: string;
      decision: DocumentVerificationDecision;
    }) => Services.students.verifyDocument(documentId, decision),
    onSuccess: invalidate,
    onError: (error) => {
      toast.error(resolveErrorMessage(error, tErrors, t("documents.verifyFailed")));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (documentId: string) => Services.students.deleteDocument(documentId),
    onSuccess: () => {
      invalidate();
      setPendingDeleteId(null);
    },
    onError: (error) => {
      toast.error(resolveErrorMessage(error, tErrors, t("documents.deleteFailed")));
    },
  });

  const downloadMutation = useMutation({
    // `Services.students.getDocumentDownloadUrl` (Task 3), keyed on the document's own
    // id — Task 1's new `students.document.view`-gated `:download` action, not the
    // generic `Services.jobs.fetchFileDownloadUrl` that `/staff`'s export still uses.
    // Takes the document's own title alongside its id, purely for the anchor's
    // `download` filename hint below — never sent to the server.
    mutationFn: async ({ documentId }: { documentId: string; title: string }) => ({
      url: await Services.students.getDocumentDownloadUrl(documentId),
    }),
    onSuccess: ({ url }, { title }) => {
      // The anchor-click pattern `/staff`'s export download already uses — never
      // `window.open`, which only succeeds within a short window of direct user
      // interaction that the request in between can lose on a slow connection. The
      // `download` attribute is a same-origin filename hint only; the actual forced
      // download now comes from `core/files`' own `Content-Disposition` header (Task 1).
      const link = document.createElement("a");
      link.href = url;
      link.download = title;
      link.click();
    },
    onError: (error) => {
      toast.error(resolveErrorMessage(error, tErrors, t("documents.downloadFailed")));
    },
  });

  if (documentsQuery.isPending) {
    return <Skeleton className="h-24 w-full" />;
  }

  if (documentsQuery.isError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{t("documents.loadError")}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void documentsQuery.refetch();
          }}
        >
          {tCommon("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{t("documents.title")}</h3>
        {canCreate && (
          <Button
            size="sm"
            onClick={() => {
              setUploadOpen(true);
            }}
          >
            {t("documents.upload")}
          </Button>
        )}
      </div>

      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("documents.empty")}</p>
      ) : (
        <div className="space-y-3">
          {documents.map((document) => (
            <div key={document.id} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{document.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {documentTypeLabel(t, document.document_type)}
                    {document.expires_at
                      ? ` · ${t("documents.expiresOn", { date: formatExpiry(document.expires_at) })}`
                      : ""}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[document.verification_status]} appearance="light">
                  {t(`documents.status.${document.verification_status}`)}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={downloadMutation.isPending}
                  onClick={() => {
                    downloadMutation.mutate({ documentId: document.id, title: document.title });
                  }}
                >
                  {t("documents.download")}
                </Button>
                {canVerify && document.verification_status === "pending" && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={verifyMutation.isPending}
                      onClick={() => {
                        verifyMutation.mutate({ documentId: document.id, decision: "verified" });
                      }}
                    >
                      {t("documents.verify")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={verifyMutation.isPending}
                      onClick={() => {
                        verifyMutation.mutate({ documentId: document.id, decision: "rejected" });
                      }}
                    >
                      {t("documents.reject")}
                    </Button>
                  </>
                )}
                {canDelete && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setPendingDeleteId(document.id);
                    }}
                  >
                    {t("documents.delete")}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {uploadOpen && (
        <DocumentUploadDialog
          open
          studentId={studentId}
          onOpenChange={(open) => {
            if (!open) setUploadOpen(false);
          }}
          onUploaded={invalidate}
        />
      )}

      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("documents.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("documents.deleteConfirmDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (pendingDeleteId) deleteMutation.mutate(pendingDeleteId);
              }}
            >
              {/* A real delete-action verb, not the confirmation question repeated as its
               * own button label — reuses the same `documents.delete` key the row's own
               * trigger button already uses. */}
              {t("documents.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 6: Confirm the tests pass by construction**

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/features/students/student-documents-tab.tsx apps/dashboard/src/features/students/__tests__/student-documents-tab.test.tsx
git commit -m "feat(dashboard): add the students documents tab"
```

- [ ] **Step 8: Push and read CI**

---

## Task 10: Wrap `StudentDetailSheet` in Tabs

**Files:**
- Modify: `apps/dashboard/src/features/students/student-detail-sheet.tsx`
- Modify: `apps/dashboard/src/features/students/__tests__/student-detail-sheet.test.tsx`

**Interfaces:**
- Consumes: `StudentGuardiansTab` (Task 7), `StudentEmergencyContactsTab` (Task 8), `StudentDocumentsTab` (Task 9), `useCurrentUser` (existing hook), `hasPermission` (existing helper).
- Produces: the same `StudentDetailSheetProps` as today — `canUpdate`/`canWithdraw` keep their exact existing meaning (gating Edit/Withdraw in the footer, unchanged); the three new tabs compute their own, more granular permissions internally via a new `useCurrentUser()` call inside this component, so the caller (`student-directory-table.tsx`) needs no changes at all.

**Review Focus #5** (switching tabs mid-fetch must not leave a stale state) applies here.

- [ ] **Step 1: Write the new failing tests, added to the existing test file**

The existing file already has a working `renderWithProviders`/mock-`Services` setup for `fetchStudentById` — add these without touching any existing test:

```tsx
  it("renders four tabs, defaulting to Profile", async () => {
    mockFetchStudentById.mockResolvedValue(studentDetail());

    renderWithProviders(
      <StudentDetailSheet
        row={studentRow()}
        canUpdate
        canWithdraw
        onOpenChange={jest.fn()}
        onEdit={jest.fn()}
        onWithdraw={jest.fn()}
      />,
    );

    await screen.findByText(studentRow().admissionNumber);
    expect(screen.getByRole("tab", { name: /profile/i })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("tab", { name: /^guardians$/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /emergency contacts/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^documents$/i })).toBeInTheDocument();
    // Pins the `asChild`-dropped fix: a real tabpanel role must reach the DOM, not get
    // silently swallowed by `ResponsiveSheetBody` (which doesn't forward arbitrary props).
    expect(screen.getByRole("tabpanel")).toBeInTheDocument();
  });

  it("hides a tab entirely for a caller without that tab's own view permission", async () => {
    mockFetchStudentById.mockResolvedValue(studentDetail());
    mockUseCurrentUser.mockReturnValue({
      data: { ...PERMITTED_USER, permissions: ["students.student.view"] },
      isError: false,
    });

    renderWithProviders(
      <StudentDetailSheet
        row={studentRow()}
        canUpdate
        canWithdraw
        onOpenChange={jest.fn()}
        onEdit={jest.fn()}
        onWithdraw={jest.fn()}
      />,
    );

    await screen.findByText(studentRow().admissionNumber);
    expect(screen.getByRole("tab", { name: /profile/i })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^guardians$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^documents$/i })).not.toBeInTheDocument();
  });

  it("does not fetch a tab's data until that tab is actually opened", async () => {
    mockFetchStudentById.mockResolvedValue(studentDetail());
    mockFetchGuardianLinks.mockResolvedValue([]);

    renderWithProviders(
      <StudentDetailSheet
        row={studentRow()}
        canUpdate
        canWithdraw
        onOpenChange={jest.fn()}
        onEdit={jest.fn()}
        onWithdraw={jest.fn()}
      />,
    );

    await screen.findByText(studentRow().admissionNumber);
    expect(mockFetchGuardianLinks).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole("tab", { name: /^guardians$/i }));

    await waitFor(() => {
      expect(mockFetchGuardianLinks).toHaveBeenCalledWith("stu-1");
    });
  });

  it("switching tabs away and back does not leave a stale error from an interrupted first fetch", async () => {
    mockFetchStudentById.mockResolvedValue(studentDetail());
    mockFetchGuardianLinks.mockRejectedValueOnce(new Error("network blip"));
    mockFetchGuardianLinks.mockResolvedValueOnce([]);

    renderWithProviders(
      <StudentDetailSheet
        row={studentRow()}
        canUpdate
        canWithdraw
        onOpenChange={jest.fn()}
        onEdit={jest.fn()}
        onWithdraw={jest.fn()}
      />,
    );

    await screen.findByText(studentRow().admissionNumber);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /^guardians$/i }));
    await waitFor(() => expect(mockFetchGuardianLinks).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("tab", { name: /profile/i }));
    await user.click(screen.getByRole("tab", { name: /^guardians$/i }));

    await waitFor(() => expect(mockFetchGuardianLinks).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/no guardians linked yet/i)).toBeInTheDocument();
  });
```

Add `mockFetchGuardianLinks` to the file's existing `jest.mock("@/services", ...)` factory (it currently mocks only `Services.students.fetchStudentById` — confirm by reading the file's current mock block before editing it — add `guardians: { fetchGuardianLinks: jest.fn() }` alongside the existing `students` key, and declare `const mockFetchGuardianLinks = Services.guardians.fetchGuardianLinks as jest.MockedFunction<typeof Services.guardians.fetchGuardianLinks>;` beside the file's existing `mockFetchStudentById` declaration). Also mock `Services.students.{fetchEmergencyContacts,fetchDocuments}` and `Services.files.uploadFile` in the same factory, each resolving `[]`/`undefined` by default in a `beforeEach`, so opening any of the three new tabs during an existing (unrelated) test never crashes with "not a function" — matching this file's own established reasoning for why its mock object needs every function present, not just the ones a given test calls.

This component now calls `useCurrentUser()` directly for the first time (Phase 1 only ever passed `canUpdate`/`canWithdraw` in as props) — mock it the same way `student-toolbar.test.tsx` already does:

```tsx
import type { AuthenticatedUser } from "@schoolhub/types";

interface MockCurrentUserResult {
  data: AuthenticatedUser | undefined;
  isError: boolean;
}
const mockUseCurrentUser = jest.fn<MockCurrentUserResult, []>();
jest.mock("@/hooks/use-current-user", () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

const PERMITTED_USER: AuthenticatedUser = {
  id: "u1",
  email: "admin@example.com",
  phone: null,
  full_name: "School Admin",
  avatar_url: null,
  locale: "en",
  tenant_id: "tenant-1",
  roles: [],
  permissions: [
    "students.guardian.view",
    "students.guardian.create",
    "students.guardian.update",
    "students.student.view",
    "students.student.update",
    "students.document.view",
    "students.document.create",
    "students.document.verify",
    "students.document.delete",
  ],
};
```

Set `mockUseCurrentUser.mockReset().mockReturnValue({ data: PERMITTED_USER, isError: false });` in this file's existing top-level `beforeEach` — every pre-existing test in this file keeps passing unchanged (none of them asserted on the three new tabs' presence before this task), and the three new tests below render against a user who can see every tab.

- [ ] **Step 2: Confirm the three new tests fail by construction, then modify `student-detail-sheet.tsx`**

Add these imports:

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@schoolhub/ui";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { StudentGuardiansTab } from "./student-guardians-tab";
import { StudentEmergencyContactsTab } from "./student-emergency-contacts-tab";
import { StudentDocumentsTab } from "./student-documents-tab";
```

Add a line near the component's other state (`const isDesktop = useIsDesktopShell();` is the existing line to add this after) — this is the ONLY addition needed; no new `useState`/`useEffect` import, since the tabbed sheet resets via a `key`, not an effect (this plan's Alternatives Considered):

```tsx
  const { data: currentUser } = useCurrentUser();
  const canViewGuardians = hasPermission(currentUser, "students.guardian.view");
  const canViewEmergencyContacts = hasPermission(currentUser, "students.student.view");
  const canViewDocuments = hasPermission(currentUser, "students.document.view");
```

Each new tab renders only for a caller holding *that tab's own* view key — not merely "can view this student" (this plan's Global Constraints) — so `TabsTrigger`/`TabsContent` pairs below are conditionally rendered, not merely their inner content.

Replace the existing block —

```tsx
            <ResponsiveSheetBody className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
              {detailQuery.isError ? (
                <p className="text-sm text-muted-foreground">{t("detail.loadError")}</p>
              ) : (
                <>
                  {sections.map((section) => (
                    <FieldSection key={section.title} title={section.title}>
                      {section.fields.map((field) => (
                        <FieldRow
                          key={field.label}
                          icon={field.icon}
                          label={field.label}
                          value={field.value}
                          isPending={isPending}
                        />
                      ))}
                    </FieldSection>
                  ))}

                  {/* Same loading gate as every FieldRow above: a skeleton until the detail
                      arrives, never "Last updated " with nothing after it. */}
                  {data ? (
                    <span className="text-xs text-muted-foreground">
                      {t("detail.lastUpdated", { when: formatLastUpdated(data.updated_at) })}
                    </span>
                  ) : (
                    <Skeleton className="h-3 w-32" />
                  )}
                </>
              )}
            </ResponsiveSheetBody>
```

— with:

```tsx
            <Tabs defaultValue="profile" key={row.id} className="flex min-h-0 flex-1 flex-col">
              {/* Four labels (worse in Urdu) risk overflowing a 375px mobile drawer —
               * `overflow-x-auto` lets the list scroll horizontally rather than wrap or
               * clip instead of silently assuming they always fit on one line. Verify
               * visually at 375px in both locales during implementation. */}
              <TabsList variant="line" className="shrink-0 overflow-x-auto px-6">
                <TabsTrigger value="profile">{t("tabs.profile")}</TabsTrigger>
                {canViewGuardians && (
                  <TabsTrigger value="guardians">{t("tabs.guardians")}</TabsTrigger>
                )}
                {canViewEmergencyContacts && (
                  <TabsTrigger value="emergencyContacts">
                    {t("tabs.emergencyContacts")}
                  </TabsTrigger>
                )}
                {canViewDocuments && (
                  <TabsTrigger value="documents">{t("tabs.documents")}</TabsTrigger>
                )}
              </TabsList>

              <TabsContent value="profile" className="flex min-h-0 flex-1 flex-col">
                <ResponsiveSheetBody className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
                  {detailQuery.isError ? (
                    <p className="text-sm text-muted-foreground">{t("detail.loadError")}</p>
                  ) : (
                    <>
                      {sections.map((section) => (
                        <FieldSection key={section.title} title={section.title}>
                          {section.fields.map((field) => (
                            <FieldRow
                              key={field.label}
                              icon={field.icon}
                              label={field.label}
                              value={field.value}
                              isPending={isPending}
                            />
                          ))}
                        </FieldSection>
                      ))}
                      {data ? (
                        <span className="text-xs text-muted-foreground">
                          {t("detail.lastUpdated", { when: formatLastUpdated(data.updated_at) })}
                        </span>
                      ) : (
                        <Skeleton className="h-3 w-32" />
                      )}
                    </>
                  )}
                </ResponsiveSheetBody>
              </TabsContent>

              {canViewGuardians && (
                <TabsContent value="guardians" className="flex min-h-0 flex-1 flex-col">
                  <ResponsiveSheetBody className="flex-1 overflow-y-auto px-6 py-5">
                    <StudentGuardiansTab
                      studentId={row.id}
                      canCreate={hasPermission(currentUser, "students.guardian.create")}
                      canUpdate={hasPermission(currentUser, "students.guardian.update")}
                    />
                  </ResponsiveSheetBody>
                </TabsContent>
              )}

              {canViewEmergencyContacts && (
                <TabsContent value="emergencyContacts" className="flex min-h-0 flex-1 flex-col">
                  <ResponsiveSheetBody className="flex-1 overflow-y-auto px-6 py-5">
                    <StudentEmergencyContactsTab
                      studentId={row.id}
                      canCreate={hasPermission(currentUser, "students.student.update")}
                    />
                  </ResponsiveSheetBody>
                </TabsContent>
              )}

              {canViewDocuments && (
                <TabsContent value="documents" className="flex min-h-0 flex-1 flex-col">
                  <ResponsiveSheetBody className="flex-1 overflow-y-auto px-6 py-5">
                    <StudentDocumentsTab
                      studentId={row.id}
                      canCreate={hasPermission(currentUser, "students.document.create")}
                      canVerify={hasPermission(currentUser, "students.document.verify")}
                      canDelete={hasPermission(currentUser, "students.document.delete")}
                    />
                  </ResponsiveSheetBody>
                </TabsContent>
              )}
            </Tabs>
```

No `asChild` on any `TabsContent` here — round-3 review found that `asChild` passes Radix's tab-panel accessibility wiring (`role="tabpanel"`, `id`, `aria-labelledby`) to its single child via `Slot`, and `ResponsiveSheetBody` (`apps/dashboard/src/components/responsive-dialog.tsx`) only accepts `className`/`children`, so none of that wiring would actually reach a real DOM node — every trigger's `aria-controls` would point at nothing. `TabsContent` without `asChild` renders its own wrapping element carrying that wiring correctly and simply contains `ResponsiveSheetBody` as a normal child; the `className` passed to `TabsContent` keeps it a flex child that doesn't break the surrounding layout (`packages/ui`'s `TabsContent` passes `className` straight through to its own underlying Radix node). Task 10's own test suite gets one new assertion for this (Step 2's test list) — `getByRole("tabpanel")` must resolve for the active tab.

`key={row.id}` remounts the whole `Tabs` tree — and therefore resets to `defaultValue="profile"` — every time the sheet opens for a different student, with no reset effect (this plan's Alternatives Considered). Each non-Profile `TabsContent` has no `activeTab === "<tab>"` guard around it: Radix unmounts an inactive `TabsContent` by default (no `forceMount` anywhere in this plan), so Tasks 7-9's own `useQuery` calls — which have no `enabled` option of their own — never fire until their tab's panel is actually mounted. No extra state is needed to make that true.

- [ ] **Step 3: Confirm all three new tests, and every pre-existing test in this file, pass by construction**

Pre-existing tests that render the Profile tab's own content (`FieldRow`s, `detail.loadError`, `lastUpdated`) still pass unchanged — that markup moved into `TabsContent value="profile"` verbatim, nothing about its own rendering changed.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/features/students/student-detail-sheet.tsx apps/dashboard/src/features/students/__tests__/student-detail-sheet.test.tsx
git commit -m "feat(dashboard): wrap the student detail sheet in Profile/Guardians/Emergency Contacts/Documents tabs"
```

- [ ] **Step 5: Push and read CI**

---

## Task 11: E2E mocked coverage for the three new tabs

**Files:**
- Create: `e2e/src/mocks/domains/guardians.ts`
- Create: `e2e/src/mocks/domains/student-relations.ts`
- Create: `e2e/src/mocks/domains/files.ts`
- Modify: `e2e/src/mocks/domains/jobs.ts` — add `:confirm` to the existing `:fileAction` handler
- Modify: `e2e/src/mocks/index.ts`
- Create: `e2e/tests/dashboard/students-relations.spec.ts`

**Interfaces:**
- Consumes: the existing `MockModule`/`ok`/`fail`/`paginated`/`noContent` helpers (`e2e/src/mocks/envelope.ts`, `e2e/src/mocks/router.ts`), the existing `buildStudent`/`studentsModule` (`e2e/src/mocks/domains/students.ts`), the existing `jobsModule` (`e2e/src/mocks/domains/jobs.ts`), the existing `studentsPage` fixture.
- Produces: `guardiansModule(options)`, `studentRelationsModule(options)`, `filesModule(options)`, registered in `e2e/src/mocks/index.ts` alongside every existing domain module; `jobsModule` gains `:confirm` support.

- [ ] **Step 1: Write `e2e/src/mocks/domains/guardians.ts`**

```ts
import { id } from "@/data/factories";
import { fail, ok, paginated } from "../envelope";
import type { MockModule } from "../router";

export interface Guardian {
  id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  phone: string;
  alt_phone: string | null;
  email: string | null;
  occupation: string | null;
  employer: string | null;
  national_id: string | null;
  photo_file_id: string | null;
  // Mirrors Task 1's new `GuardianSerializer.photo_url` field — kept here so this mock's
  // `Guardian` shape matches the real generated `ApiSchemas["Guardian"]`.
  photo_url: string | null;
  address: Record<string, unknown> | null;
  custom_fields: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface StudentGuardianLink {
  id: string;
  student_id: string;
  guardian_id: string;
  relationship: "father" | "mother" | "grandparent" | "sibling" | "legal_guardian" | "other";
  is_primary: boolean;
  is_fee_responsible: boolean;
  can_pick_up: boolean;
  receives_communications: boolean;
  has_portal_access: boolean;
  access_revoked_reason: string | null;
  created_at: string;
  updated_at: string;
}

export function buildGuardian(overrides: Partial<Guardian> = {}): Guardian {
  return {
    id: id("guardian"),
    user_id: null,
    first_name: "Ayesha",
    last_name: "Raza",
    phone: "0300-0000000",
    alt_phone: null,
    email: null,
    occupation: null,
    employer: null,
    national_id: null,
    photo_file_id: null,
    photo_url: null,
    address: null,
    custom_fields: null,
    created_at: "2026-01-10T00:00:00Z",
    updated_at: "2026-01-10T00:00:00Z",
    ...overrides,
  };
}

export function buildGuardianLink(overrides: Partial<StudentGuardianLink> = {}): StudentGuardianLink {
  return {
    id: id("student-guardian"),
    student_id: "",
    guardian_id: "",
    relationship: "father",
    is_primary: false,
    is_fee_responsible: false,
    can_pick_up: true,
    receives_communications: true,
    has_portal_access: true,
    access_revoked_reason: null,
    created_at: "2026-01-10T00:00:00Z",
    updated_at: "2026-01-10T00:00:00Z",
    ...overrides,
  };
}

export interface GuardiansOptions {
  guardians?: Guardian[];
  links?: StudentGuardianLink[];
}

export function guardiansModule(options: GuardiansOptions = {}): MockModule {
  return (api) => {
    const guardians = [...(options.guardians ?? [])];
    const links = [...(options.links ?? [])];

    api.get("/guardians", (request) => {
      const search = request.searchParams.get("search")?.toLowerCase();
      const matching = guardians.filter(
        (g) =>
          !search ||
          `${g.first_name} ${g.last_name}`.toLowerCase().includes(search) ||
          g.phone.includes(search),
      );
      return paginated(matching);
    });

    api.get("/guardians/:guardianId", (request) => {
      const match = guardians.find((g) => g.id === request.params["guardianId"]);
      return match ? ok(match) : fail(404, "Not found.");
    });

    api.post("/guardians", (request) => {
      const body = (request.json() as Partial<Guardian> | null) ?? {};
      const created = buildGuardian({ ...body, id: id("guardian") });
      guardians.push(created);
      return ok(created, { status: 201 });
    });

    api.patch("/guardians/:guardianId", (request) => {
      const match = guardians.find((g) => g.id === request.params["guardianId"]);
      if (!match) return fail(404, "Not found.");
      Object.assign(match, (request.json() as Partial<Guardian> | null) ?? {});
      return ok(match);
    });

    api.get("/students/:studentId/guardians", (request) => {
      const studentLinks = links.filter((l) => l.student_id === request.params["studentId"]);
      return paginated(studentLinks);
    });

    api.post("/students/:studentId/guardians", (request) => {
      const body = (request.json() as { guardian_id: string } & Partial<StudentGuardianLink>) ?? {};
      const alreadyLinked = links.some(
        (l) => l.student_id === request.params["studentId"] && l.guardian_id === body.guardian_id,
      );
      if (alreadyLinked) {
        // The real shape: `StudentGuardian`'s `UniqueConstraint` -> `IntegrityError` ->
        // `core/api/exceptions.py`'s 409 `conflict` mapping — not an invented 422.
        // `fail`'s default code for 409 is already `"conflict"` (`CODE_BY_STATUS`).
        return fail(409, "The request conflicts with existing data.", {
          details: [
            { field: "non_field", issue: "The request conflicts with existing data." },
          ],
        });
      }
      const created = buildGuardianLink({
        ...body,
        id: id("student-guardian"),
        student_id: request.params["studentId"] ?? "",
      });
      links.push(created);
      return ok(created, { status: 201 });
    });

    api.patch("/student-guardians/:linkId", (request) => {
      const match = links.find((l) => l.id === request.params["linkId"]);
      if (!match) return fail(404, "Not found.");
      const body = (request.json() as Partial<StudentGuardianLink> | null) ?? {};
      if (body.is_primary) {
        for (const link of links) {
          if (link.student_id === match.student_id) link.is_primary = false;
        }
      }
      Object.assign(match, body);
      return ok(match);
    });
  };
}
```

- [ ] **Step 2: Write `e2e/src/mocks/domains/student-relations.ts`**

```ts
import { id } from "@/data/factories";
import { fail, noContent, ok, paginated } from "../envelope";
import type { MockModule } from "../router";

export interface EmergencyContact {
  id: string;
  student_id: string;
  name: string;
  relationship: string;
  phone: string;
  alt_phone: string | null;
  priority: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudentDocument {
  id: string;
  student_id: string;
  file_id: string;
  document_type: string;
  title: string;
  notes: string | null;
  verification_status: "pending" | "verified" | "rejected";
  verified_by: string | null;
  verified_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export function buildEmergencyContact(overrides: Partial<EmergencyContact> = {}): EmergencyContact {
  return {
    id: id("emergency-contact"),
    student_id: "",
    name: "Hamza Raza",
    relationship: "Uncle",
    phone: "0300-0000000",
    alt_phone: null,
    priority: 1,
    notes: null,
    created_at: "2026-01-10T00:00:00Z",
    updated_at: "2026-01-10T00:00:00Z",
    ...overrides,
  };
}

export function buildStudentDocument(overrides: Partial<StudentDocument> = {}): StudentDocument {
  return {
    id: id("student-document"),
    student_id: "",
    file_id: id("file"),
    document_type: "birth_certificate",
    title: "Birth certificate",
    notes: null,
    verification_status: "pending",
    verified_by: null,
    verified_at: null,
    expires_at: null,
    created_at: "2026-01-10T00:00:00Z",
    updated_at: "2026-01-10T00:00:00Z",
    ...overrides,
  };
}

export interface StudentRelationsOptions {
  emergencyContacts?: EmergencyContact[];
  documents?: StudentDocument[];
}

export function studentRelationsModule(options: StudentRelationsOptions = {}): MockModule {
  return (api) => {
    const contacts = [...(options.emergencyContacts ?? [])];
    const documents = [...(options.documents ?? [])];

    api.get("/students/:studentId/emergency-contacts", (request) => {
      const rows = contacts
        .filter((c) => c.student_id === request.params["studentId"])
        .sort((a, b) => a.priority - b.priority);
      return paginated(rows);
    });

    api.post("/students/:studentId/emergency-contacts", (request) => {
      const body = (request.json() as Partial<EmergencyContact> | null) ?? {};
      const created = buildEmergencyContact({
        ...body,
        id: id("emergency-contact"),
        student_id: request.params["studentId"] ?? "",
      });
      contacts.push(created);
      return ok(created, { status: 201 });
    });

    api.get("/students/:studentId/documents", (request) => {
      const rows = documents.filter((d) => d.student_id === request.params["studentId"]);
      return paginated(rows);
    });

    api.post("/students/:studentId/documents", (request) => {
      const body = (request.json() as Partial<StudentDocument> | null) ?? {};
      const created = buildStudentDocument({
        ...body,
        id: id("student-document"),
        student_id: request.params["studentId"] ?? "",
      });
      documents.push(created);
      return ok(created, { status: 201 });
    });

    api.delete("/student-documents/:documentId", (request) => {
      const index = documents.findIndex((d) => d.id === request.params["documentId"]);
      if (index === -1) return fail(404, "Not found.");
      documents.splice(index, 1);
      return noContent();
    });

    api.post("/student-documents/:documentAction", (request) => {
      const [documentId, action] = (request.params["documentAction"] ?? "").split(":");
      const match = documents.find((d) => d.id === documentId);
      if (!match) return fail(404, "Not found.");
      if (action === "verify") {
        const { decision } = (request.json() as { decision: "verified" | "rejected" }) ?? {};
        match.verification_status = decision;
        return ok(match);
      }
      if (action === "download") {
        // Task 1's own `students.document.view`-gated `:download` action — a dedicated
        // path on this resource, NOT the generic `/files/{id}:download` `jobsModule`
        // owns. `Services.students.getDocumentDownloadUrl` calls this one specifically.
        return ok({ download_url: `https://files.example.test/download/${documentId}` });
      }
      return fail(404, "Not found.");
    });
  };
}
```

Document download IS handled here, on this module's own `/student-documents/{id}:download` path — distinct from `jobsModule`'s `/files/{id}:download`, which stays `/staff`'s export download path only. A spec exercising the Documents tab's download button needs no `jobsModule`/`filesModule` composition for it at all.

- [ ] **Step 3: Write `e2e/src/mocks/domains/files.ts` — `POST /files` (create)**

`jobsModule` only ever covered `:download` (Phase 1 never needed the other two steps in E2E — its own photo-upload flow has no E2E coverage today, confirmed by grepping `e2e/src/mocks/` for `/files` and `uploadFile`). Task 9's document-upload test is the first E2E spec to exercise `Services.files.uploadFile`'s full three-step flow (`apps/dashboard/src/services/modules/files/files-service.ts`). `POST /files` is a path `jobsModule` never touches, so it's safe as its own new module:

```ts
import { id } from "@/data/factories";
import { ok } from "../envelope";
import type { MockModule } from "../router";

export interface FilesOptions {
  /** The storage PUT target every upload in a spec resolves to — a fixed URL is enough;
   * nothing in this mock module serves it, a spec's own Playwright `page.route` for this
   * exact URL intercepts the PUT itself (`files-service.ts` sends it with a plain
   * `fetch`, never through this API mock or `apiClient`). */
  uploadUrl?: string;
}

/** `POST /files` — step one of the real three-step upload flow (`files-service.ts`'s
 * own header comment). Step three (`POST /files/{id}:confirm`) is NOT handled here —
 * `e2e/src/mocks/router.ts`'s router has no fallthrough between modules (the
 * most-recently-`.use()`-registered route wins a given path exclusively; a handler
 * genuinely cannot defer to a different module's handler for the same path), so a
 * second handler on `/files/:fileAction` here would shadow `jobsModule`'s existing
 * `:download` handler rather than coexist with it. `:confirm` is added to `jobsModule`
 * itself instead (this task's Step 4) — the one module that already owns that path. */
export function filesModule(options: FilesOptions = {}): MockModule {
  const uploadUrl = options.uploadUrl ?? "https://files.example.test/upload-target";
  return (api) => {
    api.post("/files", (request) => {
      const body =
        (request.json() as { original_name: string; mime_type: string; size_bytes: number } | null) ??
        { original_name: "file", mime_type: "application/octet-stream", size_bytes: 0 };
      return ok(
        {
          id: id("file"),
          ...body,
          upload_url: uploadUrl,
          upload_method: "PUT",
          headers: { "Content-Type": body.mime_type },
          expires_at: "2027-01-01T00:00:00Z",
        },
        { status: 201 },
      );
    });
  };
}
```

- [ ] **Step 4: Extend the existing `jobsModule` to also answer `POST /files/{id}:confirm`**

Modify `e2e/src/mocks/domains/jobs.ts`. Its own handler comment is wrong about what happens when `action !== "download"` — reading `router.ts` directly (Step 3's own finding) shows there is no fallthrough to a different module's handler for an unmatched action on a path this module already owns; a second module registering the same path would shadow this one's `:download` entirely, not coexist with it. The correct fix is to let this module answer `:confirm` itself:

```diff
-    // `POST /files/{id}:download` is a colon-action — same split as
-    // staffModule's `/staff/{id}:exit` handling. `action` genuinely can only be
-    // "download" here — `:confirm` is a different, unrelated route registered by a
-    // future files-domain module, not this one, and 404s correctly falling through
-    // this handler if it's ever hit is the point.
+    // `POST /files/{id}:download` and `POST /files/{id}:confirm` are both colon-actions
+    // on the same path — same split as staffModule's `/staff/{id}:exit` handling. Both
+    // live in this one handler because `router.ts` has no fallthrough between modules: a
+    // second handler registered on this path by a different module would shadow this
+    // one entirely rather than share it, so every `/files/:fileAction` action this app
+    // can send belongs in whichever module already owns the path — this one.
     api.post("/files/:fileAction", (request) => {
       const [fileId, action] = (request.params["fileAction"] ?? "").split(":");
+      if (action === "confirm") return ok({ id: fileId });
       const file = files.find((candidate) => candidate.id === fileId);
       if (action !== "download" || !file) return fail(404, "Not found.");
       return ok({ download_url: file.downloadUrl });
     });
```

`:confirm` always succeeds unconditionally (it doesn't need to find anything in `options.files`, which exists only to stub `:download` targets) — a spec confirming a file it just created via `filesModule`'s `POST /files` has no reason to also list that id in `jobsModule({files})`.

- [ ] **Step 5: Register the new module in `e2e/src/mocks/index.ts`**

Add `export * from "./domains/guardians";`, `export * from "./domains/student-relations";` and `export * from "./domains/files";` alongside the file's existing per-domain exports (`export * from "./domains/students";` etc. — confirm the exact existing line to match its style before adding these).

- [ ] **Step 6: Write `e2e/tests/dashboard/students-relations.spec.ts`**

```ts
import { expect, test } from "@/fixtures";
import { buildUser, SCHOOL_ADMIN_PERMISSIONS } from "@/data/factories";
import { buildCampus, schoolOrganizationModule } from "@/mocks";
import { buildStudent, studentsModule } from "@/mocks";
import { buildGuardian, buildGuardianLink, guardiansModule } from "@/mocks";
import { buildEmergencyContact, buildStudentDocument, studentRelationsModule } from "@/mocks";
import { filesModule, jobsModule } from "@/mocks";

const UPLOAD_URL = "https://files.example.test/upload-target";

const campuses = [buildCampus({ id: "campus-0001", name: "Main Campus" })];
const student = buildStudent({ id: "student-0001", first_name: "Ayesha", last_name: "Khan" });

test.describe("student detail sheet — relations tabs", () => {
  test.use({
    authUser: buildUser({
      permissions: [
        ...SCHOOL_ADMIN_PERMISSIONS,
        // `SCHOOL_ADMIN_PERMISSIONS` (e2e/src/data/factories.ts) holds
        // `students.student.view` but not `.update` — confirmed by reading the file
        // directly, not assumed. The emergency-contact Add button is gated on `.update`
        // (Task 10), so it must be granted explicitly here.
        "students.student.update",
        "students.guardian.view",
        "students.guardian.create",
        "students.guardian.update",
        "students.document.view",
        "students.document.create",
        "students.document.verify",
        "students.document.delete",
      ],
    }),
  });

  test("links an existing guardian found by search", async ({ page, signedIn: _signedIn, mockApi, studentsPage }) => {
    const guardian = buildGuardian({ id: "guardian-0001", first_name: "Bilal", last_name: "Ahmed" });
    mockApi.use(
      schoolOrganizationModule({ campuses, houses: [] }),
      studentsModule({ students: [student] }),
      guardiansModule({ guardians: [guardian] }),
      studentRelationsModule({}),
    );
    await studentsPage.goto();
    await studentsPage.row("Ayesha Khan").click();
    await page.getByRole("tab", { name: /^guardians$/i }).click();
    await page.getByRole("button", { name: /link guardian/i }).click();

    await page.getByLabel(/search by name or phone/i).fill("Bilal");
    // The results Select renders its options only once opened — same reason the Jest
    // tests (Task 6) open this trigger before clicking an option.
    await page.getByRole("combobox", { name: /search existing/i }).click();
    await page.getByRole("option", { name: /bilal ahmed/i }).click();
    await page.getByRole("combobox", { name: /relationship/i }).click();
    await page.getByRole("option", { name: /^father$/i }).click();
    // Scoped to the open dialog: the tab's own "Link guardian" trigger button (which
    // opened this dialog) stays mounted behind it and shares this exact text, so an
    // unscoped query here would match two elements.
    await page.getByRole("dialog").getByRole("button", { name: /^link guardian$/i }).click();

    await expect(page.getByText("Bilal Ahmed")).toBeVisible();
  });

  test("promotes a guardian to primary", async ({ page, signedIn: _signedIn, mockApi, studentsPage }) => {
    const guardian = buildGuardian({ id: "guardian-0001", first_name: "Bilal", last_name: "Ahmed" });
    const link = buildGuardianLink({
      id: "link-0001",
      student_id: "student-0001",
      guardian_id: "guardian-0001",
      is_primary: false,
    });
    mockApi.use(
      schoolOrganizationModule({ campuses, houses: [] }),
      studentsModule({ students: [student] }),
      guardiansModule({ guardians: [guardian], links: [link] }),
      studentRelationsModule({}),
    );
    await studentsPage.goto();
    await studentsPage.row("Ayesha Khan").click();
    await page.getByRole("tab", { name: /^guardians$/i }).click();
    await page.getByRole("button", { name: /make primary/i }).click();

    await expect(page.getByText(/^primary$/i)).toBeVisible();
  });

  test("adds an emergency contact", async ({ page, signedIn: _signedIn, mockApi, studentsPage }) => {
    mockApi.use(
      schoolOrganizationModule({ campuses, houses: [] }),
      studentsModule({ students: [student] }),
      guardiansModule({}),
      studentRelationsModule({}),
    );
    await studentsPage.goto();
    await studentsPage.row("Ayesha Khan").click();
    await page.getByRole("tab", { name: /emergency contacts/i }).click();
    await page.getByRole("button", { name: /add contact/i }).click();

    await page.getByLabel(/^name$/i).fill("Zainab Malik");
    await page.getByLabel(/relationship/i).fill("Aunt");
    await page.getByLabel(/^phone$/i).fill("0300-3333333");
    // Scoped to the open dialog: the tab's own "Add contact" trigger button stays
    // mounted behind it and shares this exact text.
    await page.getByRole("dialog").getByRole("button", { name: /^add contact$/i }).click();

    await expect(page.getByText("Zainab Malik")).toBeVisible();
  });

  test("uploads a document, then verifies it", async ({ page, signedIn: _signedIn, mockApi, studentsPage }) => {
    mockApi.use(
      schoolOrganizationModule({ campuses, houses: [] }),
      studentsModule({ students: [student] }),
      guardiansModule({}),
      studentRelationsModule({}),
      filesModule({ uploadUrl: UPLOAD_URL }),
      jobsModule({}),
    );
    // `files-service.ts`'s PUT-to-storage step is a plain `fetch` straight to the
    // presigned URL, never through `apiClient` — `mockApi` only intercepts this app's
    // own API origin, so the storage PUT needs its own route. `UPLOAD_URL` is a
    // different origin than the app itself, and a PUT with a non-form `Content-Type`
    // (a real image/PDF mime type isn't CORS-"simple") makes the browser send an
    // `OPTIONS` preflight to this same URL first — fulfilling only the PUT, with no
    // CORS headers on either response, makes the browser's own CORS check fail before
    // the real PUT is ever sent, regardless of what this route returns for it.
    await page.route(UPLOAD_URL, (route) => {
      const corsHeaders = {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "PUT, OPTIONS",
        "access-control-allow-headers": "content-type",
      };
      if (route.request().method() === "OPTIONS") {
        return route.fulfill({ status: 204, headers: corsHeaders });
      }
      return route.fulfill({ status: 200, body: "", headers: corsHeaders });
    });
    await studentsPage.goto();
    await studentsPage.row("Ayesha Khan").click();
    await page.getByRole("tab", { name: /^documents$/i }).click();
    await page.getByRole("button", { name: /upload document/i }).click();

    await page.getByLabel(/^file$/i).setInputFiles({
      name: "birth-cert.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("fake pdf bytes"),
    });
    // A title distinct from "Birth certificate" — the default document type (never
    // changed here) already renders that exact string as its own type label, and a title
    // matching it would make `getByText` match two elements and fail Playwright's
    // strict-mode check.
    await page.getByLabel(/^title$/i).fill("Ayesha's birth certificate scan");
    // Scoped to the open dialog: the tab's own "Upload document" trigger button stays
    // mounted behind it and shares this exact text in its non-pending state.
    await page.getByRole("dialog").getByRole("button", { name: /^upload document$/i }).click();

    await expect(page.getByText("Ayesha's birth certificate scan")).toBeVisible();
    await expect(page.getByText(/pending/i)).toBeVisible();

    await page.getByRole("button", { name: /^verify$/i }).click();
    await expect(page.getByText(/^verified$/i)).toBeVisible();
  });

  test("deletes a document after confirming", async ({ page, signedIn: _signedIn, mockApi, studentsPage }) => {
    const document = buildStudentDocument({
      id: "document-0001",
      student_id: "student-0001",
      title: "Old document",
    });
    mockApi.use(
      schoolOrganizationModule({ campuses, houses: [] }),
      studentsModule({ students: [student] }),
      guardiansModule({}),
      studentRelationsModule({ documents: [document] }),
    );
    await studentsPage.goto();
    await studentsPage.row("Ayesha Khan").click();
    await page.getByRole("tab", { name: /^documents$/i }).click();
    await page.getByRole("button", { name: /^delete$/i }).click();
    // Scoped to the open confirmation dialog: its own confirm button reuses the exact
    // same "Delete" label as the row's trigger button that just opened it.
    await page.getByRole("alertdialog").getByRole("button", { name: /^delete$/i }).click();

    await expect(page.getByText("Old document")).toHaveCount(0);
  });
});

test.describe("student detail sheet — relations tabs, view-only permissions", () => {
  test.use({
    authUser: buildUser({
      // View-only: granted exactly enough to see the tabs (Task 10 gates each
      // `TabsTrigger` on its own view key — `students.student.view`, already in
      // `SCHOOL_ADMIN_PERMISSIONS`, covers Emergency Contacts), never the create/update/
      // verify/delete keys those tabs' own action buttons are gated on. Without
      // `.guardian.view`/`.document.view` explicitly added here, the Guardians and
      // Documents tabs wouldn't render at all and the clicks below would time out.
      permissions: [
        ...SCHOOL_ADMIN_PERMISSIONS,
        "students.guardian.view",
        "students.document.view",
      ],
    }),
  });

  test("hides every relation-tab action for a caller without those permissions", async ({
    page,
    signedIn: _signedIn,
    mockApi,
    studentsPage,
  }) => {
    const contact = buildEmergencyContact({ student_id: "student-0001", name: "Hamza Raza" });
    mockApi.use(
      schoolOrganizationModule({ campuses, houses: [] }),
      studentsModule({ students: [student] }),
      guardiansModule({}),
      studentRelationsModule({ emergencyContacts: [contact] }),
    );
    await studentsPage.goto();
    await studentsPage.row("Ayesha Khan").click();

    await page.getByRole("tab", { name: /^guardians$/i }).click();
    await expect(page.getByRole("button", { name: /link guardian/i })).toHaveCount(0);

    await page.getByRole("tab", { name: /emergency contacts/i }).click();
    await expect(page.getByRole("button", { name: /add contact/i })).toHaveCount(0);

    await page.getByRole("tab", { name: /^documents$/i }).click();
    await expect(page.getByRole("button", { name: /upload document/i })).toHaveCount(0);
  });
});
```

(`SCHOOL_ADMIN_PERMISSIONS` holds `students.student.view` but not `.update` — confirmed by reading `e2e/src/data/factories.ts` directly; that's why the first `describe` block above grants `.update` explicitly rather than assuming it comes for free.)

- [ ] **Step 7: Commit**

```bash
git add e2e/src/mocks/domains/guardians.ts e2e/src/mocks/domains/student-relations.ts e2e/src/mocks/domains/files.ts e2e/src/mocks/domains/jobs.ts e2e/src/mocks/index.ts e2e/tests/dashboard/students-relations.spec.ts
git commit -m "test(e2e): add mocked coverage for the guardians/emergency-contacts/documents tabs"
```

- [ ] **Step 8: Push and read CI**

---

## Task 12: Docs

**Files:**
- Modify: `docs/03-modules/student-management.md`
- Modify: `docs/project-status.md`
- Modify: `docs/deferred-work.md`

- [ ] **Step 1: Update §20 of the module doc**

Add, after Phase 1's existing "as shipped" paragraph (do not edit that paragraph itself):

```markdown
**Dashboard, Phase 2 (as shipped).** `StudentDetailSheet` is now tabbed — Profile (Phase 1's
original flat content, unchanged), Guardians, Emergency Contacts, Documents — each tab's data
fetched only once it is actually opened. Guardians: link an existing guardian (tenant-wide
search) or create one inline, set relationship + per-link flags, promote to primary with one
click, edit a link's flags or a guardian's own fields later — no unlink (the API has none).
Emergency contacts: add-only, ordered by priority — no edit, no delete (the API has neither).
Documents: upload (type from the 6 seeded defaults), verify/reject, delete (with confirmation),
download (a fresh signed URL requested per click, with `Content-Disposition: attachment` forcing
a real download regardless of file type, via a `students.document.view`-gated `:download`
action of its own rather than the broader, every-staff-role `core/files` endpoint). Nearly every
endpoint this phase's dashboard work calls was already live; independent plan review added four
small, deliberate backend changes alongside them: `GuardianSerializer.photo_url` (so a
guardian's photo can actually be displayed, same purpose-gated pattern as the student one),
`principal` gaining `students.document.view` in the registry (closing a pre-existing gap where
`principal` could verify a document but not see the tab to do it from — reaches dev/e2e-seeded
tenants only; `docs/deferred-work.md` records the platform-wide absence of any production
default-role-provisioning mechanism, which this phase surfaced but does not fix), a
`Content-Disposition` header on `core/files`' signed download URLs (a generic fix, applied to
every presigner, that also benefits `/staff`'s existing export download), and the new
document-scoped `:download` action itself. The remaining backend work was closing four
pre-existing test coverage gaps (guardian search/list, a single link's retrieve, a guardian's own
PATCH, and emergency contacts' cross-tenant isolation) plus two more the review rounds surfaced
(a foreign-tenant guardian link read, and the guardian-link duplicate-conflict response).
```

- [ ] **Step 2: Update `project-status.md`'s student-management row**

In the "Dashboard screens" column of the `student-management` row (table under "Per-module implementation matrix"), change "Guardians/emergency contacts/documents... are **not yet rebuilt**" to reflect Phase 2 shipping: name what's now built (the four tabs) and narrow the remaining gap to enrollment/transfers (Phase 3) and bulk import/export/ID cards (Phase 4) only.

- [ ] **Step 3: Add two new entries to `deferred-work.md`, and update two existing ones this phase resolves in part**

(Task 1 Step 7 already added a third entry — the platform-wide "no production mechanism provisions a tenant's default roles" gap — in its own commit; this step does not duplicate it.)

Add these two new entries:

```markdown
- **No unlink for a student-guardian link, no edit/delete for an emergency contact.**
  `StudentGuardianLinkViewSet` and `EmergencyContactLinkViewSet` (`apps/api/apps/student_management/views.py`)
  are both list+create only — confirmed by reading the real viewset classes, not assumed. The
  students Phase 2 dashboard work (`docs/superpowers/plans/2026-10-03-students-phase2-relations.md`)
  states this plainly in its UI copy rather than inventing a workaround. Adding these endpoints
  is a real, separate backend decision (what happens to history/audit on an unlink; whether an
  emergency contact edit needs its own permission key) — not a UI gap to quietly patch over.
- **Staff's photo-upload field is still its own inline copy.** `students-dashboard-phase2`
  extracted `PhotoUploadField` (`apps/dashboard/src/components/photo-upload-field.tsx`, a neutral
  location with a generic `purpose: string` prop) on its third near-identical copy — students'
  original, and this phase's new guardian form. `apps/dashboard/src/app/(app)/staff/staff-form-dialog.tsx`
  still has its own fourth copy of the same presigned-upload-then-preview flow, left unmigrated
  in this PR since staff is outside this phase's scope. Migrating it is a small, mechanical
  swap — pass `purpose="staff.photo"` and staff's own saved-photo fields — next time staff's
  form is touched.
```

Update the existing "Inline display links for files" entry (`docs/deferred-work.md`, PR #76) — this phase closes the specific gap it names for guardians, so the sentence can't stand as written:

- Delete the sentence **"Guardians still expose only `photo_file_id` — the same one-line addition, when a guardian-facing screen needs photos."** (Task 1 is that one-line addition — `GuardianSerializer.photo_url`, same pattern, now shipped.)
- In its nested **"`photo_url`'s purpose gate is student-only"** bullet, change the heading and opening sentence to **"`photo_url`'s purpose gate doesn't reach staff."** — `GuardianSerializer.photo_url` (Task 1) now carries the identical `SerializerMethodField` purpose check as the student and guardian fields; `StaffSerializer.photo_url` is the one remaining holdout still on the plain `SignedFileURLField` with no purpose check. Leave the rest of that bullet's reasoning (the ownership-guard-vs-already-attached-file distinction, what fixing staff would need) unchanged — it still applies, just to staff alone now instead of staff-and-guardians.

Do NOT add anything about seed-command cross-app imports here — that topic has nothing to do with this phase (no seed command is touched by any task in this plan) and does not belong in this phase's documentation update.

- [ ] **Step 4: Commit**

```bash
git add docs/03-modules/student-management.md docs/project-status.md docs/deferred-work.md
git commit -m "docs: record the students Phase 2 (guardians/emergency contacts/documents) delivery"
```

- [ ] **Step 5: Push and read CI**

---

## Verification

End-to-end after Task 11: sign in as `school_admin` on a seeded dev tenant, open a student's detail sheet, confirm it opens on Profile exactly as before. Switch to Guardians: link an existing guardian via search, link a brand-new one via create, promote one to primary (watch the other's badge disappear), edit a link's flags, edit a guardian's own phone number. Switch to Emergency Contacts: add one, confirm there is no edit or delete control anywhere on its row. Switch to Documents: upload a PDF, confirm it shows "Pending", verify it, confirm the badge updates, download it (confirm a real signed URL opens), delete a different document after confirming. Switch back to Profile and confirm nothing there changed. Reopen the sheet for a different student and confirm it defaults to Profile again, not whatever tab was last open.

