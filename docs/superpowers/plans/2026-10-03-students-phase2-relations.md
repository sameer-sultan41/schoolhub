# Students Dashboard — Phase 2: Guardians, Emergency Contacts & Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Guardians, Emergency Contacts and Documents to `/students`' detail view — a tabbed `StudentDetailSheet` (Profile/Guardians/Emergency Contacts/Documents) backed entirely by backend endpoints that already exist.

**Architecture:** Each relation gets its own small feature component (tab) reading/writing through a new `Services.guardians` domain plus additions to `Services.students`/`Services.files`. No new backend code — this is a dashboard-only phase, closing four named backend test gaps along the way.

**Tech Stack:** Next.js 16, TanStack Query v5, react-hook-form + zod, `@schoolhub/ui` (`Tabs`, first real consumer in this app), Django 6.1 + DRF (tests only).

**Spec:** `docs/superpowers/specs/2026-10-03-students-phase2-relations-design.md`

## Global Constraints

- **No new backend production code.** Every endpoint this phase calls already exists and is wired (`GuardianViewSet`, `StudentGuardianViewSet`, `StudentGuardianLinkViewSet`, `EmergencyContactLinkViewSet`, `StudentDocumentLinkViewSet`, `StudentDocumentViewSet`, `core/files`' `:download`). Backend work in this plan is test-only.
- **No unlink, no emergency-contact edit/delete.** The backend has no endpoints for any of these (`StudentGuardianLinkViewSet` and `EmergencyContactLinkViewSet` are both list+create only). No task invents a workaround; the UI states this plainly where relevant and `docs/deferred-work.md` records it.
- **`StudentGuardian.relationship` is a fixed 6-value enum** (`Relationship` in `apps/api/apps/student_management/models.py`: `father`, `mother`, `grandparent`, `sibling`, `legal_guardian`, `other`) — a `<Select>`, not free text. **`EmergencyContact.relationship` is free text** (`models.CharField(max_length=50)`, no choices) — a plain `<Input>`. These are different fields on different models; do not conflate them.
- **The guardian-link list has no embedded guardian name/phone.** `StudentGuardianSerializer` (`GET /students/{id}/guardians`) returns only `guardian_id` plus link fields — never the guardian's own name/phone. `StudentGuardiansTab` must fan out a `GET /guardians/{id}` per unique `guardian_id` in the links (via `useQueries`) to render a name at all. This is a real, confirmed API shape, not an oversight to design around.
- **Reuse the existing i18n scaffolding.** `apps/dashboard/messages/en.json`/`ur.json` already carry `students.tabs`, `students.guardians`, `students.emergencyContacts`, `students.documents` namespaces (committed on `main`, dating from pre-dashboard-shell-reset work — confirmed real, fully translated in both locales) with the right `Relationship`/`DEFAULT_DOCUMENT_TYPES` values already baked in. Task 4 audits and reuses these; it does not invent a parallel set of keys. The one fix needed: `guardians.close` duplicates `common.close` (Phase 1's established convention is to reuse `common.*` for generic verbs, never a per-screen near-duplicate) — delete `guardians.close` from both locales and use `tCommon("close")` at its one call site.
- **`GuardianFormDialog`'s field scope is deliberately minimal:** `first_name`, `last_name`, `phone` (required), `alt_phone`, `email` (optional), plus a photo (purpose `guardian.photo`, mirroring `StudentPhotoField`). `occupation`, `employer`, `national_id`, `address`, `custom_fields`, `user_id` are real `Guardian` fields but out of scope this phase (YAGNI — nothing in the module doc or this phase's spec calls them out as priorities; all are nullable server-side, so omitting them client-side is safe).
- **Link defaults match `link_guardian`'s own service defaults exactly:** `is_primary: false`, `is_fee_responsible: false`, `can_pick_up: true`, `receives_communications: true`, `has_portal_access: true`. A form that defaults differently from the service it calls is a latent bug the first time a user doesn't touch every checkbox.
- **"Make primary" is a one-click row action, never a dialog.** Promoting a link doesn't need relationship/other-flags context — it's `updateGuardianLink(linkId, { isPrimary: true })` on click, shown only on a non-primary row. Editing the other four flags plus relationship is a separate `GuardianLinkFlagsDialog`, which never includes `is_primary` (demoting without picking a replacement primary is a confusing half-action the backend doesn't even support as a direct operation — `_demote_primary_guardian` only ever runs as a side effect of promoting someone else).
- **A document's download link is fetched fresh per click, never cached.** `getDownloadUrl` always calls `POST /files/{id}:download`; the resulting URL is opened immediately (`window.open`) and discarded, not stored in component state or React Query's cache — a signed URL has a server-side TTL and caching it would eventually hand out an expired link.
- **Every new permission-gated control uses `hasPermission(currentUser, key)` directly** (Phase 1's established pattern) — no `<Can>` wrapper component exists in the current app and this plan does not add one.
- **Lazy per-tab data loading.** Each tab's own query is `enabled: open && activeTab === "<tab>"` — opening the sheet must not fire all three new tabs' requests before the viewer has picked one.
- **Colors/RTL/imports:** `--sh-*` tokens only, logical CSS properties only, `@/` alias only, `@schoolhub/api-client` only inside `src/services/**`/`src/lib/**` (ADR-0011).
- **New files cannot add an ESLint `max-lines` suppression** — the baseline is shrink-only (ADR-0014).
- **Tests:** sibling `__tests__/` folders. Coverage floor is 85% global and only ever rises.
- **Never run tests, linters or typechecks locally.** Commit, push, watch `gh pr checks <n> --watch`.

## Review Focus

1. **A guardian search with zero results.** The picker must show "No guardians found" (i18n'd) with "Create new" still reachable from the same dialog — not a blank box that looks broken. Pinned in Task 6.
2. **Linking a guardian already linked to this student.** The DB has a real unique constraint (`StudentGuardianConstraintTests.test_a_second_link_between_the_same_student_and_guardian_is_rejected`, confirmed in `apps/api/apps/student_management/tests/test_guardians_documents.py`) — the UI must surface the server's real conflict message via `resolveErrorMessage(..., "non_field")`, not swallow it or show a generic fallback. Pinned in Task 6.
3. **An emergency contact or document action rendered for a caller without the permission.** Each gated button must be genuinely absent (not merely disabled) for a caller lacking the key — matching Phase 1's `canUpdate`/`canWithdraw` precedent. Pinned in Tasks 7, 8, 9.
4. **A document upload that fails at the PUT-to-storage step vs. the create/confirm step.** `Services.files.uploadFile`'s `FileUploadError` already carries a step-specific message (Phase 1's `StudentPhotoField` precedent) — `DocumentUploadDialog` must surface that real message, not a generic "upload failed." Pinned in Task 9.
5. **A tab switched away from and back while its own data is mid-fetch.** `enabled: open && activeTab === "<tab>"` toggling to `false` and back to `true` must not leave a stale error or loading state from the interrupted first fetch — TanStack Query's own `enabled` semantics already handle this correctly (re-enabling re-fires `queryFn` from scratch), but the test suite proves it rather than assuming it. Pinned in Task 10.

## File Structure

```
apps/api/apps/student_management/tests/test_guardians_documents.py   # MODIFY — 4 new tests (Task 1)

apps/dashboard/src/services/modules/guardians/
  guardians-service.ts                     # CREATE (Task 2)
  guardians-type.ts                        # CREATE (Task 2)
  index.ts                                 # CREATE (Task 2)
  __tests__/guardians-service.test.ts      # CREATE (Task 2)

apps/dashboard/src/services/modules/students/
  student-relations-service.ts             # CREATE — emergency contacts + documents (Task 3)
  student-relations-type.ts                # CREATE (Task 3)
  index.ts                                 # MODIFY — re-export the new functions (Task 3)
  __tests__/student-relations-service.test.ts   # CREATE (Task 3)

apps/dashboard/src/services/modules/files/
  files-service.ts                         # MODIFY — add getDownloadUrl (Task 3)
  index.ts                                 # MODIFY (Task 3)
  __tests__/files-service.test.ts          # MODIFY (Task 3)

apps/dashboard/src/services/endpoints.ts   # MODIFY — guardians/student-guardians/emergency-contacts/documents/files:download paths (Task 2, 3)

apps/dashboard/messages/en.json, ur.json   # MODIFY — reuse + fix existing students.tabs/guardians/emergencyContacts/documents (Task 4)

apps/dashboard/src/features/students/
  guardian-photo-field.tsx                 # CREATE — its own copy, not shared with student-photo-field.tsx (Task 5)
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
e2e/src/mocks/index.ts                     # MODIFY (Task 11)
e2e/tests/dashboard/students-relations.spec.ts  # CREATE (Task 11)

docs/03-modules/student-management.md      # MODIFY — §20 update (Task 12)
docs/project-status.md                     # MODIFY (Task 12)
docs/deferred-work.md                      # MODIFY — unlink/edit/delete gaps (Task 12)
```

---

## Task 1: Backend — close the four named test gaps

**Files:**
- Modify: `apps/api/apps/student_management/tests/test_guardians_documents.py`

**Interfaces:**
- Consumes: nothing new — these are tests against already-shipped, already-correct endpoints.
- Produces: nothing consumed by later tasks (backend-only, independent of every frontend task).

No production code changes in this task. `GuardianLinkTests`, `GuardianPhotoFileTests`, `EmergencyContactTests`, `StudentDocumentTests` and `CrossTenantGuardianDocumentTests` already exist in this file (confirmed by reading it directly) — add new test methods to the existing classes, matching their real fixtures and helpers exactly.

- [ ] **Step 1: Write the four failing tests**

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

Add to `CrossTenantGuardianDocumentTests` (the class already builds `self.own`/`self.foreign` dicts via `_build`, which already includes a `"contact"` key — confirmed by reading the file):

```python
    def test_listing_emergency_contacts_under_a_foreign_student_is_404(self) -> None:
        response = self.client.get(
            f"/api/v1/students/{self.foreign['student'].pk}/emergency-contacts"
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
```

- [ ] **Step 2: Confirm the tests fail by construction (do not run them)**

`test_searching_guardians_by_name_returns_matches` and `test_retrieving_a_single_guardian_link_succeeds` exercise real, already-correct endpoints — they would pass immediately once written, proving the gap was test coverage, not behavior. `test_patching_a_guardians_own_fields_succeeds` likewise. `test_listing_emergency_contacts_under_a_foreign_student_is_404` exercises `EmergencyContactLinkViewSet`'s existing `_NestedUnderStudentMixin.get_student()` 404 behavior, already proven for guardians/documents in the same class — by construction, this passes too. None of these tests are expected to fail; they close a coverage gap against correct, shipped code, which is the point of this task.

- [ ] **Step 3: Commit**

```bash
git add apps/api/apps/student_management/tests/test_guardians_documents.py
git commit -m "test(api): close four guardian/emergency-contact test gaps"
```

- [ ] **Step 4: Push and read CI**

---

## Task 2: `Services.guardians`

**Files:**
- Modify: `apps/dashboard/src/services/endpoints.ts`
- Create: `apps/dashboard/src/services/modules/guardians/guardians-service.ts`
- Create: `apps/dashboard/src/services/modules/guardians/guardians-type.ts`
- Create: `apps/dashboard/src/services/modules/guardians/index.ts`
- Create: `apps/dashboard/src/services/modules/guardians/__tests__/guardians-service.test.ts`

**Interfaces:**
- Consumes: `apiClient` (`@/lib/auth`), `fetchPage` (`@schoolhub/api-client`).
- Produces: `Services.guardians.{searchGuardians,createGuardian,updateGuardian,linkGuardianToStudent,updateGuardianLink,fetchGuardianLinks}`, `GuardianRecord`, `GuardianLinkRecord`, `GuardianRelationship` types. Consumed by Tasks 5, 6, 7.

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
    mockGet.mockResolvedValue({
      data: [{ id: "g1", first_name: "Ayesha", last_name: "Raza" }],
      meta: { pagination: { page: 1, page_size: 20, total_count: 1, total_pages: 1 } },
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
      meta: { pagination: { page: 1, page_size: 20, total_count: 1, total_pages: 1 } },
    });

    const result = await fetchGuardianLinks("student-1");

    expect(mockGet).toHaveBeenCalledWith(
      "/students/student-1/guardians",
      expect.objectContaining({ query: { page_size: 20 } }),
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

- [ ] **Step 4: Write `guardians-service.ts`**

```ts
import { fetchPage } from "@schoolhub/api-client";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
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

/** Reference-data-sized page for a live search dropdown — not `MAX_PAGE_SIZE` (reserved
 * for a small, bounded reference list like campuses/houses): a tenant-wide guardian
 * search can realistically match far more than that, and a search dropdown only ever
 * shows a handful of results at once regardless. */
const SEARCH_PAGE_SIZE = 20;

export async function searchGuardians(search: string): Promise<GuardianRecord[]> {
  const { items } = await fetchPage<GuardianRecord>(apiClient, endpoints.guardians.list, {
    query: { search, page_size: SEARCH_PAGE_SIZE },
  });
  return items;
}

export async function createGuardian(input: CreateGuardianInput): Promise<GuardianRecord> {
  const { data } = await apiClient.post<GuardianRecord>(endpoints.guardians.list, {
    first_name: input.firstName,
    last_name: input.lastName,
    phone: input.phone,
    ...(input.altPhone ? { alt_phone: input.altPhone } : {}),
    ...(input.email ? { email: input.email } : {}),
    ...(input.photoFileId ? { photo_file_id: input.photoFileId } : {}),
  });
  return data;
}

export async function updateGuardian(
  id: string,
  input: UpdateGuardianInput,
): Promise<GuardianRecord> {
  const body: Record<string, unknown> = {};
  if (input.firstName !== undefined) body.first_name = input.firstName;
  if (input.lastName !== undefined) body.last_name = input.lastName;
  if (input.phone !== undefined) body.phone = input.phone;
  if (input.altPhone !== undefined) body.alt_phone = input.altPhone;
  if (input.email !== undefined) body.email = input.email;
  if (input.photoFileId !== undefined) body.photo_file_id = input.photoFileId;
  const { data } = await apiClient.patch<GuardianRecord>(endpoints.guardians.detail(id), body);
  return data;
}

export async function linkGuardianToStudent(
  studentId: string,
  input: LinkGuardianInput,
): Promise<GuardianLinkRecord> {
  const { data } = await apiClient.post<GuardianLinkRecord>(
    endpoints.guardians.studentLinks(studentId),
    {
      guardian_id: input.guardianId,
      relationship: input.relationship,
      is_primary: input.isPrimary,
      is_fee_responsible: input.isFeeResponsible,
      can_pick_up: input.canPickUp,
      receives_communications: input.receivesCommunications,
      has_portal_access: input.hasPortalAccess,
    },
  );
  return data;
}

export async function updateGuardianLink(
  linkId: string,
  input: UpdateGuardianLinkInput,
): Promise<GuardianLinkRecord> {
  const body: Record<string, unknown> = {};
  if (input.relationship !== undefined) body.relationship = input.relationship;
  if (input.isFeeResponsible !== undefined) body.is_fee_responsible = input.isFeeResponsible;
  if (input.canPickUp !== undefined) body.can_pick_up = input.canPickUp;
  if (input.receivesCommunications !== undefined) {
    body.receives_communications = input.receivesCommunications;
  }
  if (input.hasPortalAccess !== undefined) body.has_portal_access = input.hasPortalAccess;
  if (input.isPrimary !== undefined) body.is_primary = input.isPrimary;
  const { data } = await apiClient.patch<GuardianLinkRecord>(
    endpoints.studentGuardians.detail(linkId),
    body,
  );
  return data;
}

export async function fetchGuardianLinks(studentId: string): Promise<GuardianLinkRecord[]> {
  const { items } = await fetchPage<GuardianLinkRecord>(
    apiClient,
    endpoints.guardians.studentLinks(studentId),
    { query: { page_size: SEARCH_PAGE_SIZE } },
  );
  return items;
}
```

- [ ] **Step 5: Write `index.ts`**

```ts
import {
  createGuardian,
  fetchGuardianLinks,
  linkGuardianToStudent,
  searchGuardians,
  updateGuardian,
  updateGuardianLink,
} from "./guardians-service";

export const GuardiansService = {
  searchGuardians,
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

Add this import alongside the existing ones (alphabetical, so between `FilesService` and `JobsService`). Add `guardians: GuardiansService,` to the `Services` object, between `schoolOrganization` and `staff` (matching the object's existing alphabetical-ish grouping — not load-bearing, just consistent). Add this re-export alongside the existing `StudentRecord` one:

```ts
export type { GuardianLinkRecord, GuardianRecord, GuardianRelationship } from "./modules/guardians";
```

Update `src/services/__tests__/index.test.ts`'s exact-keys assertion (`Object.keys(Services)` or equivalent, matching however the existing test asserts the full domain list) to include `"guardians"`.

- [ ] **Step 7: Confirm the tests pass by construction**

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/services/endpoints.ts apps/dashboard/src/services/modules/guardians apps/dashboard/src/services/index.ts apps/dashboard/src/services/__tests__/index.test.ts
git commit -m "feat(dashboard): add Services.guardians"
```

- [ ] **Step 9: Push and read CI**

---

## Task 3: `Services.students` emergency-contacts/documents additions + `Services.files.getDownloadUrl`

**Files:**
- Modify: `apps/dashboard/src/services/endpoints.ts`
- Create: `apps/dashboard/src/services/modules/students/student-relations-service.ts`
- Create: `apps/dashboard/src/services/modules/students/student-relations-type.ts`
- Modify: `apps/dashboard/src/services/modules/students/index.ts`
- Create: `apps/dashboard/src/services/modules/students/__tests__/student-relations-service.test.ts`
- Modify: `apps/dashboard/src/services/modules/files/files-service.ts`
- Modify: `apps/dashboard/src/services/modules/files/index.ts`
- Modify: `apps/dashboard/src/services/modules/files/__tests__/files-service.test.ts`

**Interfaces:**
- Consumes: `apiClient`, `fetchPage`, `endpoints.files.download` (already exists).
- Produces: `Services.students.{fetchEmergencyContacts,addEmergencyContact,fetchDocuments,uploadDocumentRecord,deleteDocument,verifyDocument}`, `Services.files.getDownloadUrl`, `EmergencyContactRecord`, `StudentDocumentRecord` types. Consumed by Tasks 8, 9.

A separate file from `students-service.ts` (not an addition to it): these six functions are about a student's *relations*, not the student record itself, and `students-service.ts` is already a focused, complete file for CRUD on the student — splitting keeps each file's one responsibility clear, matching this plan's Global Constraints on file size and the existing split-by-concern convention (`students-helper.ts`/`students-constant.ts`/`students.schema.ts` already split student-record concerns out of `students-service.ts` the same way).

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
  /** Top-level access to a single document — `DELETE` and the `:verify` colon-action.
   * Upload (create) always goes through the nested `students.documents` path above,
   * where the student is unambiguous from the URL. */
  studentDocuments: {
    detail: (id: string) => `/student-documents/${id}`,
    verify: (id: string) => `/student-documents/${id}:verify`,
  },
```

- [ ] **Step 2: Write the failing tests**

```ts
import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDelete = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: mockPost,
      put: jest.fn(),
      patch: jest.fn(),
      delete: mockDelete,
      refresh: jest.fn(),
    })),
  };
});

describe("student-relations-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockDelete.mockReset();
  });

  it("fetchEmergencyContacts lists a student's contacts, ordered by priority", async () => {
    const { fetchEmergencyContacts } = await import("../student-relations-service");
    mockGet.mockResolvedValue({
      data: [{ id: "c1", priority: 1 }],
      meta: { pagination: { page: 1, page_size: 50, total_count: 1, total_pages: 1 } },
    });

    const result = await fetchEmergencyContacts("student-1");

    expect(mockGet).toHaveBeenCalledWith(
      "/students/student-1/emergency-contacts",
      expect.objectContaining({ query: { ordering: "priority", page_size: 50 } }),
    );
    expect(result).toEqual([{ id: "c1", priority: 1 }]);
  });

  it("addEmergencyContact posts the contact fields, omitting unfilled optionals", async () => {
    const { addEmergencyContact } = await import("../student-relations-service");
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
    const { fetchDocuments } = await import("../student-relations-service");
    mockGet.mockResolvedValue({
      data: [{ id: "d1" }],
      meta: { pagination: { page: 1, page_size: 50, total_count: 1, total_pages: 1 } },
    });

    const result = await fetchDocuments("student-1");

    expect(mockGet).toHaveBeenCalledWith(
      "/students/student-1/documents",
      expect.objectContaining({ query: { page_size: 50 } }),
    );
    expect(result).toEqual([{ id: "d1" }]);
  });

  it("uploadDocumentRecord posts the already-uploaded file's id plus metadata", async () => {
    const { uploadDocumentRecord } = await import("../student-relations-service");
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
    const { uploadDocumentRecord } = await import("../student-relations-service");
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
    const { deleteDocument } = await import("../student-relations-service");
    mockDelete.mockResolvedValue({});

    await deleteDocument("d1");

    expect(mockDelete).toHaveBeenCalledWith("/student-documents/d1");
  });

  it("verifyDocument posts the decision to the colon-action", async () => {
    const { verifyDocument } = await import("../student-relations-service");
    mockPost.mockResolvedValue({ data: { id: "d1", verification_status: "verified" } });

    const result = await verifyDocument("d1", "verified");

    expect(mockPost).toHaveBeenCalledWith("/student-documents/d1:verify", { decision: "verified" });
    expect(result).toEqual({ id: "d1", verification_status: "verified" });
  });
});
```

- [ ] **Step 3: Confirm the tests fail by construction, then write `student-relations-type.ts`**

```ts
import type { ApiSchemas } from "@schoolhub/api-client";

export type EmergencyContactRecord = ApiSchemas["EmergencyContact"];
export type StudentDocumentRecord = ApiSchemas["StudentDocument"];
export type DocumentVerificationDecision = "verified" | "rejected";

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

- [ ] **Step 4: Write `student-relations-service.ts`**

```ts
import { fetchPage } from "@schoolhub/api-client";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type {
  AddEmergencyContactInput,
  DocumentVerificationDecision,
  EmergencyContactRecord,
  StudentDocumentRecord,
  UploadDocumentInput,
} from "./student-relations-type";

export type {
  AddEmergencyContactInput,
  DocumentVerificationDecision,
  EmergencyContactRecord,
  StudentDocumentRecord,
  UploadDocumentInput,
} from "./student-relations-type";

/** Nested under one student — a handful of rows, fetched in one page. Matches the real
 * `EmergencyContactLinkViewSet`/`StudentDocumentLinkViewSet` precedent: both are
 * nested-under-one-student lists with no independent pagination UI. */
const RELATION_PAGE_SIZE = 50;

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
```

- [ ] **Step 5: Wire the new functions into `students/index.ts`**

The existing file imports `createStudent,fetchStudentById,fetchStudentsPage,updateStudent,withdrawStudent` from `./students-service` and re-exports their types from `./students-service`. Add a second import block from the new file, add the six functions to the `StudentsService` object, and add their types to the existing `export type { ... }` list:

```ts
import {
  addEmergencyContact,
  deleteDocument,
  fetchDocuments,
  fetchEmergencyContacts,
  uploadDocumentRecord,
  verifyDocument,
} from "./student-relations-service";
```

```ts
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
};
```

```ts
export type {
  AddEmergencyContactInput,
  DocumentVerificationDecision,
  EmergencyContactRecord,
  StudentDocumentRecord,
  UploadDocumentInput,
} from "./student-relations-service";
```

(alongside the file's existing `CreateStudentInput, StudentRecord, StudentsPageQuery, UpdateStudentInput, WithdrawStudentInput` re-export — leave that one exactly as it is).

- [ ] **Step 6: Add `getDownloadUrl` to `files-service.ts`**

```ts
export async function getDownloadUrl(fileId: string): Promise<string> {
  const { data } = await apiClient.post<{ download_url: string }>(
    endpoints.files.download(fileId),
  );
  return data.download_url;
}
```

This needs `apiClient` and `endpoints` imported into `files-service.ts`, which doesn't import either today (it only ever calls `apiClient.post` through the three inline steps of `uploadFile`, which already has its own `apiClient`/`endpoints` imports — confirm by reading the file's current top before adding a duplicate import). Add this function after `uploadFile`, in the same file.

Write its failing test first, in the existing `apps/dashboard/src/services/modules/files/__tests__/files-service.test.ts` (which already mocks `createApiClient` with a `mockPost` — reuse that same mock, don't add a second one):

```ts
describe("getDownloadUrl", () => {
  beforeEach(() => {
    jest.resetModules();
    mockPost.mockReset();
  });

  it("requests a fresh signed URL for the given file id", async () => {
    const { getDownloadUrl } = await import("../files-service");
    mockPost.mockResolvedValue({ data: { download_url: "https://files.example.com/x?sig=abc" } });

    const url = await getDownloadUrl("file-1");

    expect(mockPost).toHaveBeenCalledWith("/files/file-1:download");
    expect(url).toBe("https://files.example.com/x?sig=abc");
  });
});
```

- [ ] **Step 7: Wire `getDownloadUrl` into `files/index.ts`**

```ts
import { getDownloadUrl, uploadFile } from "./files-service";

export const FilesService = {
  uploadFile,
  getDownloadUrl,
};

export { FileUploadError } from "./files-service";
export type { FileUploadStep } from "./files-service";
```

- [ ] **Step 8: Confirm all tests pass by construction**

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/src/services/endpoints.ts apps/dashboard/src/services/modules/students apps/dashboard/src/services/modules/files
git commit -m "feat(dashboard): add emergency-contact/document relations and file download to Services"
```

- [ ] **Step 10: Push and read CI**

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
"editLinkTitle": "Edit link"
```

Matching Urdu additions in `ur.json`'s `students.guardians.fields` and `students.guardians`:

```json
"altPhone": "متبادل فون",
"email": "ای میل"
```

```json
"editGuardianTitle": "سرپرست میں ترمیم کریں",
"editLinkTitle": "تعلق میں ترمیم کریں"
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

- [ ] **Step 5: Verify via CI's i18n types-check**

(`messages.types-check.ts`, per Phase 1's own convention — no local run; CI's `frontend` workflow checks both locale files stay structurally identical.)

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/messages/en.json apps/dashboard/messages/ur.json
git commit -m "feat(dashboard): add the guardian/emergency-contact/document field and dialog copy"
```

- [ ] **Step 7: Push and read CI**

---

## Task 5: `GuardianFormDialog` (create/edit a guardian's own fields, with a photo)

**Files:**
- Create: `apps/dashboard/src/features/students/guardian-photo-field.tsx`
- Create: `apps/dashboard/src/features/students/guardian-form-dialog.tsx`
- Create: `apps/dashboard/src/features/students/__tests__/guardian-form-dialog.test.tsx`

**Interfaces:**
- Consumes: `Services.guardians.{createGuardian,updateGuardian}`, `Services.files.uploadFile` (Task 2, Phase 1).
- Produces: `GuardianFormDialog({ open, onOpenChange, mode, guardian?, onSaved })`. `mode: "create"` needs no `guardian` prop; `mode: "edit"` requires one (the already-fetched record — this component never fetches a guardian itself). `onSaved(guardian: GuardianRecord)` fires after a successful create or update, so the caller decides what happens next (Task 6 links a newly created guardian; Task 7's edit action just needs the tab to refetch). Consumed by Tasks 6, 7.

`guardian-photo-field.tsx` is its own file, not a generalization of `student-photo-field.tsx` shared between the two forms — matching this codebase's own precedent (`/staff`'s near-identical photo field was never merged with the student one either; see this plan's spec, "Alternatives Considered").

- [ ] **Step 1: Write `guardian-photo-field.tsx`**

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
import { useWatch, type UseFormReturn } from "react-hook-form";

import { getInitials, stableSignedUrl } from "@/lib/helpers";
import { Services } from "@/services";
import type { GuardianRecord } from "@/services";
import type { GuardianFormValues } from "./guardian-form-schema";

export interface GuardianPhotoFieldProps {
  form: UseFormReturn<GuardianFormValues>;
  /** The guardian being edited, for its saved photo; `undefined` in create mode. */
  savedRecord?: GuardianRecord;
  onUploadStart: () => () => boolean;
  onUploadingChange: (uploading: boolean) => void;
}

/**
 * The guardian form's photo picker — same three-step upload, same "open session" guard
 * against a stale result from a closed-then-reopened dialog, as `student-photo-field.tsx`
 * (Phase 1). Kept as its own file rather than shared: the two forms' surrounding fields
 * differ enough (no address, no campus/house) that sharing this one piece would couple
 * two otherwise-independent dialogs for no real savings.
 */
export function GuardianPhotoField({
  form,
  savedRecord,
  onUploadStart,
  onUploadingChange,
}: GuardianPhotoFieldProps) {
  const t = useTranslations("students");
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [firstName, lastName, photoFileId] = useWatch({
    control: form.control,
    name: ["first_name", "last_name", "photo_file_id"],
  });

  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      onUploadingChange(false);
    };
  }, [onUploadingChange]);

  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    };
  }, [localPreviewUrl]);

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const isCurrentSession = onUploadStart();
    setLocalPreviewUrl(URL.createObjectURL(file));
    setUploadStatus("uploading");
    setUploadError(null);
    onUploadingChange(true);

    let outcome: { fileId: string } | { error: string };
    try {
      outcome = { fileId: await Services.files.uploadFile(file, "guardian.photo") };
    } catch (error) {
      outcome = { error: error instanceof Error ? error.message : t("form.photoUploadFailed") };
    }

    if (!mountedRef.current) return;
    onUploadingChange(false);
    if (!isCurrentSession()) {
      setUploadStatus("idle");
      setLocalPreviewUrl(null);
      return;
    }
    if ("fileId" in outcome) {
      form.setValue("photo_file_id", outcome.fileId, { shouldDirty: true });
      setUploadStatus("idle");
    } else {
      setUploadStatus("error");
      setUploadError(outcome.error);
      setLocalPreviewUrl(null);
    }
  }

  const savedPhotoUrl =
    savedRecord && photoFileId === (savedRecord.photo_file_id ?? "")
      ? stableSignedUrl(savedRecord.photo_url)
      : null;
  const previewUrl = localPreviewUrl ?? savedPhotoUrl;

  return (
    <FormField
      control={form.control}
      name="photo_file_id"
      render={() => (
        <FormItem>
          <FormLabel>{t("fields.photo")}</FormLabel>
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
                <p className="text-xs text-muted-foreground">{t("fields.photoUploading")}</p>
              ) : null}
              {uploadStatus === "error" && uploadError ? (
                <p className="text-xs text-destructive" role="alert">
                  {uploadError}
                </p>
              ) : null}
              {uploadStatus !== "uploading" && !previewUrl && photoFileId ? (
                <p className="text-xs text-muted-foreground">{t("fields.photoOnFile")}</p>
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

(Reuses `students.fields.photo`/`photoUploading`/`photoOnFile`/`photoUploadFailed` — a photo picker's own copy is the same concept whether it's a student's or a guardian's, and the top-level `students.fields` namespace already covers it; no new i18n key needed for this file.)

- [ ] **Step 2: Write the inline zod schema this dialog needs**

Not a separate `guardian-form-schema.ts` file — the schema is small enough (5 fields) to declare directly in `guardian-form-dialog.tsx`, unlike the student form's 20+-field schema that earned its own file. Declared as part of Step 4 below (`guardianFormSchema`), importable as `GuardianFormValues` wherever `guardian-photo-field.tsx` needs the type (Step 1 imports it from `"./guardian-form-schema"` — this is a **named export living inside `guardian-form-dialog.tsx` itself**, not a separate file; fix the import in Step 1 to `from "./guardian-form-dialog"` once Step 4 below defines it there).

- [ ] **Step 3: Write the failing tests**

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

- [ ] **Step 4: Confirm the tests fail by construction, then write `guardian-form-dialog.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { z } from "zod";
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
import { resolveErrorMessage } from "@/lib/error-message";
import { ApiError, Services } from "@/services";
import type { GuardianRecord } from "@/services";
import { GuardianPhotoField } from "./guardian-photo-field";

export const guardianFormSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  phone: z.string().min(1),
  alt_phone: z.string().optional(),
  email: z.string().optional(),
  photo_file_id: z.string().optional(),
});

export type GuardianFormValues = z.infer<typeof guardianFormSchema>;

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

export function GuardianFormDialog({
  open,
  onOpenChange,
  mode,
  guardian,
  onSaved,
}: GuardianFormDialogProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const isMobile = !useIsDesktopShell();

  const sessionRef = useRef(0);
  const openSessionRef = useRef(0);
  useEffect(() => {
    if (open) {
      sessionRef.current += 1;
      openSessionRef.current = sessionRef.current;
    } else {
      openSessionRef.current = 0;
    }
  }, [open]);

  const isSubmittingRef = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPhotoUploading, setIsPhotoUploading] = useState(false);

  const form = useForm<GuardianFormValues>({
    resolver: zodResolver(guardianFormSchema),
    defaultValues: mode === "edit" && guardian ? toFormValues(guardian) : EMPTY_DEFAULTS,
  });

  useEffect(() => {
    if (!open) {
      form.reset(EMPTY_DEFAULTS);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormError(null);
    } else if (mode === "edit" && guardian) {
      form.reset(toFormValues(guardian));
    }
  }, [open, mode, guardian, form]);

  const mutation = useMutation({
    mutationFn: (values: GuardianFormValues) => {
      const input = {
        firstName: values.first_name,
        lastName: values.last_name,
        phone: values.phone,
        ...(values.alt_phone ? { altPhone: values.alt_phone } : {}),
        ...(values.email ? { email: values.email } : {}),
        ...(values.photo_file_id ? { photoFileId: values.photo_file_id } : {}),
      };
      return mode === "create"
        ? Services.guardians.createGuardian(input)
        : Services.guardians.updateGuardian((guardian as GuardianRecord).id, input);
    },
    onSuccess: (saved) => {
      onOpenChange(false);
      onSaved(saved);
    },
    onError: (error) => {
      setFormError(null);
      form.clearErrors();
      if (error instanceof ApiError) {
        let matchedAField = false;
        for (const [field, issue] of Object.entries(error.fieldErrors())) {
          if (field !== "non_field" && field in guardianFormSchema.shape) {
            form.setError(field as keyof GuardianFormValues, { type: "server", message: issue });
            matchedAField = true;
          }
        }
        if (!matchedAField) {
          setFormError(resolveErrorMessage(error, tErrors, t("form.submitFailed"), "non_field"));
        }
      } else {
        setFormError(t("form.submitFailed"));
      }
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
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {mode === "create" ? t("guardians.createNew") : t("guardians.editGuardianTitle")}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
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
              <GuardianPhotoField
                form={form}
                savedRecord={mode === "edit" ? guardian : undefined}
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
              <Button type="submit" isLoading={mutation.isPending || isPhotoUploading}>
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

Fix `guardian-photo-field.tsx`'s import from Step 1 to read `import type { GuardianFormValues } from "./guardian-form-dialog";` — this is the real, single source of the type, defined in this file.

- [ ] **Step 5: Confirm the tests pass by construction**

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/features/students/guardian-photo-field.tsx apps/dashboard/src/features/students/guardian-form-dialog.tsx apps/dashboard/src/features/students/__tests__/guardian-form-dialog.test.tsx
git commit -m "feat(dashboard): add the guardian create/edit form dialog"
```

- [ ] **Step 7: Push and read CI**

---

## Task 6: `GuardianPickerDialog` (search-existing or create-new, then link)

**Files:**
- Create: `apps/dashboard/src/features/students/guardian-picker-dialog.tsx`
- Create: `apps/dashboard/src/features/students/__tests__/guardian-picker-dialog.test.tsx`

**Interfaces:**
- Consumes: `Services.guardians.{searchGuardians,linkGuardianToStudent}` (Task 2), `GuardianFormDialog` (Task 5).
- Produces: `GuardianPickerDialog({ open, onOpenChange, studentId, onLinked })`. `onLinked()` fires after a successful link (no payload — the caller just needs to know to refetch). Consumed by Task 7.

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
    expect(await screen.findByText(/no records found/i)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /create new/i })).toBeInTheDocument();
  });

  it("creates a new guardian inline then links it", async () => {
    mockCreateGuardian.mockResolvedValue(guardianRecord({ id: "g2", first_name: "Bilal" }));
    mockLinkGuardianToStudent.mockResolvedValue({ id: "link-2" } as never);
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    renderWithProviders(
      <GuardianPickerDialog
        open
        studentId="student-1"
        onOpenChange={onOpenChange}
        onLinked={onLinked}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /create new/i }));
    await user.type(screen.getByLabelText(/first name/i), "Bilal");
    await user.type(screen.getByLabelText(/last name/i), "Khan");
    await user.type(screen.getByLabelText(/^phone$/i), "0300-2222222");
    await user.click(screen.getByRole("combobox", { name: /relationship/i }));
    await user.click(screen.getByRole("option", { name: /^father$/i }));
    await user.click(screen.getByRole("button", { name: /link guardian/i }));

    await waitFor(() => {
      expect(mockCreateGuardian).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: "Bilal", lastName: "Khan" }),
      );
    });
    await waitFor(() => {
      expect(mockLinkGuardianToStudent).toHaveBeenCalledWith(
        "student-1",
        expect.objectContaining({ guardianId: "g2", relationship: "father" }),
      );
    });
    expect(onLinked).toHaveBeenCalled();
  });

  it("surfaces the server's duplicate-link message when linking an already-linked guardian", async () => {
    mockSearchGuardians.mockResolvedValue([guardianRecord()]);
    mockLinkGuardianToStudent.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: "Validation failed.",
        status: 422,
        url: "/students/student-1/guardians",
        details: [{ field: "non_field", issue: "This guardian is already linked to this student." }],
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
    await user.click(await screen.findByRole("option", { name: /ayesha raza/i }));
    await user.click(screen.getByRole("combobox", { name: /relationship/i }));
    await user.click(screen.getByRole("option", { name: /^mother$/i }));
    await user.click(screen.getByRole("button", { name: /link guardian/i }));

    expect(
      await screen.findByText("This guardian is already linked to this student."),
    ).toBeInTheDocument();
    expect(onLinked).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Confirm the tests fail by construction, then write `guardian-picker-dialog.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Alert,
  Button,
  FormMessage,
  Input,
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
import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { ApiError, Services } from "@/services";
import type { CreateGuardianInput, GuardianRecord, GuardianRelationship } from "@/services";

const RELATIONSHIP_VALUES: GuardianRelationship[] = [
  "father",
  "mother",
  "grandparent",
  "sibling",
  "legal_guardian",
  "other",
];

const LINK_FLAG_DEFAULTS = {
  isPrimary: false,
  isFeeResponsible: false,
  canPickUp: true,
  receivesCommunications: true,
  hasPortalAccess: true,
} as const;

export interface GuardianPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  onLinked: () => void;
}

export function GuardianPickerDialog({
  open,
  onOpenChange,
  studentId,
  onLinked,
}: GuardianPickerDialogProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<"search" | "create">("search");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedGuardian, setSelectedGuardian] = useState<GuardianRecord | null>(null);
  const [relationship, setRelationship] = useState<GuardianRelationship | "">("");
  const [createFirstName, setCreateFirstName] = useState("");
  const [createLastName, setCreateLastName] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    if (!open) {
      setTab("search");
      setSearchInput("");
      setSearch("");
      setSelectedGuardian(null);
      setRelationship("");
      setCreateFirstName("");
      setCreateLastName("");
      setCreatePhone("");
      setLinkError(null);
    }
  }, [open]);

  const searchQuery = useQuery({
    queryKey: queryKeys.list("guardians", "search", { search }),
    queryFn: () => Services.guardians.searchGuardians(search),
    enabled: open && tab === "search" && search.length > 0,
  });

  const linkMutation = useMutation({
    mutationFn: async (guardianId: string) => {
      if (!relationship) throw new Error("relationship is required");
      return Services.guardians.linkGuardianToStudent(studentId, {
        guardianId,
        relationship,
        ...LINK_FLAG_DEFAULTS,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.list("students", "guardian-links", studentId),
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

  const createAndLinkMutation = useMutation({
    mutationFn: async () => {
      const input: CreateGuardianInput = {
        firstName: createFirstName,
        lastName: createLastName,
        phone: createPhone,
      };
      const created = await Services.guardians.createGuardian(input);
      return linkMutation.mutateAsync(created.id);
    },
  });

  function handleSubmit() {
    setLinkError(null);
    if (tab === "search" && selectedGuardian) {
      linkMutation.mutate(selectedGuardian.id);
    } else if (tab === "create") {
      createAndLinkMutation.mutate();
    }
  }

  const canSubmit =
    Boolean(relationship) &&
    (tab === "search"
      ? Boolean(selectedGuardian)
      : createFirstName.trim().length > 0 &&
        createLastName.trim().length > 0 &&
        createPhone.trim().length > 0);
  const isPending = linkMutation.isPending || createAndLinkMutation.isPending;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("guardians.link")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("guardians.linkDescription")}</p>
          {linkError && <Alert variant="destructive">{linkError}</Alert>}

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
                onChange={(event) => {
                  setSearchInput(event.target.value);
                  setSelectedGuardian(null);
                }}
              />
              {searchQuery.isFetching ? <Skeleton className="h-9 w-full" /> : null}
              {search.length > 0 && !searchQuery.isFetching && searchQuery.data?.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tCommon("noResults")}</p>
              ) : null}
              {(searchQuery.data ?? []).length > 0 ? (
                <Select
                  value={selectedGuardian?.id ?? ""}
                  onValueChange={(value) => {
                    setSelectedGuardian(
                      (searchQuery.data ?? []).find((g) => g.id === value) ?? null,
                    );
                  }}
                >
                  <SelectTrigger aria-label={t("guardians.searchPlaceholder")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(searchQuery.data ?? []).map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.first_name} {g.last_name} · {g.phone}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </TabsContent>

            <TabsContent value="create" className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="picker-first-name">
                  {t("guardians.fields.firstName")}
                </label>
                <Input
                  id="picker-first-name"
                  value={createFirstName}
                  onChange={(event) => setCreateFirstName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="picker-last-name">
                  {t("guardians.fields.lastName")}
                </label>
                <Input
                  id="picker-last-name"
                  value={createLastName}
                  onChange={(event) => setCreateLastName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="picker-phone">
                  {t("guardians.fields.phone")}
                </label>
                <Input
                  id="picker-phone"
                  value={createPhone}
                  onChange={(event) => setCreatePhone(event.target.value)}
                />
              </div>
            </TabsContent>
          </Tabs>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="picker-relationship">
              {t("guardians.fields.relationship")}
            </label>
            <Select
              value={relationship}
              onValueChange={(value) => setRelationship(value as GuardianRelationship)}
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
            {!relationship ? <FormMessage>{tCommon("requiredField")}</FormMessage> : null}
          </div>
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
            type="button"
            disabled={!canSubmit || isPending}
            isLoading={isPending}
            onClick={handleSubmit}
          >
            {t("guardians.link")}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
```

`FormMessage` is used here outside a `Form`/`FormField` context purely as a styled error-text element — confirm against `packages/ui/src/components/form.tsx` that it renders plain children without requiring RHF context before relying on this; if it does require that context, replace with a plain `<p className="text-sm text-destructive">{tCommon("requiredField")}</p>` instead; either way the visible behavior the test asserts (a required-field message appears when no relationship is chosen) stays the same.

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
- Create: `apps/dashboard/src/features/students/guardian-link-flags-dialog.tsx`
- Create: `apps/dashboard/src/features/students/student-guardians-tab.tsx`
- Create: `apps/dashboard/src/features/students/__tests__/guardian-link-flags-dialog.test.tsx`
- Create: `apps/dashboard/src/features/students/__tests__/student-guardians-tab.test.tsx`

**Interfaces:**
- Consumes: `Services.guardians.{fetchGuardianLinks,updateGuardianLink}` (Task 2), `GuardianFormDialog` (Task 5), `GuardianPickerDialog` (Task 6).
- Produces: `StudentGuardiansTab({ studentId, canCreate, canUpdate })`. Consumed by Task 10.

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

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Alert,
  Button,
  Checkbox,
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
import type { GuardianLinkRecord, GuardianRelationship, UpdateGuardianLinkInput } from "@/services";

const RELATIONSHIP_VALUES: GuardianRelationship[] = [
  "father",
  "mother",
  "grandparent",
  "sibling",
  "legal_guardian",
  "other",
];

interface FlagState {
  relationship: GuardianRelationship;
  isFeeResponsible: boolean;
  canPickUp: boolean;
  receivesCommunications: boolean;
  hasPortalAccess: boolean;
}

function toFlagState(link: GuardianLinkRecord): FlagState {
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

  const [state, setState] = useState<FlagState>(() => toFlagState(link));
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setState(toFlagState(link));
      setFormError(null);
    }
  }, [open, link]);

  const mutation = useMutation({
    mutationFn: () => {
      const input: UpdateGuardianLinkInput = {
        relationship: state.relationship,
        isFeeResponsible: state.isFeeResponsible,
        canPickUp: state.canPickUp,
        receivesCommunications: state.receivesCommunications,
        hasPortalAccess: state.hasPortalAccess,
      };
      return Services.guardians.updateGuardianLink(link.id, input);
    },
    onSuccess: () => {
      onOpenChange(false);
      onSaved();
    },
    onError: (error) => {
      setFormError(
        error instanceof ApiError
          ? resolveErrorMessage(error, tErrors, t("form.submitFailed"), "non_field")
          : t("form.submitFailed"),
      );
    },
  });

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-md" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("guardians.editLinkTitle")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="space-y-4">
          {formError && <Alert variant="destructive">{formError}</Alert>}
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="link-relationship">
              {t("guardians.fields.relationship")}
            </label>
            <Select
              value={state.relationship}
              onValueChange={(value) => {
                setState((prev) => ({ ...prev, relationship: value as GuardianRelationship }));
              }}
            >
              <SelectTrigger id="link-relationship" aria-label={t("guardians.fields.relationship")}>
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
          </div>
          {(
            [
              ["isFeeResponsible", "feeResponsible"],
              ["canPickUp", "canPickUp"],
              ["receivesCommunications", "receivesCommunications"],
              ["hasPortalAccess", "hasPortalAccess"],
            ] as const
          ).map(([key, labelKey]) => (
            <div key={key} className="flex items-center gap-2">
              <Checkbox
                id={`link-flag-${key}`}
                checked={state[key]}
                onCheckedChange={(checked) => {
                  setState((prev) => ({ ...prev, [key]: checked === true }));
                }}
              />
              <label className="text-sm" htmlFor={`link-flag-${key}`}>
                {t(`guardians.flags.${labelKey}`)}
              </label>
            </div>
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
            type="button"
            isLoading={mutation.isPending}
            onClick={() => {
              mutation.mutate();
            }}
          >
            {tCommon("save")}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
```

- [ ] **Step 3: Confirm `guardian-link-flags-dialog.tsx`'s tests pass by construction, then commit it alone**

```bash
git add apps/dashboard/src/features/students/guardian-link-flags-dialog.tsx apps/dashboard/src/features/students/__tests__/guardian-link-flags-dialog.test.tsx
git commit -m "feat(dashboard): add the guardian link flags edit dialog"
```

- [ ] **Step 4: Write `student-guardians-tab.tsx`'s failing tests**

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import type { GuardianLinkRecord, GuardianRecord } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { StudentGuardiansTab } from "../student-guardians-tab";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    guardians: {
      fetchGuardianLinks: jest.fn(),
      updateGuardianLink: jest.fn(),
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
    mockUpdateGuardianLink.mockReset();
    global.fetch = jest.fn();
  });

  it("shows empty copy when the student has no guardians linked", async () => {
    mockFetchGuardianLinks.mockResolvedValue([]);

    renderWithProviders(<StudentGuardiansTab studentId="student-1" canCreate canUpdate />);

    expect(await screen.findByText(/no guardians linked yet/i)).toBeInTheDocument();
  });

  it("lists a linked guardian with their relationship and flags", async () => {
    mockFetchGuardianLinks.mockResolvedValue([
      linkRecord({ is_fee_responsible: true, can_pick_up: true }),
    ]);
    jest.spyOn(Services.guardians, "fetchGuardianLinks");
    // The guardian's own details come from a separate per-id fetch (fan-out) — mock the
    // apiClient-level call this component makes through a local useQueries, not a
    // Services function, since there is deliberately no `Services.guardians.fetchGuardianById`
    // (see this plan's Global Constraints). Mock at the `apiClient` boundary instead.
    jest.mock("@/lib/auth", () => ({
      apiClient: { get: jest.fn().mockResolvedValue({ data: guardianRecord() }) },
    }));

    renderWithProviders(<StudentGuardiansTab studentId="student-1" canCreate canUpdate />);

    expect(await screen.findByText(/father/i)).toBeInTheDocument();
  });

  it("promotes a non-primary link to primary with one click, no dialog", async () => {
    mockFetchGuardianLinks.mockResolvedValue([linkRecord({ is_primary: false })]);
    mockUpdateGuardianLink.mockResolvedValue(linkRecord({ is_primary: true }));

    renderWithProviders(<StudentGuardiansTab studentId="student-1" canCreate canUpdate />);

    const button = await screen.findByRole("button", { name: /make primary/i });
    await userEvent.setup().click(button);

    await waitFor(() => {
      expect(mockUpdateGuardianLink).toHaveBeenCalledWith("link-1", { isPrimary: true });
    });
  });

  it("hides every action for a caller without create/update permission", async () => {
    mockFetchGuardianLinks.mockResolvedValue([linkRecord()]);

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

import { useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Badge, Button, Skeleton } from "@schoolhub/ui";

import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
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
  const queryClient = useQueryClient();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingGuardian, setEditingGuardian] = useState<GuardianRecord | null>(null);
  const [editingLink, setEditingLink] = useState<GuardianLinkRecord | null>(null);

  const linksQuery = useQuery({
    queryKey: queryKeys.list("students", "guardian-links", studentId),
    queryFn: () => Services.guardians.fetchGuardianLinks(studentId),
  });
  const links = linksQuery.data ?? [];

  // The link list never embeds the guardian's own name/phone (confirmed real API shape
  // — see this plan's Global Constraints) — fan out one GET per unique guardian id.
  // Reads through `apiClient` directly rather than a `Services.guardians` function:
  // there is deliberately no `fetchGuardianById`, since nothing else in this phase
  // needs a single-guardian-by-id fetch (ADR-0011 still applies — this stays inside
  // `src/features`, which may read `apiClient`'s already-resolved singleton import from
  // `@/lib/auth`, the one place outside `src/services` this repo's boundary allows for
  // exactly this kind of one-off read; `endpoints.guardians.detail` keeps the path out
  // of this component's own literal strings).
  const guardianIds = [...new Set(links.map((link) => link.guardian_id))];
  const guardianQueries = useQueries({
    queries: guardianIds.map((guardianId) => ({
      queryKey: queryKeys.detail("guardians", "guardians", guardianId),
      queryFn: async () =>
        (await apiClient.get<GuardianRecord>(endpoints.guardians.detail(guardianId))).data,
    })),
  });
  const guardiansById = new Map(
    guardianQueries
      .map((query) => query.data)
      .filter((g): g is GuardianRecord => Boolean(g))
      .map((g) => [g.id, g]),
  );

  function invalidateLinks() {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.list("students", "guardian-links", studentId),
    });
  }

  const promoteMutation = useMutation({
    mutationFn: (linkId: string) =>
      Services.guardians.updateGuardianLink(linkId, { isPrimary: true }),
    onSuccess: invalidateLinks,
  });

  if (linksQuery.isPending) {
    return <Skeleton className="h-24 w-full" />;
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
            return (
              <div key={link.id} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {guardian ? `${guardian.first_name} ${guardian.last_name}` : "…"}
                    </p>
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
- Create: `apps/dashboard/src/features/students/student-emergency-contacts-tab.tsx`
- Create: `apps/dashboard/src/features/students/__tests__/student-emergency-contacts-tab.test.tsx`

**Interfaces:**
- Consumes: `Services.students.{fetchEmergencyContacts,addEmergencyContact}` (Task 3).
- Produces: `StudentEmergencyContactsTab({ studentId, canCreate })`. Consumed by Task 10.

**Review Focus #3** (a gated action rendered for a caller without the permission) applies here: the add button and form must be genuinely absent when `canCreate` is false, not merely disabled.

- [ ] **Step 1: Write the failing tests**

```tsx
import { screen, waitFor } from "@testing-library/react";
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
    await user.click(screen.getByRole("button", { name: /^add contact$/i }));

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
import { useTranslations } from "next-intl";
import { Badge, Button, Input, Skeleton } from "@schoolhub/ui";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";

export interface StudentEmergencyContactsTabProps {
  studentId: string;
  canCreate: boolean;
}

export function StudentEmergencyContactsTab({
  studentId,
  canCreate,
}: StudentEmergencyContactsTabProps) {
  const t = useTranslations("students");
  const [dialogOpen, setDialogOpen] = useState(false);

  const contactsQuery = useQuery({
    queryKey: queryKeys.list("students", "emergency-contacts", studentId),
    queryFn: () => Services.students.fetchEmergencyContacts(studentId),
  });
  const contacts = contactsQuery.data ?? [];

  if (contactsQuery.isPending) {
    return <Skeleton className="h-24 w-full" />;
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
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [phone, setPhone] = useState("");
  const [altPhone, setAltPhone] = useState("");
  const [priority, setPriority] = useState(nextPriority);
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      Services.students.addEmergencyContact(studentId, {
        name,
        relationship,
        phone,
        ...(altPhone ? { altPhone } : {}),
        priority,
        ...(notes ? { notes } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.list("students", "emergency-contacts", studentId),
      });
      onOpenChange(false);
    },
  });

  const canSubmit = name.trim() && relationship.trim() && phone.trim();

  return (
    <ResponsiveDialog open onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-md" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("emergencyContacts.add")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("emergencyContacts.addDescription")}</p>
          <p className="text-xs text-muted-foreground">{t("emergencyContacts.permanentNotice")}</p>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="contact-name">
              {t("emergencyContacts.fields.name")}
            </label>
            <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="contact-relationship">
              {t("emergencyContacts.fields.relationship")}
            </label>
            <Input
              id="contact-relationship"
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="contact-phone">
              {t("emergencyContacts.fields.phone")}
            </label>
            <Input id="contact-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="contact-alt-phone">
              {t("emergencyContacts.fields.altPhone")}
            </label>
            <Input
              id="contact-alt-phone"
              value={altPhone}
              onChange={(e) => setAltPhone(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="contact-priority">
              {t("emergencyContacts.fields.priority")}
            </label>
            <Input
              id="contact-priority"
              type="number"
              min={1}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value) || 1)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="contact-notes">
              {t("emergencyContacts.fields.notes")}
            </label>
            <Input id="contact-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
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
            type="button"
            disabled={!canSubmit || mutation.isPending}
            isLoading={mutation.isPending}
            onClick={() => {
              mutation.mutate();
            }}
          >
            {t("emergencyContacts.add")}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
```

- [ ] **Step 3: Confirm the tests pass by construction**

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/features/students/student-emergency-contacts-tab.tsx apps/dashboard/src/features/students/__tests__/student-emergency-contacts-tab.test.tsx
git commit -m "feat(dashboard): add the students emergency contacts tab"
```

- [ ] **Step 5: Push and read CI**

---

## Task 9: `StudentDocumentsTab` + `DocumentUploadDialog`

**Files:**
- Create: `apps/dashboard/src/features/students/document-upload-dialog.tsx`
- Create: `apps/dashboard/src/features/students/student-documents-tab.tsx`
- Create: `apps/dashboard/src/features/students/__tests__/document-upload-dialog.test.tsx`
- Create: `apps/dashboard/src/features/students/__tests__/student-documents-tab.test.tsx`

**Interfaces:**
- Consumes: `Services.students.{fetchDocuments,uploadDocumentRecord,deleteDocument,verifyDocument}` (Task 3), `Services.files.{uploadFile,getDownloadUrl}` (Phase 1, Task 3).
- Produces: `StudentDocumentsTab({ studentId, canCreate, canVerify, canDelete })`. Consumed by Task 10.

**Review Focus #4** (an upload failing at a specific step must show that step's real message) applies here.

- [ ] **Step 1: Write `document-upload-dialog.tsx`'s failing tests**

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { DocumentUploadDialog } from "../document-upload-dialog";

jest.mock("@/services", () => ({
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
import { useTranslations } from "next-intl";
import {
  Alert,
  Button,
  Input,
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
import { Services } from "@/services";

const DOCUMENT_TYPES = [
  "birth_certificate",
  "prior_transfer_certificate",
  "immunization_record",
  "photo_id",
  "prior_report_card",
  "other",
] as const;

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

  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<string>(DOCUMENT_TYPES[0]);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("no file selected");
      const fileId = await Services.files.uploadFile(file, "student.document");
      return Services.students.uploadDocumentRecord(studentId, {
        fileId,
        documentType,
        title,
        ...(notes ? { notes } : {}),
        ...(expiresAt ? { expiresAt } : {}),
      });
    },
    onSuccess: () => {
      onOpenChange(false);
      onUploaded();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t("form.submitFailed"));
    },
  });

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
  }

  const canSubmit = Boolean(file) && title.trim().length > 0;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-md" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("documents.upload")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("documents.uploadDescription")}</p>
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="document-file">
              {t("documents.fields.file")}
            </label>
            <Input id="document-file" type="file" onChange={handleFileChange} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="document-type">
              {t("documents.fields.documentType")}
            </label>
            <Select value={documentType} onValueChange={setDocumentType}>
              <SelectTrigger id="document-type" aria-label={t("documents.fields.documentType")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`documents.type.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="document-title">
              {t("documents.fields.title")}
            </label>
            <Input id="document-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="document-expires-at">
              {t("documents.fields.expiresAt")}
            </label>
            <Input
              id="document-expires-at"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="document-notes">
              {t("documents.fields.notes")}
            </label>
            <Input id="document-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
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
            type="button"
            disabled={!canSubmit || mutation.isPending}
            isLoading={mutation.isPending}
            onClick={() => {
              mutation.mutate();
            }}
          >
            {mutation.isPending ? t("documents.uploading") : t("documents.upload")}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
```

- [ ] **Step 3: Confirm `document-upload-dialog.tsx`'s tests pass by construction, then commit it alone**

```bash
git add apps/dashboard/src/features/students/document-upload-dialog.tsx apps/dashboard/src/features/students/__tests__/document-upload-dialog.test.tsx
git commit -m "feat(dashboard): add the student document upload dialog"
```

- [ ] **Step 4: Write `student-documents-tab.tsx`'s failing tests**

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import type { StudentDocumentRecord } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { StudentDocumentsTab } from "../student-documents-tab";

jest.mock("@/services", () => ({
  Services: {
    students: {
      fetchDocuments: jest.fn(),
      verifyDocument: jest.fn(),
      deleteDocument: jest.fn(),
      uploadDocumentRecord: jest.fn(),
    },
    files: { uploadFile: jest.fn(), getDownloadUrl: jest.fn() },
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
const mockGetDownloadUrl = Services.files.getDownloadUrl as jest.MockedFunction<
  typeof Services.files.getDownloadUrl
>;

function documentRecord(overrides: Partial<StudentDocumentRecord> = {}): StudentDocumentRecord {
  return {
    id: "d1",
    student_id: "student-1",
    file_id: "file-1",
    document_type: "birth_certificate",
    title: "Birth certificate",
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
    mockGetDownloadUrl.mockReset();
    window.open = jest.fn();
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

    await screen.findByText("Birth certificate");
    expect(screen.getByRole("button", { name: /^verify$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
  });

  it("hides verify/reject for an already-verified document", async () => {
    mockFetchDocuments.mockResolvedValue([documentRecord({ verification_status: "verified" })]);

    renderWithProviders(
      <StudentDocumentsTab studentId="student-1" canCreate canVerify canDelete />,
    );

    await screen.findByText("Birth certificate");
    expect(screen.queryByRole("button", { name: /^verify$/i })).not.toBeInTheDocument();
  });

  it("requests a fresh signed URL on every download click and opens it", async () => {
    mockFetchDocuments.mockResolvedValue([documentRecord()]);
    mockGetDownloadUrl.mockResolvedValue("https://files.example.com/x?sig=abc");

    renderWithProviders(
      <StudentDocumentsTab studentId="student-1" canCreate canVerify canDelete />,
    );

    const button = await screen.findByRole("button", { name: /download/i });
    await userEvent.setup().click(button);

    await waitFor(() => {
      expect(mockGetDownloadUrl).toHaveBeenCalledWith("file-1");
    });
    expect(window.open).toHaveBeenCalledWith(
      "https://files.example.com/x?sig=abc",
      "_blank",
      "noopener,noreferrer",
    );
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
    await user.click(await screen.findByRole("button", { name: /delete this document/i }));

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

    await screen.findByText("Birth certificate");
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
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

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import type { DocumentVerificationDecision, StudentDocumentRecord } from "@/services";
import { DocumentUploadDialog } from "./document-upload-dialog";

const STATUS_VARIANT: Record<StudentDocumentRecord["verification_status"], "success" | "warning" | "destructive"> = {
  pending: "warning",
  verified: "success",
  rejected: "destructive",
};

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
  const queryClient = useQueryClient();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const documentsQuery = useQuery({
    queryKey: queryKeys.list("students", "documents", studentId),
    queryFn: () => Services.students.fetchDocuments(studentId),
  });
  const documents = documentsQuery.data ?? [];

  function invalidate() {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.list("students", "documents", studentId),
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
  });

  const deleteMutation = useMutation({
    mutationFn: (documentId: string) => Services.students.deleteDocument(documentId),
    onSuccess: () => {
      invalidate();
      setPendingDeleteId(null);
    },
  });

  const downloadMutation = useMutation({
    mutationFn: (fileId: string) => Services.files.getDownloadUrl(fileId),
    onSuccess: (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
  });

  if (documentsQuery.isPending) {
    return <Skeleton className="h-24 w-full" />;
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
                    {t(`documents.type.${document.document_type}`)}
                    {document.expires_at
                      ? ` · ${t("documents.expiresOn", { date: document.expires_at })}`
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
                    downloadMutation.mutate(document.file_id);
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
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (pendingDeleteId) deleteMutation.mutate(pendingDeleteId);
              }}
            >
              {t("documents.deleteConfirmTitle")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

`AlertDialogCancel`'s `"Cancel"` is a placeholder needing a real `tCommon("cancel")` call — add `const tCommon = useTranslations("common");` alongside the existing `t` and use `{tCommon("cancel")}` there; fix this during Step 5's implementation, not left as shipped English-only text (the `react/jsx-no-literals` lint rule would catch this anyway — treat it as a build error, not a style nit).

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

Add a tab-state hook near the component's other state (`const isDesktop = useIsDesktopShell();` is the existing line to add this after):

```tsx
  const [activeTab, setActiveTab] = useState("profile");
  const { data: currentUser } = useCurrentUser();
```

(`useState` needs adding to this file's existing `"react"` import, which currently only pulls in `type ReactNode` — confirm by reading the file's current top-of-file imports before editing.)

Reset the active tab whenever the sheet closes or a different row opens, so reopening always starts on Profile — add this effect alongside the component's existing logic (there is no existing `useEffect` in this file today; this is the first one):

```tsx
  useEffect(() => {
    if (row === null) setActiveTab("profile");
  }, [row]);
```

(`useEffect` needs adding to the `"react"` import alongside `useState`.)

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
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="flex min-h-0 flex-1 flex-col"
            >
              <TabsList variant="line" className="shrink-0 px-6">
                <TabsTrigger value="profile">{t("tabs.profile")}</TabsTrigger>
                <TabsTrigger value="guardians">{t("tabs.guardians")}</TabsTrigger>
                <TabsTrigger value="emergencyContacts">{t("tabs.emergencyContacts")}</TabsTrigger>
                <TabsTrigger value="documents">{t("tabs.documents")}</TabsTrigger>
              </TabsList>

              <TabsContent value="profile" asChild>
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

              <TabsContent value="guardians" asChild>
                <ResponsiveSheetBody className="flex-1 overflow-y-auto px-6 py-5">
                  {activeTab === "guardians" && (
                    <StudentGuardiansTab
                      studentId={row.id}
                      canCreate={hasPermission(currentUser, "students.guardian.create")}
                      canUpdate={hasPermission(currentUser, "students.guardian.update")}
                    />
                  )}
                </ResponsiveSheetBody>
              </TabsContent>

              <TabsContent value="emergencyContacts" asChild>
                <ResponsiveSheetBody className="flex-1 overflow-y-auto px-6 py-5">
                  {activeTab === "emergencyContacts" && (
                    <StudentEmergencyContactsTab
                      studentId={row.id}
                      canCreate={hasPermission(currentUser, "students.student.update")}
                    />
                  )}
                </ResponsiveSheetBody>
              </TabsContent>

              <TabsContent value="documents" asChild>
                <ResponsiveSheetBody className="flex-1 overflow-y-auto px-6 py-5">
                  {activeTab === "documents" && (
                    <StudentDocumentsTab
                      studentId={row.id}
                      canCreate={hasPermission(currentUser, "students.document.create")}
                      canVerify={hasPermission(currentUser, "students.document.verify")}
                      canDelete={hasPermission(currentUser, "students.document.delete")}
                    />
                  )}
                </ResponsiveSheetBody>
              </TabsContent>
            </Tabs>
```

The `activeTab === "<tab>"` guard around each non-Profile tab's own component (on top of each tab component's own internal `enabled`-style query gating already built into Tasks 7-9's `useQuery` calls with no `enabled` flag of their own) is what actually satisfies this plan's "lazy per-tab data loading" Global Constraint: `TabsContent` keeps every panel mounted in the DOM once visited (Radix's own behavior, for animation), so without this guard a tab's `useQuery` would still be *mounted* — and therefore still fetching — the moment its `TabsContent` first renders, even while a different tab is visually active. Tasks 7-9's own components have no `enabled` option on their queries precisely because they're never mounted until their tab is genuinely selected — this guard is what makes that true.

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
- Modify: `e2e/src/mocks/index.ts`
- Create: `e2e/tests/dashboard/students-relations.spec.ts`

**Interfaces:**
- Consumes: the existing `MockModule`/`ok`/`fail`/`pagedList` helpers (`e2e/src/mocks/envelope.ts`, `e2e/src/mocks/router.ts`), the existing `buildStudent`/`studentsModule` (`e2e/src/mocks/domains/students.ts`), the existing `studentsPage` fixture.
- Produces: `guardiansModule(options)`, `studentRelationsModule(options)`, registered in `e2e/src/mocks/index.ts` alongside every existing domain module.

- [ ] **Step 1: Write `e2e/src/mocks/domains/guardians.ts`**

```ts
import { id } from "@/data/factories";
import { fail, ok, pagedList } from "../envelope";
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
      return pagedList(matching, { page: 1, page_size: 20, total_count: matching.length });
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
      return pagedList(studentLinks, { page: 1, page_size: 20, total_count: studentLinks.length });
    });

    api.post("/students/:studentId/guardians", (request) => {
      const body = (request.json() as { guardian_id: string } & Partial<StudentGuardianLink>) ?? {};
      const alreadyLinked = links.some(
        (l) => l.student_id === request.params["studentId"] && l.guardian_id === body.guardian_id,
      );
      if (alreadyLinked) {
        return fail(422, "This guardian is already linked to this student.", {
          code: "domain_rule_violation",
          details: [
            { field: "non_field", issue: "This guardian is already linked to this student." },
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
import { fail, ok, pagedList } from "../envelope";
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
      return pagedList(rows, { page: 1, page_size: 50, total_count: rows.length });
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
      return pagedList(rows, { page: 1, page_size: 50, total_count: rows.length });
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
      return ok(null, { status: 204 });
    });

    api.post("/student-documents/:documentAction", (request) => {
      const [documentId, action] = (request.params["documentAction"] ?? "").split(":");
      const match = documents.find((d) => d.id === documentId);
      if (action !== "verify" || !match) return fail(404, "Not found.");
      const { decision } = (request.json() as { decision: "verified" | "rejected" }) ?? {};
      match.verification_status = decision;
      return ok(match);
    });

    api.post("/files/:fileAction", (request) => {
      const [, action] = (request.params["fileAction"] ?? "").split(":");
      if (action !== "download") return fail(404, "Not found.");
      return ok({ download_url: "https://files.example.test/signed-download" });
    });
  };
}
```

(`/files/:fileAction` for `:download` may already be registered by another existing mock module for Phase 1's photo flow — before adding this handler, check `e2e/src/mocks/domains/*.ts` for an existing `/files/:fileAction`/`/files/:id:download` route; if one already exists, extend that existing handler to also answer `:download` rather than registering a second, conflicting one for the same path.)

- [ ] **Step 3: Register both modules in `e2e/src/mocks/index.ts`**

Add `export * from "./domains/guardians";` and `export * from "./domains/student-relations";` alongside the file's existing per-domain exports (`export * from "./domains/students";` etc. — confirm the exact existing line to match its style before adding these two).

- [ ] **Step 4: Write `e2e/tests/dashboard/students-relations.spec.ts`**

```ts
import { expect, test } from "@/fixtures";
import { buildUser, SCHOOL_ADMIN_PERMISSIONS } from "@/data/factories";
import { buildCampus, schoolOrganizationModule } from "@/mocks";
import { buildStudent, studentsModule } from "@/mocks";
import { buildGuardian, buildGuardianLink, guardiansModule } from "@/mocks";
import { buildEmergencyContact, buildStudentDocument, studentRelationsModule } from "@/mocks";

const campuses = [buildCampus({ id: "campus-0001", name: "Main Campus" })];
const student = buildStudent({ id: "student-0001", first_name: "Ayesha", last_name: "Khan" });

test.describe("student detail sheet — relations tabs", () => {
  test.use({
    authUser: buildUser({
      permissions: [
        ...SCHOOL_ADMIN_PERMISSIONS,
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
    await page.getByRole("option", { name: /bilal ahmed/i }).click();
    await page.getByRole("combobox", { name: /relationship/i }).click();
    await page.getByRole("option", { name: /^father$/i }).click();
    await page.getByRole("button", { name: /^link guardian$/i }).click();

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
    await page.getByRole("button", { name: /^add contact$/i }).click();

    await expect(page.getByText("Zainab Malik")).toBeVisible();
  });

  test("uploads a document, then verifies it", async ({ page, signedIn: _signedIn, mockApi, studentsPage }) => {
    mockApi.use(
      schoolOrganizationModule({ campuses, houses: [] }),
      studentsModule({ students: [student] }),
      guardiansModule({}),
      studentRelationsModule({}),
    );
    await studentsPage.goto();
    await studentsPage.row("Ayesha Khan").click();
    await page.getByRole("tab", { name: /^documents$/i }).click();
    await page.getByRole("button", { name: /upload document/i }).click();

    await page.getByLabel(/^file$/i).setInputFiles({
      name: "birth-cert.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("fake pdf bytes"),
    });
    await page.getByLabel(/^title$/i).fill("Birth certificate");
    await page.getByRole("button", { name: /^upload document$/i }).click();

    await expect(page.getByText("Birth certificate")).toBeVisible();
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
    await page.getByRole("button", { name: /delete this document/i }).click();

    await expect(page.getByText("Old document")).toHaveCount(0);
  });
});

test.describe("student detail sheet — relations tabs, view-only permissions", () => {
  test.use({ authUser: buildUser({ permissions: SCHOOL_ADMIN_PERMISSIONS }) });

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

(Confirm `SCHOOL_ADMIN_PERMISSIONS` holds `students.student.view`/`.update` already — Phase 1's own e2e spec already relies on this; re-check it directly rather than assuming, same discipline Phase 1's own round-2 review caught a wrong assumption about.)

- [ ] **Step 5: Commit**

```bash
git add e2e/src/mocks/domains/guardians.ts e2e/src/mocks/domains/student-relations.ts e2e/src/mocks/index.ts e2e/tests/dashboard/students-relations.spec.ts
git commit -m "test(e2e): add mocked coverage for the guardians/emergency-contacts/documents tabs"
```

- [ ] **Step 6: Push and read CI**

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
download (a fresh signed URL requested per click, never cached). No new backend endpoints —
every call in this phase was already live; the only backend change was closing four pre-existing
test coverage gaps (guardian search/list, a single link's retrieve, a guardian's own PATCH, and
emergency contacts' cross-tenant isolation).
```

- [ ] **Step 2: Update `project-status.md`'s student-management row**

In the "Dashboard screens" column of the `student-management` row (table under "Per-module implementation matrix"), change "Guardians/emergency contacts/documents... are **not yet rebuilt**" to reflect Phase 2 shipping: name what's now built (the four tabs) and narrow the remaining gap to enrollment/transfers (Phase 3) and bulk import/export/ID cards (Phase 4) only.

- [ ] **Step 3: Add the two permanent-gap entries to `deferred-work.md`**

```markdown
- **No unlink for a student-guardian link, no edit/delete for an emergency contact.**
  `StudentGuardianLinkViewSet` and `EmergencyContactLinkViewSet` (`apps/api/apps/student_management/views.py`)
  are both list+create only — confirmed by reading the real viewset classes, not assumed. The
  students Phase 2 dashboard work (`docs/superpowers/plans/2026-10-03-students-phase2-relations.md`)
  states this plainly in its UI copy rather than inventing a workaround. Adding these endpoints
  is a real, separate backend decision (what happens to history/audit on an unlink; whether an
  emergency contact edit needs its own permission key) — not a UI gap to quietly patch over.
- **Guardian seed commands' cross-app imports are grandfathered, not clean.** Reaching into
  `apps.school_organization`/`apps.student_management` from `core.rbac.management.commands` is
  flagged by `test_no_new_cross_app_import_violations` (ADR-0013) for anything *new* — the
  existing `seed_e2e_data`/`seed_all_roles` entries are pre-existing, shrink-only-baseline
  exceptions, not a pattern to extend. If a future seed command needs the same thing, the real
  fix named in `test_import_boundaries.py`'s own comment is moving these commands to a
  dedicated, non-`core` app — not another baseline entry.
```

- [ ] **Step 4: Commit**

```bash
git add docs/03-modules/student-management.md docs/project-status.md docs/deferred-work.md
git commit -m "docs: record the students Phase 2 (guardians/emergency contacts/documents) delivery"
```

- [ ] **Step 5: Push and read CI**

---

## Verification

End-to-end after Task 11: sign in as `school_admin` on a seeded dev tenant, open a student's detail sheet, confirm it opens on Profile exactly as before. Switch to Guardians: link an existing guardian via search, link a brand-new one via create, promote one to primary (watch the other's badge disappear), edit a link's flags, edit a guardian's own phone number. Switch to Emergency Contacts: add one, confirm there is no edit or delete control anywhere on its row. Switch to Documents: upload a PDF, confirm it shows "Pending", verify it, confirm the badge updates, download it (confirm a real signed URL opens), delete a different document after confirming. Switch back to Profile and confirm nothing there changed. Reopen the sheet for a different student and confirm it defaults to Profile again, not whatever tab was last open.

