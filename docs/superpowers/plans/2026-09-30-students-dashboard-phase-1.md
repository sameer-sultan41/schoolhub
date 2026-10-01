# Students Dashboard Module — Phase 1 (Foundation + Directory) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Work tier:** 2

**Goal:** Replace the `/students` "Coming soon" placeholder with a real directory screen — list, create, edit, view, and withdraw a student — built to the same standard as the rebuilt `/staff` screen, but *correcting* the drift `/staff` shipped with rather than repeating it: feature code lives in the documented `src/features/<module>/` location, and student-domain calls get their own `Services.students` module. Mobile responsiveness is built in from the start. Domain wire types are the generated `ApiSchemas` from `@schoolhub/api-client`, re-exported from the services layer — not a hand-maintained duplicate in `packages/types` — settled by a new ADR this plan adds (Task 10), since two review rounds confirmed the existing `schoolhub-api-services` skill's own example predates the OpenAPI generator landing and needs updating to match, not the other way around.

**Base branch note:** branch this work off `main` *after* `git fetch origin main` — `refactor/dashboard-src-conventions` (PR #95, adding `apps/dashboard/src/lib/helpers.ts`, `Paths`, `Regex`, `Cookies`) merged on GitHub 2026-09-30; a stale local `main` ref won't have it yet. Task 6 depends on `getInitials`/`stableSignedUrl` from that file.

**Architecture:** Same shape as `/staff`: a thin route `page.tsx`, a `DataGrid`-backed directory table with local (non-URL) state for search/sort/pagination/filters, a `ResponsiveDialog` create/edit form, a `ResponsiveSheet` detail view, and a `ResponsiveDialog`/`Drawer` withdraw action — all driven through TanStack Query against a new `Services.students` (plus one addition to the existing `Services.dashboard`/`Services.schoolOrganization` reference-data surface), never `apiClient` directly. This phase ships student **identity and profile management only**. Phases 2–4 (relations, enrollment/transfers, bulk ops) are recorded in the **Roadmap**, each becoming its own full plan when its turn comes.

**Tech Stack:** Next.js 16 (App Router), TanStack Query v5, react-hook-form + zod, `@schoolhub/ui` (Metronic-ported primitives), Django 6.1 + DRF (one field addition), Playwright (mocked `dashboard` project).

**Spec:** `docs/03-modules/student-management.md` §4, §7.2, §11, §16. Entity shape: `docs/05-database/entities/people.md`.

## Global Constraints

- **Feature flag:** every student endpoint requires `module.students`, off by default. Seeded dev/e2e tenants already enable it.
- **Permission keys used this phase:** `students.student.view`, `.create`, `.update`, `.withdraw`. Gate every action with `hasPermission(currentUser, key)` — UI gating is UX only.
- **`admission_number` is server-generated and immutable** — shown read-only on the detail sheet.
- **No hard delete in the UI** — only `POST /students/{id}:withdraw`.
- **Withdraw is offered only for `active` students**, hidden (not disabled) otherwise — `withdraw_student` (`apps/api/apps/student_management/services.py`) calls `assert_student_active` first and raises a `non_field` `DomainRuleViolation` ("Student is {status}, not active.") for anything else, and every action state (row action, bulk-selection filtering, detail-sheet footer) must reflect that same rule, not just the viewer's own permission.
- **`waive_clearance` is not a form field this phase.** `clearance_blockers()` is hard-coded to return `[]` until fees/library/transport exist — the checkbox would always be a no-op today. `withdrawStudent` always sends `waiveClearance: false`. A `deferred-work.md` entry (Task 10) tracks the real control.
- **Filters this phase: search, status, campus, house** — built with the same `Select` primitive the form already uses, not a hand-rolled, keyboard-inaccessible listbox. Class/section/session filters wait for Phase 3's enrollment UI (a dead control otherwise).
- **Query keys** go through the `queryKeys` factory — `queryKeys.list("students", "students", params)`, `.detail("students", "students", id)`, `.module("students")`. A create/update/withdraw also invalidates `queryKeys.module("dashboard")` (the dashboard home's own `["dashboard","overview"]`-keyed stat widgets read `Services.dashboard`'s student count). **No inline `queryKey: [...]` arrays.**
- **Campus reference data is reused, not duplicated.** `Services.dashboard.fetchCampuses()` already exists, is correctly implemented, and is already tested. Houses have no existing fetcher — `Services.schoolOrganization.fetchHouses()` is new. **This plan does not touch any file under `apps/dashboard/src/app/(app)/staff/`.**
- **`addressSchema` stays local to the student form** this phase, not extracted — `repo-structure.md` §5 tolerates a second copy and extracts on the third.
- **Every string goes in both `messages/en.json` and `ur.json`.** New files have zero tolerance for hardcoded literals.
- **`useIsDesktopShell()` (1024px), never `useIsMobile()`.**
- **Colors:** `--sh-*` tokens only. **RTL:** logical props only. **Imports:** `@/` alias only; `@schoolhub/api-client` only inside `src/services/**`/`src/lib/**`.
- **Tests:** sibling `__tests__/` folders. Coverage floor is 85% global and only ever rises.
- **A destructive action honors `Idempotency-Key`** (`RequestOptions.idempotencyKey`, `packages/api-client/src/client.ts:24,174` — already wired). `withdrawStudent` generates one key per (dialog-open, student) pair and reuses it on a same-dialog retry.
- **New files cannot add an ESLint `max-lines` suppression** — the lint baseline is shrink-only (ADR-0014); unlike `/staff`'s own 1051/720-line files, which carry grandfathered suppressions, a new file over the limit is a hard CI failure with no workaround. Task 5 and Task 8 are each split into a schema/mapping file, a sub-field component, a filters component and a columns file specifically to stay under it — not a style preference, a compile-time requirement discovered in review.
- **Error messages always show the server's real text for a `non_field` detail.** `resolveErrorMessage(error, tErrors, fallback, field)`'s `field` argument looks up that exact field in `error.fieldErrors()` before falling back to a generic per-code translation (`lib/error-message.ts`) — every call site that might be showing a `non_field`-shaped domain-rule error (the duplicate-admission check, the not-active withdraw check) passes `"non_field"` explicitly. Passing no `field` silently discards the one piece of information Review Focus #1 and #2 exist to prove.
- **Never run tests, linters or typechecks locally.** Commit, push, watch `gh pr checks <n> --watch`.

## Alternatives Considered (why not)

- **Copy `/staff`'s route-folder + `Services.dashboard` structure verbatim.** Rejected: the repo's own docs were written *after* `/staff` shipped to stop the next module repeating that drift.
- **Hand-maintain a `StudentRecord` interface in `packages/types`.** This plan's first draft did; round-1 review caught it drifting from the real contract already (`packages/api-client`'s OpenAPI generator has landed — `Student`/`GenderEnum`/`StudentStatusEnum` are already generated). `packages/types` cannot import `@schoolhub/api-client` (dependency runs the other way), so the generated type is defined and re-exported from the dashboard's services layer instead (Task 3). `packages/types` keeps only the two runtime value-arrays with no generated source. Round-2 review is right that this contradicts the `schoolhub-api-services` skill's own written example as it stands today — Task 10 adds an ADR settling it and updates the skill and `packages/types`' header in the same PR, rather than leaving the convention only implied by this plan's code.
- **Extract `addressSchema` and move `fetchCampuses`, both touching `/staff`'s file.** Reversed after round-1 review — `/staff` is untouched by this plan.
- **Build the full tabbed detail view now.** Rejected: no working component to extend yet; Phase 2 wraps the flat sheet in `Tabs`.
- **A client-side-filtered `/student-transfers` workaround for the missing `student_id` filter.** Not this phase's problem; the real fix (a one-line `filterset_fields` addition) is recorded in the Roadmap.

## Review Focus

1. **A 422 duplicate-admission error (same name + DOB) on create.** The server's `non_field` message text ends "Pass an override reason to create anyway" — the API has no field for that reason to reach it, so the UI shows the message plainly (via `resolveErrorMessage(error, tErrors, fallback, "non_field")`, not the generic per-code fallback) without adding a control it can't back. Pinned in Task 5.
2. **A non-active student's row offering Withdraw, or a bulk withdraw where some succeed and others fail** (`assert_student_active` rejects a non-active row with a `non_field` error, shown per-row via the same `field: "non_field"` lookup). Mirrors `/staff`'s `ExitStaffDialog` partial-failure handling. Pinned in Task 7 and Task 8 (the row action is hidden, not disabled).
3. **`medical_notes` absent from the response** for a caller without visibility. "Restricted" renders only when the key is genuinely absent (`"medical_notes" in data === false`), never when merely falsy. Pinned in Task 6.
4. **A 403-shaped list response vs. a generic network error vs. a legitimately empty filtered result.** A `class_teacher`'s `assigned` scope is empty on a fresh tenant until Phase 3 ships enrollment — a known Phase 1 limitation — but the three UI states stay visibly distinct. Pinned in Task 8.
5. **A student photo uploaded, then the dialog closed (and possibly reopened for the same or a different student) before the upload resolves.** The guard is an "open session" counter, not a boolean — a boolean can't distinguish "still the same open session" from "closed and reopened before the promise settled." Pinned in Task 5.

## File Structure

```
apps/api/apps/student_management/
  serializers.py                          # MODIFY — add photo_url (Task 1)
  views.py                                # MODIFY — select_related("photo_file") (Task 1)
  tests/test_api.py                       # MODIFY — StudentPhotoUrlTests class (Task 1)
  tests/test_cross_tenant.py              # MODIFY — foreign-tenant photo_file_id test (Task 1)

docs/decisions/0017-generated-wire-types-for-new-domains.md   # CREATE (Task 10)
docs/decisions/README.md                  # MODIFY — add ADR-0017's index row (Task 10)
docs/02-architecture/repo-structure.md    # MODIFY — point §2's type-location row at ADR-0017 (Task 10)

packages/types/src/
  student.ts                              # CREATE — GENDER_VALUES, STUDENT_STATUS_VALUES (Task 2)
  index.ts                                # MODIFY (Task 2)

apps/dashboard/src/
  services/endpoints.ts                   # MODIFY (Task 3)
  services/index.ts                       # MODIFY — register + re-export StudentRecord (Task 3)
  services/__tests__/index.test.ts        # MODIFY (Task 3)
  services/modules/school-organization/   # CREATE — fetchHouses (Task 3)
  services/modules/students/              # CREATE — CRUD + withdraw, StudentRecord alias (Task 3)
  messages/en.json, messages/ur.json      # MODIFY (Task 4)
  features/students/
    student-row.ts                        # CREATE — shared StudentRow + mapper (Task 3)
    student-form-schema.ts                # CREATE — zod schema + buildStudentInput (Task 5)
    student-address-fields.tsx            # CREATE — the 6 address inputs (Task 5)
    student-form-dialog.tsx               # CREATE (Task 5)
    student-detail-sheet.tsx              # CREATE (Task 6)
    withdraw-student-dialog.tsx           # CREATE (Task 7)
    student-columns.tsx                   # CREATE — DataGrid column defs (Task 8)
    student-directory-filters.tsx         # CREATE — search/status/campus/house toolbar (Task 8)
    student-toolbar.tsx                   # CREATE (Task 8)
    student-directory-table.tsx           # CREATE (Task 8)
    __tests__/                            # one test file per component above
  app/(app)/students/page.tsx             # MODIFY (Task 9)

e2e/src/mocks/domains/students.ts         # CREATE (Task 9)
e2e/src/mocks/domains/school-organization.ts  # MODIFY — add houses (Task 9)
e2e/src/mocks/index.ts                    # MODIFY (Task 9)
e2e/src/pages/dashboard/students.page.ts  # CREATE (Task 9)
e2e/src/pages/index.ts                    # MODIFY (Task 9)
e2e/src/fixtures/index.ts                 # MODIFY — add studentsPage fixture, alongside existing ones (Task 9)
e2e/tests/dashboard/students.spec.ts      # CREATE (Task 9)

docs/superpowers/plans/2026-09-30-students-dashboard-phase-1.md   # this plan (Task 10)
docs/03-modules/student-management.md     # MODIFY — add §20 (Task 10)
apps/dashboard/AGENTS.md                  # MODIFY — point at ADR-0017 alongside repo-structure.md (Task 10)
docs/project-status.md                    # MODIFY (Task 10)
docs/metronic-dashboard-shell.md          # MODIFY (Task 10)
docs/deferred-work.md                     # MODIFY (Task 10)
.claude/skills/schoolhub-api-services/SKILL.md   # MODIFY — align with the generated-types ADR (Task 10)
packages/types/src/index.ts               # MODIFY — header note pointing at the ADR (Task 10)
root AGENTS.md                            # MODIFY — add the new skill to the table (Task 11)

.claude/skills/schoolhub-dashboard-screen/SKILL.md   # CREATE (Task 11)
```

---

## Task 1: Backend — expose a signed `photo_url` on `Student`

**Files:**
- Modify: `apps/api/apps/student_management/serializers.py`
- Modify: `apps/api/apps/student_management/views.py`
- Modify: `apps/api/apps/student_management/tests/test_api.py`
- Modify: `apps/api/apps/student_management/tests/test_cross_tenant.py`

**Interfaces:**
- Consumes: `core.files.serializers.SignedFileURLField`.
- Produces: `Student.photo_url`. Task 3's `StudentRecord` alias and Tasks 5/6/8's components depend on it.

- [ ] **Step 1: Write the failing tests, mirroring `StaffPhotoUrlTests` exactly**

Add to `apps/api/apps/student_management/tests/test_api.py` (`StudentManagementAPITestCase` already anchors every class in this file, `test_api.py:35`):

```python
from django.db import connection
from django.test.utils import CaptureQueriesContext

from core.files.models import FileStatus
from core.files.tests.factories import FileFactory  # confirmed import path — matches staff_management/staff/tests/test_endpoints.py:28


class StudentPhotoUrlTests(StudentManagementAPITestCase):
    def _student_with_photo(self, **file_overrides):
        with tenant_context(self.tenant.id):
            photo = FileFactory(tenant=self.tenant, **{"purpose": "student.photo", "mime_type": "image/png", **file_overrides})
            student = StudentFactory(tenant=self.tenant, campus=self.campus, photo_file=photo)
        return student, photo

    def test_list_and_retrieve_carry_a_link_for_a_ready_photo(self) -> None:
        self.allow("students.student.view")
        student, photo = self._student_with_photo()
        listed = self.client.get("/api/v1/students").json()["data"][0]
        retrieved = self.client.get(f"/api/v1/students/{student.pk}").json()["data"]
        for payload in (listed, retrieved):
            self.assertEqual(payload["photo_file_id"], str(photo.pk))
            self.assertIn(photo.storage_key, payload["photo_url"])

    def test_no_photo_or_an_unconfirmed_upload_is_null(self) -> None:
        self.allow("students.student.view")
        with tenant_context(self.tenant.id):
            StudentFactory(tenant=self.tenant, campus=self.campus)
        self._student_with_photo(status=FileStatus.PENDING)
        rows = self.client.get("/api/v1/students").json()["data"]
        self.assertEqual([row["photo_url"] for row in rows], [None, None])

    def test_photo_url_is_read_only(self) -> None:
        self.allow("students.student.view", "students.student.update")
        student, photo = self._student_with_photo()
        response = self.client.patch(f"/api/v1/students/{student.pk}", {"photo_url": "https://attacker.invalid/x.png"}, format="json")
        self.assertEqual(response.status_code, 200, response.json())
        self.assertIn(photo.storage_key, response.json()["data"]["photo_url"])

    def test_patch_rejects_a_file_that_is_not_a_student_photo(self) -> None:
        self.allow("students.student.view", "students.student.update")
        student, photo = self._student_with_photo()
        with tenant_context(self.tenant.id):
            document = FileFactory(tenant=self.tenant, purpose="student.document", mime_type="image/png")
        response = self.client.patch(f"/api/v1/students/{student.pk}", {"photo_file_id": str(document.pk)}, format="json")
        self.assertEqual(response.status_code, 422)
        with tenant_context(self.tenant.id):
            student.refresh_from_db()
        self.assertEqual(student.photo_file_id, photo.pk)

    def test_patch_still_accepts_the_current_photo_unchanged(self) -> None:
        self.allow("students.student.view", "students.student.update")
        student, legacy = self._student_with_photo(purpose="student.document")
        response = self.client.patch(f"/api/v1/students/{student.pk}", {"photo_file_id": str(legacy.pk), "first_name": "Renamed"}, format="json")
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()["data"]["first_name"], "Renamed")

    def test_listing_photos_costs_no_query_per_row(self) -> None:
        self.allow("students.student.view")
        self._student_with_photo()
        self.client.get("/api/v1/students")  # warm-up
        with CaptureQueriesContext(connection) as one_row:
            self.client.get("/api/v1/students")
        for _ in range(4):
            self._student_with_photo()
        with CaptureQueriesContext(connection) as five_rows:
            response = self.client.get("/api/v1/students")
        self.assertEqual(len(response.json()["data"]), 5)
        self.assertEqual(len(five_rows), len(one_row))
```

Add to `apps/api/apps/student_management/tests/test_cross_tenant.py`, in `CrossTenantAccessTests`, matching its real `setUp` (`self.tenant_a`/`self.tenant_b`, `self.own`/`self.foreign` dicts built by `_build_structure`):

```python
    def test_patching_a_photo_from_another_tenant_is_rejected(self) -> None:
        with tenant_context(self.tenant_b.id):
            foreign_photo = FileFactory(tenant=self.tenant_b, purpose="student.photo", mime_type="image/png")
        response = self.client.patch(
            f"/api/v1/students/{self.own['students'].pk}",
            {"photo_file_id": str(foreign_photo.pk)},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
```

Add `from core.files.tests.factories import FileFactory` to this file's imports.

- [ ] **Step 2: Confirm the tests fail by construction (do not run them)**

- [ ] **Step 3: Add `photo_url` and the ownership guard to `StudentSerializer`**

```python
from core.files.serializers import SignedFileURLField
```

Right after the existing `photo_file_id` line in `StudentSerializer`:

```python
    photo_file_id = _fk(File, source="photo_file", required=False, allow_null=True)
    photo_url = SignedFileURLField(source="photo_file")
```

Add `"photo_url"` to `Meta.fields`. Add the ownership guard, mirroring `staff/serializers.py:100-106`:

```python
    def validate_photo_file_id(self, value: File | None) -> File | None:
        if value is not None and value.pk != getattr(self.instance, "photo_file_id", None):
            services.assert_file_usable(file=value, purpose=uploads.STUDENT_PHOTO.key)
        return value
```

- [ ] **Step 4: Add `select_related("photo_file")` to `StudentViewSet.get_queryset`**

- [ ] **Step 5: Regenerate the API contract**

```bash
apps/api/scripts/generate-openapi.sh
pnpm --filter @schoolhub/api-client generate
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/apps/student_management/serializers.py apps/api/apps/student_management/views.py apps/api/apps/student_management/tests/test_api.py apps/api/apps/student_management/tests/test_cross_tenant.py apps/api/openapi.yaml packages/api-client/src/schema.d.ts
git commit -m "feat(api): expose a signed photo_url on Student, matching staff"
```

---

## Task 2: Shared runtime values — `packages/types/src/student.ts`

**Files:**
- Create: `packages/types/src/student.ts`
- Modify: `packages/types/src/index.ts`

**Interfaces:**
- Produces: `GenderValue`, `GENDER_VALUES`, `StudentStatus`, `STUDENT_STATUS_VALUES`. Consumed by Task 5's form, Task 8's status filter.

- [ ] **Step 1: Write `student.ts`**

```ts
/**
 * Student domain runtime values with no generated equivalent — the wire shape itself
 * is `ApiSchemas["Student"]`, defined in `apps/dashboard/src/services/modules/students/`
 * (see `docs/decisions/0017-generated-wire-types-for-new-domains.md`).
 */

export const GENDER_VALUES = ["male", "female", "other", "unspecified"] as const;
export type GenderValue = (typeof GENDER_VALUES)[number];

export const STUDENT_STATUS_VALUES = ["active", "suspended", "transferred", "withdrawn", "graduated"] as const;
export type StudentStatus = (typeof STUDENT_STATUS_VALUES)[number];
```

- [ ] **Step 2: Register the export**

```ts
export * from "./student";
```

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/student.ts packages/types/src/index.ts
git commit -m "feat(types): add student gender/status value arrays"
```

---

## Task 3: `Services.schoolOrganization` (houses) and `Services.students`

**Files:**
- Modify: `apps/dashboard/src/services/endpoints.ts`
- Modify: `apps/dashboard/src/services/index.ts`
- Modify: `apps/dashboard/src/services/__tests__/index.test.ts`
- Create: `apps/dashboard/src/services/modules/school-organization/{school-organization-service.ts,index.ts,__tests__/school-organization-service.test.ts}`
- Create: `apps/dashboard/src/services/modules/students/{students-service.ts,index.ts,__tests__/students-service.test.ts}`
- Create: `apps/dashboard/src/features/students/student-row.ts`

**Interfaces:**
- Consumes: `apiClient`; `Services.dashboard.fetchCampuses` (existing, reused).
- Produces: `Services.schoolOrganization.fetchHouses()`; `Services.students.{fetchStudentsPage,fetchStudentById,createStudent,updateStudent,withdrawStudent}`; `StudentRecord` type (re-exported from `@/services`); `StudentRow`/`toStudentRow`. Consumed by Tasks 5, 6, 7, 8.

- [ ] **Step 1: Add the new paths**

`endpoints.dashboard.students` (`"/students"`) already exists and `dashboard-service.ts:47`'s `fetchTotal` reads it — **do not remove it**. Add, additively:

```ts
  schoolOrganization: {
    houses: "/houses",
  },
  students: {
    list: "/students",
    detail: (id: string) => `/students/${id}`,
    withdraw: (id: string) => `/students/${id}:withdraw`,
  },
```

- [ ] **Step 2: Write the failing test for `fetchHouses`**

```ts
const mockGet = jest.fn();
jest.mock("@schoolhub/api-client", () => ({
  ...jest.requireActual("@schoolhub/api-client"),
  createApiClient: jest.fn(() => ({ get: mockGet, post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn(), refresh: jest.fn() })),
}));

describe("school-organization-service", () => {
  beforeEach(() => { jest.resetModules(); mockGet.mockReset(); });

  it("fetches houses from the real endpoint", async () => {
    const { fetchHouses } = await import("../school-organization-service");
    mockGet.mockResolvedValue({ data: [{ id: "h1", name: "Griffin" }], meta: {} });
    const result = await fetchHouses();
    expect(mockGet).toHaveBeenCalledWith("/houses", expect.objectContaining({ query: { page_size: expect.any(Number) } }));
    expect(result).toEqual([{ id: "h1", name: "Griffin" }]);
  });
});
```

- [ ] **Step 3: Confirm it fails by construction, then implement**

```ts
import { fetchPage, MAX_PAGE_SIZE } from "@schoolhub/api-client";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";

export interface SchoolOrganizationOption { id: string; name: string }

/** `GET /houses` — every house, for a reference-data select/filter. */
export async function fetchHouses(): Promise<SchoolOrganizationOption[]> {
  const { items } = await fetchPage<SchoolOrganizationOption>(apiClient, endpoints.schoolOrganization.houses, {
    query: { page_size: MAX_PAGE_SIZE },
  });
  return items;
}
```

`index.ts`:

```ts
import { fetchHouses } from "./school-organization-service";
export const SchoolOrganizationService = { fetchHouses };
export type { SchoolOrganizationOption } from "./school-organization-service";
```

- [ ] **Step 4: Write the failing tests for `students-service.ts`**

```ts
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
jest.mock("@schoolhub/api-client", () => ({
  ...jest.requireActual("@schoolhub/api-client"),
  createApiClient: jest.fn(() => ({ get: mockGet, post: mockPost, put: jest.fn(), patch: mockPatch, delete: jest.fn(), refresh: jest.fn() })),
}));

describe("students-service", () => {
  beforeEach(() => { jest.resetModules(); mockGet.mockReset(); mockPost.mockReset(); mockPatch.mockReset(); });

  it("fetchStudentsPage sends filters as snake_case query params", async () => {
    const { fetchStudentsPage } = await import("../students-service");
    mockGet.mockResolvedValue({ data: [], meta: { pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 0 } } });
    await fetchStudentsPage({ page: 1, pageSize: 10, search: "ali", status: "active", campusId: "c1" });
    expect(mockGet).toHaveBeenCalledWith("/students", expect.objectContaining({
      query: { page: 1, page_size: 10, search: "ali", status: "active", campus_id: "c1" },
    }));
  });

  it("createStudent maps camelCase input to the snake_case request body", async () => {
    const { createStudent } = await import("../students-service");
    mockPost.mockResolvedValue({ data: { id: "s1" } });
    await createStudent({ firstName: "Ali", lastName: "Khan", dateOfBirth: "2012-05-01", gender: "male", campusId: "c1", admissionDate: "2026-01-10" });
    expect(mockPost).toHaveBeenCalledWith("/students", {
      first_name: "Ali", last_name: "Khan", date_of_birth: "2012-05-01", gender: "male", campus_id: "c1", admission_date: "2026-01-10",
    });
  });

  it("updateStudent sends null (not omitted) for an explicitly cleared house", async () => {
    const { updateStudent } = await import("../students-service");
    mockPatch.mockResolvedValue({ data: { id: "s1" } });
    await updateStudent("s1", { houseId: null });
    expect(mockPatch).toHaveBeenCalledWith("/students/s1", { house_id: null });
  });

  it("withdrawStudent posts to the colon-action path with an Idempotency-Key", async () => {
    const { withdrawStudent } = await import("../students-service");
    mockPost.mockResolvedValue({ data: { id: "s1", status: "withdrawn" } });
    await withdrawStudent("s1", { reason: "Relocated", effectiveDate: "2026-02-01" }, "key-abc");
    expect(mockPost).toHaveBeenCalledWith(
      "/students/s1:withdraw",
      { reason: "Relocated", effective_date: "2026-02-01", waive_clearance: false },
      expect.objectContaining({ idempotencyKey: "key-abc" }),
    );
  });
});
```

- [ ] **Step 5: Confirm the tests fail by construction, then implement `students-service.ts`**

```ts
import type { ApiSchemas } from "@schoolhub/api-client";
import { fetchPage } from "@schoolhub/api-client";
import type { GenderValue } from "@schoolhub/types";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";

/** The generated wire shape — see `docs/decisions/0017-generated-wire-types-for-new-domains.md`. */
export type StudentRecord = ApiSchemas["Student"];

export interface StudentsPageQuery {
  page: number;
  pageSize: number;
  search?: string;
  ordering?: string;
  status?: string;
  campusId?: string;
  houseId?: string;
}

export async function fetchStudentsPage(query: StudentsPageQuery): Promise<Page<StudentRecord>> {
  return fetchPage<StudentRecord>(apiClient, endpoints.students.list, {
    query: {
      page: query.page,
      page_size: query.pageSize,
      ...(query.search ? { search: query.search } : {}),
      ...(query.ordering ? { ordering: query.ordering } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.campusId ? { campus_id: query.campusId } : {}),
      ...(query.houseId ? { house_id: query.houseId } : {}),
    },
  });
}

export async function fetchStudentById(id: string): Promise<StudentRecord> {
  const { data } = await apiClient.get<StudentRecord>(endpoints.students.detail(id));
  return data;
}

/** camelCase, matching every other service input type in this codebase. Nullable
 * fields are `| null` so a caller can explicitly clear them on update. */
export interface CreateStudentInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: GenderValue;
  campusId: string;
  admissionDate: string;
  preferredName?: string | null;
  houseId?: string | null;
  photoFileId?: string | null;
  bloodGroup?: string | null;
  nationality?: string | null;
  religion?: string | null;
  previousSchool?: string | null;
  medicalNotes?: string | null;
  address?: Record<string, unknown> | null;
}

export async function createStudent(input: CreateStudentInput): Promise<StudentRecord> {
  const { data } = await apiClient.post<StudentRecord>(endpoints.students.list, {
    first_name: input.firstName,
    last_name: input.lastName,
    date_of_birth: input.dateOfBirth,
    gender: input.gender,
    campus_id: input.campusId,
    admission_date: input.admissionDate,
    ...(input.preferredName ? { preferred_name: input.preferredName } : {}),
    ...(input.houseId ? { house_id: input.houseId } : {}),
    ...(input.photoFileId ? { photo_file_id: input.photoFileId } : {}),
    ...(input.bloodGroup ? { blood_group: input.bloodGroup } : {}),
    ...(input.nationality ? { nationality: input.nationality } : {}),
    ...(input.religion ? { religion: input.religion } : {}),
    ...(input.previousSchool ? { previous_school: input.previousSchool } : {}),
    ...(input.medicalNotes ? { medical_notes: input.medicalNotes } : {}),
    ...(input.address ? { address: input.address } : {}),
  });
  return data;
}

export type UpdateStudentInput = Partial<CreateStudentInput>;

export async function updateStudent(id: string, input: UpdateStudentInput): Promise<StudentRecord> {
  const body: Record<string, unknown> = {};
  if (input.firstName !== undefined) body.first_name = input.firstName;
  if (input.lastName !== undefined) body.last_name = input.lastName;
  if (input.dateOfBirth !== undefined) body.date_of_birth = input.dateOfBirth;
  if (input.gender !== undefined) body.gender = input.gender;
  if (input.campusId !== undefined) body.campus_id = input.campusId;
  if (input.admissionDate !== undefined) body.admission_date = input.admissionDate;
  if (input.preferredName !== undefined) body.preferred_name = input.preferredName;
  if (input.houseId !== undefined) body.house_id = input.houseId;
  if (input.photoFileId !== undefined) body.photo_file_id = input.photoFileId;
  if (input.bloodGroup !== undefined) body.blood_group = input.bloodGroup;
  if (input.nationality !== undefined) body.nationality = input.nationality;
  if (input.religion !== undefined) body.religion = input.religion;
  if (input.previousSchool !== undefined) body.previous_school = input.previousSchool;
  if (input.medicalNotes !== undefined) body.medical_notes = input.medicalNotes;
  if (input.address !== undefined) body.address = input.address;
  const { data } = await apiClient.patch<StudentRecord>(endpoints.students.detail(id), body);
  return data;
}

export interface WithdrawStudentInput { reason: string; effectiveDate: string }

/** `waiveClearance` is always `false` this phase (Global Constraints). `idempotencyKey`:
 * the caller generates one per dialog-open and resends it on retry. */
export async function withdrawStudent(id: string, input: WithdrawStudentInput, idempotencyKey: string): Promise<StudentRecord> {
  const { data } = await apiClient.post<StudentRecord>(
    endpoints.students.withdraw(id),
    { reason: input.reason, effective_date: input.effectiveDate, waive_clearance: false },
    { idempotencyKey },
  );
  return data;
}
```

`index.ts`:

```ts
import { createStudent, fetchStudentById, fetchStudentsPage, updateStudent, withdrawStudent } from "./students-service";

export const StudentsService = { fetchStudentsPage, fetchStudentById, createStudent, updateStudent, withdrawStudent };
export type { CreateStudentInput, StudentRecord, StudentsPageQuery, UpdateStudentInput, WithdrawStudentInput } from "./students-service";
```

- [ ] **Step 6: Register both services and re-export `StudentRecord` from `@/services`**

```ts
import { SchoolOrganizationService } from "./modules/school-organization";
import { StudentsService } from "./modules/students";

export type { StudentRecord } from "./modules/students";

export const Services = {
  auth: AuthService, tenant: TenantService, dashboard: DashboardService, files: FilesService,
  jobs: JobsService, staff: StaffService, schoolOrganization: SchoolOrganizationService, students: StudentsService,
} as const;
```

Update `services/__tests__/index.test.ts`'s exact-keys assertion to include `"schoolOrganization"` and `"students"`, and add a `typeof Services.students.<action>` check per new action, matching the file's existing per-action pattern (`:42-58`).

- [ ] **Step 7: Write `student-row.ts`**

```ts
import { stableSignedUrl } from "@/lib/helpers";
import type { StudentRecord } from "@/services";

export interface StudentRow {
  id: string;
  admissionNumber: string;
  name: string;
  status: string;
  campus: string;
  house: string | null;
  admissionDate: string;
  updatedAt: string;
  /** Already resolved through `stableSignedUrl` and normalized to `undefined` (not
   * `null`) once here, so every consumer can pass it straight to `AvatarImage src`
   * without repeating the null-check. */
  signedPhotoUrl: string | undefined;
}

export function toStudentRow(record: StudentRecord): StudentRow {
  return {
    id: record.id,
    // The generated schema types this optional (admission_number can, in principle, be
    // unset between a PATCH request and the server allocating one) — the API never
    // actually returns a student without one, but `?? ""` keeps the row's own type honest.
    admissionNumber: record.admission_number ?? "",
    name: [record.first_name, record.last_name].join(" "),
    status: record.status,
    campus: record.campus_name,
    house: record.house_name,
    admissionDate: record.admission_date,
    updatedAt: record.updated_at,
    signedPhotoUrl: stableSignedUrl(record.photo_url) ?? undefined,
  };
}
```

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/services apps/dashboard/src/features/students/student-row.ts
git commit -m "feat(dashboard): add Services.students and Services.schoolOrganization.fetchHouses"
```

- [ ] **Step 9: Push and read CI**

---

## Task 4: i18n — fill the gaps in the existing `students.*` namespace

**Files:**
- Modify: `apps/dashboard/messages/en.json`, `apps/dashboard/messages/ur.json`

- [ ] **Step 1: Add to `en.json`'s `students` object**

In `filters`: `"campus": "Campus", "house": "House"`. `students.filters.search` **already exists** ("Search") — reuse it as-is for the search input's `aria-label`, don't redefine it. In `actions`: `"withdraw": "Withdraw"` (only this one — `actions.edit` is deliberately not added; every "Edit" label in this module reuses `common.edit`, matching `/staff`'s own convention of not duplicating a generic verb per module).

New top-level objects:

```json
  "stats": { "total": "Total students", "active": "Active", "unavailable": "—" },
  "detail": {
    "title": "{name} — student details", "titleFallback": "Student details",
    "personal": "Personal", "academic": "Academic", "medical": "Medical",
    "loadError": "Couldn't load this student's details.", "lastUpdated": "Last updated {when}"
  },
  "address": { "line1": "Address line 1", "line2": "Address line 2", "city": "City", "state": "State/Province", "postalCode": "Postal code", "country": "Country" },
  "withdraw": {
    "title": "Withdraw {name}", "titleBulk": "Withdraw {count} students", "confirm": "Withdraw",
    "description": "Ends the student's current enrollment and marks them withdrawn. This cannot be undone from here.",
    "fields": { "reason": "Reason", "effectiveDate": "Effective date" },
    "confirmBulk": "Withdraw {count}", "submitting": "Withdrawing", "submitFailed": "Withdrawal failed.",
    "partialFailureTitle": "{succeeded} withdrawn, {failed} failed", "retry": "Retry failed"
  },
```

(`detail` has no `close` key — the sheet's close button reuses `common.close`, not a students-scoped duplicate; `withdraw.confirm` is new, confirmed not to already exist anywhere under this path.)

In `form`, alongside existing keys: `"submitFailed": "Something went wrong. Please try again.", "createdToast": "Student added.", "updatedToast": "Student updated."` — **no `loading` key**: every loading placeholder in this module's dialogs (`isDetailLoading`'s message, the campus/house `<Select>` placeholders) reuses `common.loading`, not a students-scoped duplicate. Reuse `common.cancel`/`common.save`/`common.edit`/`common.close`/`common.loading` throughout — do not add `students.form.cancel`/`.save`/`.close`/`.loading` or `students.actions.edit` as near-duplicates of them. **`common.close` does not currently exist in `en.json`/`ur.json`** — add it now: `"close": "Close"` in `en.json`'s `common` object, with the matching Urdu translation, since Task 5, 6 and 7's dialogs all reference `tCommon("close")`.

In `fields`: `"selectGender": "Select gender", "selectHouse": "Select a house", "photo": "Photo"`.

In `list`: `"forbidden": "You don't have permission to view students.", "noMatches": "No students match these filters."` (reuse `students.idCards.selectAll`/`.selectRow` for the table's select-all/select-row `aria-label`s — do not add `students.list.selectAll`/`.selectRow` as near-duplicates of them).

- [ ] **Step 2: Add the matching Urdu translations to `ur.json`**, matching the existing `students` block's register. No English placeholders.

- [ ] **Step 3: Verify via CI's typecheck** (`messages.types-check.ts`).

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/messages/en.json apps/dashboard/messages/ur.json
git commit -m "feat(dashboard): add students detail/withdraw/stats i18n keys"
```

---

## Task 5: `student-form-schema.ts`, `student-address-fields.tsx`, `student-form-dialog.tsx`

Split into three files — the combined form (20 profile fields + 6 address fields, the zod schema, and the create/edit mapping logic) would exceed the 400-line `max-lines` ceiling with no suppression available for a new file (Global Constraints).

**Files:**
- Create: `apps/dashboard/src/features/students/student-form-schema.ts`
- Create: `apps/dashboard/src/features/students/student-address-fields.tsx`
- Create: `apps/dashboard/src/features/students/student-form-dialog.tsx`
- Create: `apps/dashboard/src/features/students/__tests__/student-form-dialog.test.tsx`

**Interfaces:**
- Consumes: `Services.students.{fetchStudentById,createStudent,updateStudent}`, `Services.dashboard.fetchCampuses`, `Services.schoolOrganization.fetchHouses` (Task 3), `GENDER_VALUES` (Task 2).
- Produces: `StudentFormDialog({ open, onOpenChange, mode, studentId? })`, `studentFormSchema`, `buildStudentInput`, `detailToFormValues`, `StudentAddressFields`. Consumed by Task 8.

- [ ] **Step 1: Write `student-form-schema.ts`**

```ts
import { z } from "zod";
import { GENDER_VALUES } from "@schoolhub/types";
import type { StudentRecord } from "@/services";

export const UNSET_VALUE = "unset";

/** Field names are snake_case, matching the API's own — `error.fieldErrors()` keys map
 * onto these with no re-mapping step. Required fields match `REQUIRED_IMPORT_COLUMNS`
 * (`apps/api/apps/student_management/services.py`). */
export const studentFormSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  preferred_name: z.string().optional(),
  date_of_birth: z.string().min(1),
  gender: z.enum(GENDER_VALUES),
  photo_file_id: z.string().optional(),
  campus_id: z.string().min(1),
  house_id: z.string().optional(),
  admission_date: z.string().min(1),
  blood_group: z.string().optional(),
  nationality: z.string().optional(),
  religion: z.string().optional(),
  previous_school: z.string().optional(),
  medical_notes: z.string().optional(),
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  address_city: z.string().optional(),
  address_state: z.string().optional(),
  address_postal_code: z.string().optional(),
  address_country: z.string().optional(),
});

export type StudentFormValues = z.infer<typeof studentFormSchema>;

export const EMPTY_DEFAULTS: StudentFormValues = {
  first_name: "", last_name: "", preferred_name: "", date_of_birth: "", gender: "unspecified",
  photo_file_id: "", campus_id: "", house_id: UNSET_VALUE, admission_date: "", blood_group: "",
  nationality: "", religion: "", previous_school: "", medical_notes: "",
  address_line1: "", address_line2: "", address_city: "", address_state: "", address_postal_code: "", address_country: "",
};

export function detailToFormValues(record: StudentRecord): StudentFormValues {
  const address = (record.address ?? {}) as Record<string, string | undefined>;
  return {
    first_name: record.first_name, last_name: record.last_name, preferred_name: record.preferred_name ?? "",
    date_of_birth: record.date_of_birth, gender: record.gender, photo_file_id: record.photo_file_id ?? "",
    campus_id: record.campus_id, house_id: record.house_id ?? UNSET_VALUE, admission_date: record.admission_date,
    blood_group: record.blood_group ?? "", nationality: record.nationality ?? "", religion: record.religion ?? "",
    previous_school: record.previous_school ?? "", medical_notes: record.medical_notes ?? "",
    address_line1: address.line1 ?? "", address_line2: address.line2 ?? "", address_city: address.city ?? "",
    address_state: address.state ?? "", address_postal_code: address.postal_code ?? "", address_country: address.country ?? "",
  };
}

/**
 * Drops every blank address sub-field and sends `undefined` (not an object of empty
 * strings) when none are filled — mirrors `staff-form-dialog.tsx`'s own `buildAddress`
 * exactly, including the same bug it avoids: a naive "always send the address object"
 * would store `{"line1":"",...}` for every student saved with no address at all.
 */
function buildAddress(values: StudentFormValues): Record<string, unknown> | undefined {
  const entries = Object.entries({
    line1: values.address_line1, line2: values.address_line2, city: values.address_city,
    state: values.address_state, postal_code: values.address_postal_code, country: values.address_country,
  }).filter(([, value]) => typeof value === "string" && value.trim() !== "");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * `mode` decides clearing semantics: on create, an empty optional field is omitted
 * (nothing to clear); on edit, an emptied field sends `null` — uniformly, for every
 * clearable field including text ones, even though the model also accepts `""` for
 * those (`null=True, blank=True`) — `null` avoids a mixed NULL/"" representation for
 * the same "empty" fact across rows created different ways. `address` is recomputed
 * from the form's current values on every submit rather than dirty-tracked — simpler,
 * and consistent with every other field here, none of which are dirty-tracked either;
 * an edit that leaves the address untouched just resends its own unchanged values,
 * which is a harmless no-op PATCH, not a bug (an earlier draft tried to dirty-track
 * only the address block and got it wrong — the tracking flag was never set true,
 * silently dropping every real address edit; removing the special-case fixed it).
 */
export function buildStudentInput(values: StudentFormValues, mode: "create" | "edit") {
  const clearable = (value: string) => (mode === "edit" ? value || null : value || undefined);
  return {
    firstName: values.first_name,
    lastName: values.last_name,
    dateOfBirth: values.date_of_birth,
    gender: values.gender,
    campusId: values.campus_id,
    admissionDate: values.admission_date,
    preferredName: clearable(values.preferred_name ?? ""),
    houseId: values.house_id === UNSET_VALUE || !values.house_id ? (mode === "edit" ? null : undefined) : values.house_id,
    photoFileId: clearable(values.photo_file_id ?? "") || undefined,
    bloodGroup: clearable(values.blood_group ?? ""),
    nationality: clearable(values.nationality ?? ""),
    religion: clearable(values.religion ?? ""),
    previousSchool: clearable(values.previous_school ?? ""),
    medicalNotes: clearable(values.medical_notes ?? ""),
    // On edit, an address emptied down to nothing must clear the stored column, not
    // silently leave it as-is: `buildAddress` returning `undefined` means "send
    // nothing" everywhere else in this function, but here specifically it must mean
    // "send null" once every sub-field is blank (round-4 review finding: the field is
    // nullable, `updateStudent` drops an `undefined` value, so a fully-cleared address
    // would otherwise never reach the server).
    address: mode === "edit" ? (buildAddress(values) ?? null) : buildAddress(values),
  };
}
```

- [ ] **Step 2: Write `student-address-fields.tsx`**

```tsx
"use client";

import { useTranslations } from "next-intl";
import { FormControl, FormField, FormItem, FormLabel, Input } from "@schoolhub/ui";
import type { UseFormReturn } from "react-hook-form"; // a direct dependency (apps/dashboard/package.json) — not re-exported by @schoolhub/ui
import type { StudentFormValues } from "./student-form-schema";

export function StudentAddressFields({ form }: { form: UseFormReturn<StudentFormValues> }) {
  const t = useTranslations("students");
  const fields = [
    ["address_line1", "line1"], ["address_line2", "line2"], ["address_city", "city"],
    ["address_state", "state"], ["address_postal_code", "postalCode"], ["address_country", "country"],
  ] as const;
  return (
    <>
      {fields.map(([name, labelKey]) => (
        <FormField key={name} control={form.control} name={name} render={({ field }) => (
          <FormItem><FormLabel>{t(`address.${labelKey}`)}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
        )} />
      ))}
    </>
  );
}
```

(Confirm `UseFormReturn` is exported from `@schoolhub/ui` or import it from `react-hook-form` directly if not — `packages/ui` re-exports form primitives but not necessarily RHF's own types.)

- [ ] **Step 3: Write the failing tests for `student-form-dialog.tsx`**

```tsx
it("surfaces the server's duplicate-admission message via its non_field detail", async () => {
  mockCreateStudent.mockRejectedValue(new ApiError({
    code: "domain_rule_violation", message: "Validation failed.", status: 422, url: "/students",
    details: [{ field: "non_field", issue: "A student named 'Ali Khan' with the same date of birth already exists (admission number 2026-0007). Pass an override reason to create anyway." }],
  }));
  renderWithProviders(<StudentFormDialog open mode="create" onOpenChange={onOpenChange} />);
  await fillRequiredCreateFields(userEvent.setup());
  await userEvent.setup().click(screen.getByRole("button", { name: /new student/i }));
  expect(await screen.findByText(/A student named 'Ali Khan'.*already exists.*Pass an override reason/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /override/i })).not.toBeInTheDocument();
});

it("discards a photo upload from a session that already closed, even if the dialog reopened before it resolved", async () => {
  // Deliberately not `renderWithProviders` — reproducing "closed then reopened before
  // the upload settled" needs the SAME component instance across the open/close/open
  // prop changes, not a fresh mount each time. Mirrors staff-form-dialog.test.tsx's own
  // "reopening after closing" regression test, which documents exactly this need — but
  // unlike staff's version, this component calls `useTranslations`, so the local wrapper
  // needs `NextIntlClientProvider` too (round-3 review finding: a `QueryClientProvider`
  // alone made the first render throw before the test reached any assertion).
  let resolveUpload: (url: string) => void = () => {};
  mockUploadFile.mockReturnValue(new Promise((resolve) => { resolveUpload = resolve; }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </NextIntlClientProvider>
    );
  }
  const { rerender } = render(<StudentFormDialog open mode="create" onOpenChange={onOpenChange} />, { wrapper: Wrapper });
  await userEvent.setup().upload(screen.getByLabelText(/photo/i), new File(["x"], "photo.jpg", { type: "image/jpeg" }));
  rerender(<StudentFormDialog open={false} mode="create" onOpenChange={onOpenChange} />);
  rerender(<StudentFormDialog open mode="create" onOpenChange={onOpenChange} />); // reopened before the upload resolved
  resolveUpload("file-123");
  await waitFor(() => {}); // flush the upload's now-stale .then continuation before proceeding
  await fillRequiredCreateFields(userEvent.setup());
  await userEvent.setup().click(screen.getByRole("button", { name: /new student/i }));
  await waitFor(() => expect(mockCreateStudent).toHaveBeenCalled());
  expect(mockCreateStudent).toHaveBeenCalledWith(expect.not.objectContaining({ photoFileId: expect.anything() }));
});
```

(This test's file needs `import { NextIntlClientProvider } from "next-intl";`, `import enMessages from "../../../../messages/en.json";` — matching `test-utils.tsx`'s own relative depth to `messages/en.json` from wherever this test file actually lands — and `waitFor` from `@testing-library/react`, none of which the other tests in this file need since they all use `renderWithProviders`.)

```tsx
it("clears a house on edit by sending null, not omitting the field", async () => {
  mockFetchStudentById.mockResolvedValue(studentDetail({ house_id: "h1", house_name: "Griffin" }));
  renderWithProviders(<StudentFormDialog open mode="edit" studentId="s1" onOpenChange={onOpenChange} />);
  await screen.findByDisplayValue(/griffin/i);
  await userEvent.setup().click(screen.getByRole("combobox", { name: /house/i }));
  await userEvent.setup().click(screen.getByRole("option", { name: /none/i }));
  await userEvent.setup().click(screen.getByRole("button", { name: /save/i }));
  expect(mockUpdateStudent).toHaveBeenCalledWith("s1", expect.objectContaining({ houseId: null }));
});
```

- [ ] **Step 4: Confirm the tests fail by construction, then implement `student-form-dialog.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Alert, Button, Form, FormControl, FormField, FormItem, FormLabel, FormMessage, Input, Label,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@schoolhub/ui";
import { GENDER_VALUES } from "@schoolhub/types";

import {
  ResponsiveDialog, ResponsiveDialogBody, ResponsiveDialogContent, ResponsiveDialogFooter,
  ResponsiveDialogHeader, ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useIsDesktopShell } from "@/hooks/use-is-desktop-shell";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { ApiError, Services } from "@/services";
import { buildStudentInput, detailToFormValues, EMPTY_DEFAULTS, studentFormSchema, UNSET_VALUE, type StudentFormValues } from "./student-form-schema";
import { StudentAddressFields } from "./student-address-fields";

export interface StudentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  studentId?: string;
}

export function StudentFormDialog({ open, onOpenChange, mode, studentId }: StudentFormDialogProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const isMobile = !useIsDesktopShell();
  const { data: currentUser } = useCurrentUser();

  // An "open session" counter, not a boolean: a boolean can't distinguish "still this
  // same open session" from "closed and reopened before the upload settled" — Review
  // Focus #5. Every open (including a reopen) bumps this; the upload handler captures
  // its own session number *and* studentId as closures and compares both at resolve
  // time. Both refs are written only inside this effect, never during render — writing
  // a ref during render trips the `react-hooks/refs` lint rule (round-3 review finding:
  // an earlier draft wrote `studentIdRef.current = studentId` directly in the function
  // body).
  const sessionRef = useRef(0);
  const openSessionRef = useRef(0);
  const studentIdRef = useRef(studentId);
  useEffect(() => {
    studentIdRef.current = studentId;
    if (open) { sessionRef.current += 1; openSessionRef.current = sessionRef.current; }
    else { openSessionRef.current = 0; }
  }, [open, studentId]);

  const [formError, setFormError] = useState<string | null>(null);
  const [populatedStudentId, setPopulatedStudentId] = useState<string | null>(null);

  const form = useForm<StudentFormValues>({ resolver: zodResolver(studentFormSchema), defaultValues: EMPTY_DEFAULTS });

  const campusesQuery = useQuery({ queryKey: queryKeys.list("school-organization", "campuses"), queryFn: () => Services.dashboard.fetchCampuses(), enabled: open });
  const housesQuery = useQuery({ queryKey: queryKeys.list("school-organization", "houses"), queryFn: () => Services.schoolOrganization.fetchHouses(), enabled: open });
  const detailQuery = useQuery({
    queryKey: queryKeys.detail("students", "students", studentId ?? ""),
    queryFn: () => Services.students.fetchStudentById(studentId as string),
    enabled: mode === "edit" && open && !!studentId,
  });

  // Radix's `Select` mirrors its value into a hidden native `<select>` and, if that
  // value changes before the matching `<option>` has registered (true for every select
  // on the render right after mount), silently blanks itself — so Campus/House must not
  // mount until the reset below has already run once. Mirrors staff-form-dialog.tsx's
  // identical `isDetailLoading` gate exactly, for the identical reason.
  const isDetailLoading = mode === "edit" && (detailQuery.isPending || (detailQuery.data !== undefined && populatedStudentId !== studentId));

  useEffect(() => {
    if (open && mode === "edit" && detailQuery.data) {
      form.reset(detailToFormValues(detailQuery.data));
      setPopulatedStudentId(detailQuery.data.id);
    }
  }, [open, mode, detailQuery.data, form]);

  useEffect(() => {
    if (!open) { form.reset(EMPTY_DEFAULTS); setFormError(null); setPopulatedStudentId(null); }
  }, [open, form]);

  const mutation = useMutation({
    mutationFn: (values: StudentFormValues) =>
      mode === "create"
        ? Services.students.createStudent(buildStudentInput(values, "create"))
        : Services.students.updateStudent(studentId as string, buildStudentInput(values, "edit")),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("students") });
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("dashboard") });
      onOpenChange(false);
      toast.success(mode === "create" ? t("form.createdToast") : t("form.updatedToast"));
    },
    onError: (error) => {
      setFormError(null);
      if (error instanceof ApiError) {
        let matchedAField = false;
        for (const [field, issue] of Object.entries(error.fieldErrors())) {
          if (field !== "non_field" && field in studentFormSchema.shape) {
            form.setError(field as keyof StudentFormValues, { type: "server", message: issue });
            matchedAField = true;
          }
        }
        if (!matchedAField) setFormError(resolveErrorMessage(error, tErrors, t("form.submitFailed"), "non_field"));
      } else {
        setFormError(t("form.submitFailed"));
      }
    },
  });

  async function handlePhotoUpload(file: File) {
    const uploadSession = openSessionRef.current;
    const uploadedStudentId = studentIdRef.current;
    const fileId = await Services.files.uploadFile(file, "student.photo");
    if (openSessionRef.current !== uploadSession || studentIdRef.current !== uploadedStudentId) return;
    form.setValue("photo_file_id", fileId);
  }

  function onSubmit(event: React.FormEvent) {
    form.handleSubmit((values) => mutation.mutate(values))(event).catch(console.error);
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-2xl" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{mode === "create" ? t("form.createTitle") : t("form.editTitle")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {isDetailLoading ? (
          <ResponsiveDialogBody><p className="text-muted-foreground text-sm">{tCommon("loading")}</p></ResponsiveDialogBody>
        ) : (
          <Form {...form}>
            <form noValidate onSubmit={onSubmit} className={isMobile ? "flex min-h-0 grow flex-col" : undefined}>
              {/* Desktop bounds the body with its own max-height/scrollbar; the mobile
                  drawer instead relies on its own max-h-[85vh] plus the form's flex
                  chain above, so it must not get a second, competing max-height. */}
              <ResponsiveDialogBody className={isMobile ? "space-y-4 overflow-y-auto" : "max-h-[65vh] space-y-4 overflow-y-auto pe-1"}>
                {formError && <Alert variant="destructive">{formError}</Alert>}
                <FormField control={form.control} name="first_name" render={({ field }) => (
                  <FormItem><FormLabel>{t("fields.firstName")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="last_name" render={({ field }) => (
                  <FormItem><FormLabel>{t("fields.lastName")}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="date_of_birth" render={({ field }) => (
                  <FormItem><FormLabel>{t("fields.dateOfBirth")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="gender" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.gender")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue placeholder={t("fields.selectGender")} /></SelectTrigger></FormControl>
                      <SelectContent>{GENDER_VALUES.map((g) => <SelectItem key={g} value={g}>{t(`gender.${g}`)}</SelectItem>)}</SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="campus_id" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.campus")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue placeholder={campusesQuery.isPending ? tCommon("loading") : t("fields.selectCampus")} /></SelectTrigger></FormControl>
                      <SelectContent>{(campusesQuery.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="house_id" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.house")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue placeholder={housesQuery.isPending ? tCommon("loading") : t("fields.selectHouse")} /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value={UNSET_VALUE}>{t("fields.none")}</SelectItem>
                        {(housesQuery.data ?? []).map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="admission_date" render={({ field }) => (
                  <FormItem><FormLabel>{t("fields.admissionDate")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="space-y-1">
                  <Label>{t("fields.photo")}</Label>
                  <Input type="file" accept="image/jpeg,image/png" aria-label={t("fields.photo")}
                    onChange={(e) => { const file = e.target.files?.[0]; if (file) handlePhotoUpload(file).catch(() => setFormError(t("form.submitFailed"))); }} />
                </div>
                <FormField control={form.control} name="blood_group" render={({ field }) => (
                  <FormItem><FormLabel>{t("fields.bloodGroup")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="nationality" render={({ field }) => (
                  <FormItem><FormLabel>{t("fields.nationality")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="religion" render={({ field }) => (
                  <FormItem><FormLabel>{t("fields.religion")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="previous_school" render={({ field }) => (
                  <FormItem><FormLabel>{t("fields.previousSchool")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                )} />
                {hasPermission(currentUser, "students.student.update") && (
                  <FormField control={form.control} name="medical_notes" render={({ field }) => (
                    <FormItem><FormLabel>{t("fields.medicalNotes")}</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                  )} />
                )}
                <StudentAddressFields form={form} />
              </ResponsiveDialogBody>
              <ResponsiveDialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tCommon("cancel")}</Button>
                <Button type="submit" isLoading={mutation.isPending} loadingLabel={t("form.submitting")}>
                  {mode === "create" ? t("actions.create") : tCommon("save")}
                </Button>
              </ResponsiveDialogFooter>
            </form>
          </Form>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
```

The dialog body needs the same scroll-bounding staff's own form uses, or the Save button sits off-screen below the viewport on desktop (confirmed against `packages/ui/src/components/dialog.tsx:10-14,129-130`: `DialogContent` has no max-height/overflow of its own, and this form's ~20 profile fields plus 6 address fields are well over the 720px height Playwright's `dashboard` project runs at). Give `ResponsiveDialogContent` a `className="max-w-2xl"`, and the `<form>` element itself `className={isMobile ? "flex min-h-0 grow flex-col" : undefined}` (for the mobile drawer's flex chain) — then give `ResponsiveDialogBody` `className={isMobile ? "space-y-4 overflow-y-auto" : "max-h-[65vh] space-y-4 overflow-y-auto pe-1"}`, copying `staff-form-dialog.tsx:538-543`'s exact split verbatim (desktop bounds the body independently with its own scrollbar; mobile relies on the drawer's own `max-h-[85vh]` and the form's flex chain instead, so it does not get a second, competing max-height).

- [ ] **Step 5: Confirm the tests pass by construction**

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/features/students/student-form-schema.ts apps/dashboard/src/features/students/student-address-fields.tsx apps/dashboard/src/features/students/student-form-dialog.tsx apps/dashboard/src/features/students/__tests__/student-form-dialog.test.tsx apps/dashboard/messages/en.json apps/dashboard/messages/ur.json
git commit -m "feat(dashboard): add the student create/edit form dialog"
```

- [ ] **Step 7: Push and read CI**

---

## Task 6: `student-detail-sheet.tsx`

**Files:**
- Create: `apps/dashboard/src/features/students/student-detail-sheet.tsx`
- Create: `apps/dashboard/src/features/students/__tests__/student-detail-sheet.test.tsx`

**Interfaces:**
- Consumes: `StudentRow` (Task 3), `Services.students.fetchStudentById`.
- Produces: `StudentDetailSheet({ row, canUpdate, canWithdraw, onOpenChange, onEdit, onWithdraw })`. Consumed by Task 8.

- [ ] **Step 1: Write the failing tests**

```tsx
it("shows Restricted only when medical_notes is genuinely absent from the response", async () => {
  const { medical_notes: _omit, ...withoutMedicalNotes } = studentDetail();
  mockFetchStudentById.mockResolvedValue(withoutMedicalNotes);
  renderWithProviders(<StudentDetailSheet row={studentRow()} canUpdate canWithdraw onOpenChange={jest.fn()} onEdit={jest.fn()} onWithdraw={jest.fn()} />);
  expect(await screen.findByText("Restricted")).toBeInTheDocument();
});

it("shows the fetched admission number from the detail response, not just the row's own", async () => {
  // Distinct values for the row (what opened the sheet) and the detail response (what
  // it fetches) — if this test used the same number for both, it would pass whether or
  // not the field row actually renders `data`, which is the one thing it's meant to
  // prove (round-3 review finding).
  mockFetchStudentById.mockResolvedValue(studentDetail({ admission_number: "2026-0099" }));
  renderWithProviders(<StudentDetailSheet row={studentRow({ admissionNumber: "2026-0001" })} canUpdate canWithdraw onOpenChange={jest.fn()} onEdit={jest.fn()} onWithdraw={jest.fn()} />);
  expect(await screen.findByText("2026-0099")).toBeInTheDocument();
});

it("shows a real medical_notes value as itself, not as Restricted, when the key is present but falsy-looking", async () => {
  mockFetchStudentById.mockResolvedValue(studentDetail({ medical_notes: "No known allergies." }));
  renderWithProviders(<StudentDetailSheet row={studentRow()} canUpdate canWithdraw onOpenChange={jest.fn()} onEdit={jest.fn()} onWithdraw={jest.fn()} />);
  expect(await screen.findByText("No known allergies.")).toBeInTheDocument();
  expect(screen.queryByText("Restricted")).not.toBeInTheDocument();
});

it("shows an em dash, not Restricted, when medical_notes is present and genuinely null (a viewer who CAN see it, but there's simply nothing on file)", async () => {
  // Distinct from the "genuinely absent" test above: `null` means the key survived
  // `to_representation` (the viewer has visibility) but the student has no notes,
  // which must read differently from "you can't see this" — an implementation that
  // uses `??`/truthiness instead of the `"medical_notes" in data` check would show
  // "Restricted" here too, incorrectly (round-4 review finding).
  mockFetchStudentById.mockResolvedValue(studentDetail({ medical_notes: null }));
  renderWithProviders(<StudentDetailSheet row={studentRow()} canUpdate canWithdraw onOpenChange={jest.fn()} onEdit={jest.fn()} onWithdraw={jest.fn()} />);
  await screen.findByText(studentRow().admissionNumber);
  expect(screen.queryByText("Restricted")).not.toBeInTheDocument();
  expect(screen.getByText("—")).toBeInTheDocument();
});

it("hides the Withdraw action for a non-active student even when canWithdraw is true", async () => {
  mockFetchStudentById.mockResolvedValue(studentDetail({ status: "graduated" }));
  renderWithProviders(<StudentDetailSheet row={studentRow({ status: "graduated" })} canUpdate canWithdraw onOpenChange={jest.fn()} onEdit={jest.fn()} onWithdraw={jest.fn()} />);
  await screen.findByText(/graduated/i);
  expect(screen.queryByRole("button", { name: /withdraw/i })).not.toBeInTheDocument();
});

it("shows the Withdraw action for an active student when canWithdraw is true (positive control)", async () => {
  mockFetchStudentById.mockResolvedValue(studentDetail({ status: "active" }));
  renderWithProviders(<StudentDetailSheet row={studentRow({ status: "active" })} canUpdate canWithdraw onOpenChange={jest.fn()} onEdit={jest.fn()} onWithdraw={jest.fn()} />);
  await screen.findByText(/active/i);
  expect(screen.getByRole("button", { name: /withdraw/i })).toBeInTheDocument();
});

it("hides Edit when canUpdate is false", async () => {
  mockFetchStudentById.mockResolvedValue(studentDetail());
  renderWithProviders(<StudentDetailSheet row={studentRow()} canUpdate={false} canWithdraw={false} onOpenChange={jest.fn()} onEdit={jest.fn()} onWithdraw={jest.fn()} />);
  await screen.findByText(studentRow().admissionNumber);
  expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Confirm the tests fail by construction, then implement**

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Pencil, UserMinus } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage, Badge, Button, Skeleton } from "@schoolhub/ui";

import { ResponsiveSheet, ResponsiveSheetBody, ResponsiveSheetContent, ResponsiveSheetFooter, ResponsiveSheetTitle, useIsDrawer } from "@/components/responsive-dialog";
import { getInitials } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import type { StudentRow } from "./student-row";

export interface StudentDetailSheetProps {
  row: StudentRow | null;
  canUpdate: boolean;
  canWithdraw: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (id: string) => void;
  onWithdraw: (id: string, name: string) => void;
}

function FieldRow({ label, value, isPending }: { label: string; value?: string | null; isPending: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-muted-foreground text-sm">{label}</span>
      {isPending ? <Skeleton className="h-4 w-24" /> : <span className="text-sm">{value || "—"}</span>}
    </div>
  );
}

export function StudentDetailSheet({ row, canUpdate, canWithdraw, onOpenChange, onEdit, onWithdraw }: StudentDetailSheetProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");

  const detailQuery = useQuery({
    queryKey: queryKeys.detail("students", "students", row?.id ?? ""),
    queryFn: () => Services.students.fetchStudentById(row?.id as string),
    enabled: row !== null,
  });
  const data = detailQuery.data;
  const hasMedicalNotesField = data !== undefined && "medical_notes" in data;

  return (
    <ResponsiveSheet open={row !== null} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent closeLabel={tCommon("close")}>
        <ResponsiveSheetTitle className="sr-only">{row ? t("detail.title", { name: row.name }) : t("detail.titleFallback")}</ResponsiveSheetTitle>
        {row && (
          <>
            <div className="flex items-center gap-3 px-4 pt-4">
              <Avatar className="size-12">
                <AvatarImage src={row.signedPhotoUrl} alt="" />
                <AvatarFallback>{getInitials(row.name)}</AvatarFallback>
              </Avatar>
              <div>
                <div className="font-medium">{row.name}</div>
                <div className="text-muted-foreground text-xs">{row.admissionNumber}</div>
                <Badge appearance="light">{t(`status.${row.status}`)}</Badge>
              </div>
            </div>
            <ResponsiveSheetBody>
              {detailQuery.isError ? (
                <p className="text-muted-foreground text-sm">{t("detail.loadError")}</p>
              ) : (
                <div className="space-y-1">
                  <h3 className="text-sm font-medium">{t("detail.personal")}</h3>
                  <FieldRow label={t("fields.admissionNumber")} value={data?.admission_number} isPending={detailQuery.isPending} />
                  <FieldRow label={t("fields.preferredName")} value={data?.preferred_name} isPending={detailQuery.isPending} />
                  <FieldRow label={t("fields.dateOfBirth")} value={data?.date_of_birth} isPending={detailQuery.isPending} />
                  <FieldRow label={t("fields.gender")} value={data ? t(`gender.${data.gender}`) : undefined} isPending={detailQuery.isPending} />
                  <FieldRow label={t("fields.nationality")} value={data?.nationality} isPending={detailQuery.isPending} />
                  <FieldRow label={t("fields.religion")} value={data?.religion} isPending={detailQuery.isPending} />
                  <h3 className="text-sm font-medium">{t("detail.academic")}</h3>
                  <FieldRow label={t("fields.campus")} value={data?.campus_name} isPending={detailQuery.isPending} />
                  <FieldRow label={t("fields.house")} value={data?.house_name} isPending={detailQuery.isPending} />
                  <FieldRow label={t("fields.admissionDate")} value={data?.admission_date} isPending={detailQuery.isPending} />
                  <FieldRow label={t("fields.previousSchool")} value={data?.previous_school} isPending={detailQuery.isPending} />
                  <h3 className="text-sm font-medium">{t("detail.medical")}</h3>
                  <FieldRow label={t("fields.bloodGroup")} value={data?.blood_group} isPending={detailQuery.isPending} />
                  <FieldRow label={t("fields.medicalNotes")} value={hasMedicalNotesField ? data?.medical_notes : t("fields.medicalNotesRestricted")} isPending={detailQuery.isPending} />
                  <p className="text-muted-foreground text-xs">{t("detail.lastUpdated", { when: data?.updated_at ?? "" })}</p>
                </div>
              )}
            </ResponsiveSheetBody>
            <DetailFooter row={row} canUpdate={canUpdate} canWithdraw={canWithdraw} onEdit={onEdit} onWithdraw={onWithdraw} />
          </>
        )}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

function DetailFooter({
  row, canUpdate, canWithdraw, onEdit, onWithdraw,
}: { row: StudentRow; canUpdate: boolean; canWithdraw: boolean; onEdit: (id: string) => void; onWithdraw: (id: string, name: string) => void }) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const isDrawer = useIsDrawer();
  const showWithdraw = canWithdraw && row.status === "active";

  return (
    <ResponsiveSheetFooter>
      {isDrawer ? (
        <>
          {canUpdate && <Button size="icon" variant="outline" aria-label={tCommon("edit")} onClick={() => onEdit(row.id)}><Pencil className="size-4" /></Button>}
          {showWithdraw && <Button size="icon" variant="destructive" aria-label={`${t("actions.withdraw")} ${row.name}`} onClick={() => onWithdraw(row.id, row.name)}><UserMinus className="size-4" /></Button>}
        </>
      ) : (
        <>
          {canUpdate && <Button variant="outline" onClick={() => onEdit(row.id)}>{tCommon("edit")}</Button>}
          {showWithdraw && <Button variant="destructive" onClick={() => onWithdraw(row.id, row.name)}>{t("actions.withdraw")}</Button>}
        </>
      )}
    </ResponsiveSheetFooter>
  );
}
```

- [ ] **Step 3: Confirm the tests pass by construction**

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/features/students/student-detail-sheet.tsx apps/dashboard/src/features/students/__tests__/student-detail-sheet.test.tsx
git commit -m "feat(dashboard): add the student detail sheet"
```

- [ ] **Step 5: Push and read CI**

---

## Task 7: `withdraw-student-dialog.tsx`

**Files:**
- Create: `apps/dashboard/src/features/students/withdraw-student-dialog.tsx`
- Create: `apps/dashboard/src/features/students/__tests__/withdraw-student-dialog.test.tsx`

**Interfaces:**
- Consumes: `Services.students.withdrawStudent` (Task 3).
- Produces: `WithdrawStudentDialog({ open, onOpenChange, studentIds, studentNames })`. Consumed by Task 8.

- [ ] **Step 1: Write the failing test**

```tsx
it("retries only the ids that failed on a partial bulk failure, showing why each one failed", async () => {
  const keysUsed: Record<string, string> = {};
  mockWithdrawStudent.mockImplementation((id, _input, key) => {
    keysUsed[id] = key;
    if (id === "s1") return Promise.resolve({ id: "s1", status: "withdrawn" });
    return Promise.reject(new ApiError({
      code: "domain_rule_violation", status: 422, url: "", message: "Validation failed.",
      details: [{ field: "non_field", issue: "Student is suspended, not active." }],
    }));
  });
  renderWithProviders(<WithdrawStudentDialog open onOpenChange={jest.fn()} studentIds={["s1", "s2"]} studentNames={["Ali", "Sara"]} />);
  await fillReason(userEvent.setup());
  await userEvent.setup().click(screen.getByRole("button", { name: /withdraw 2/i }));
  expect(await screen.findByText("1 withdrawn, 1 failed")).toBeInTheDocument();
  expect(screen.getByText(/Sara.*Student is suspended, not active\./i)).toBeInTheDocument();

  const s2Key = keysUsed["s2"];
  mockWithdrawStudent.mockReset();
  mockWithdrawStudent.mockResolvedValueOnce({ id: "s2", status: "withdrawn" });
  await userEvent.setup().click(screen.getByRole("button", { name: /retry failed/i }));
  expect(mockWithdrawStudent).toHaveBeenCalledTimes(1);
  expect(mockWithdrawStudent).toHaveBeenCalledWith("s2", expect.anything(), s2Key);
});
```

- [ ] **Step 2: Confirm it fails by construction, then implement**

```tsx
"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { z } from "zod";
import {
  Alert, AlertDescription, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button, Drawer,
  DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, Form, FormControl,
  FormField, FormItem, FormLabel, FormMessage, Input, Textarea,
} from "@schoolhub/ui";

import { useIsDesktopShell } from "@/hooks/use-is-desktop-shell";
import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";

export interface WithdrawStudentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentIds: string[];
  studentNames: string[];
}

const withdrawFormSchema = z.object({ reason: z.string().min(1), effective_date: z.string().min(1) });
type WithdrawFormValues = z.infer<typeof withdrawFormSchema>;

interface PerStudentFailure { id: string; name: string; message: string }

export function WithdrawStudentDialog({ open, onOpenChange, studentIds, studentNames }: WithdrawStudentDialogProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktopShell();

  const [idsToSubmit, setIdsToSubmit] = useState(studentIds.map((id, i) => ({ id, name: studentNames[i] ?? "" })));
  const [result, setResult] = useState<{ succeeded: number; failed: PerStudentFailure[] } | null>(null);
  const keysRef = useRef(new Map<string, string>());
  function keyFor(id: string): string {
    if (!keysRef.current.has(id)) keysRef.current.set(id, crypto.randomUUID());
    return keysRef.current.get(id) as string;
  }

  const form = useForm<WithdrawFormValues>({ resolver: zodResolver(withdrawFormSchema), defaultValues: { reason: "", effective_date: "" } });

  const mutation = useMutation({
    mutationFn: async (values: WithdrawFormValues) => {
      const targets = idsToSubmit;
      // Each promise resolves to its own outcome carrying its own {id, name} — never
      // rejects — so pairing a result back to its student never needs an array index
      // (`noUncheckedIndexedAccess` makes `outcomes[i]` a real compile error here, not
      // just a style nit: `targets`/`outcomes` are two separately-typed arrays the
      // compiler has no way to know stay in lockstep).
      const outcomes = await Promise.all(
        targets.map(async ({ id, name }) => {
          try {
            await Services.students.withdrawStudent(id, { reason: values.reason, effectiveDate: values.effective_date }, keyFor(id));
            return { id, name, ok: true as const };
          } catch (error) {
            return { id, name, ok: false as const, message: resolveErrorMessage(error, tErrors, t("withdraw.submitFailed"), "non_field") };
          }
        }),
      );
      const failed: PerStudentFailure[] = outcomes.filter((o): o is typeof o & { ok: false } => !o.ok);
      return { succeeded: outcomes.length - failed.length, failed };
    },
    onSuccess: ({ succeeded, failed }) => {
      if (succeeded > 0) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.module("students") });
        void queryClient.invalidateQueries({ queryKey: queryKeys.module("dashboard") });
      }
      setResult({ succeeded, failed });
      setIdsToSubmit(failed.map((f) => ({ id: f.id, name: f.name })));
      if (failed.length === 0) onOpenChange(false);
    },
  });

  function handleSubmit(event: React.FormEvent) {
    form.handleSubmit((values) => mutation.mutate(values))(event).catch(console.error);
  }

  const title = idsToSubmit.length > 1 ? t("withdraw.titleBulk", { count: idsToSubmit.length }) : t("withdraw.title", { name: idsToSubmit[0]?.name ?? "" });
  const confirmLabel = idsToSubmit.length > 1 ? t("withdraw.confirmBulk", { count: idsToSubmit.length }) : t("withdraw.confirm");

  const body = (
    <Form {...form}>
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        {result && result.failed.length > 0 && (
          // `Alert`, not a plain `text-destructive-foreground` paragraph — that token
          // resolves to white in light mode (theme.css) and is unreadable on the
          // dialog's own background; `Alert`'s variant handles contrast correctly, the
          // same way exit-staff-dialog.tsx's identical partial-failure list does.
          <Alert variant={result.succeeded > 0 ? "warning" : "destructive"}>
            <AlertDescription>
              <p className="mb-1">{t("withdraw.partialFailureTitle", { succeeded: result.succeeded, failed: result.failed.length })}</p>
              <ul className="list-disc space-y-0.5 ps-4">{result.failed.map((f) => <li key={f.id}>{f.name} — {f.message}</li>)}</ul>
            </AlertDescription>
          </Alert>
        )}
        <FormField control={form.control} name="reason" render={({ field }) => (
          <FormItem><FormLabel>{t("withdraw.fields.reason")}</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="effective_date" render={({ field }) => (
          <FormItem><FormLabel>{t("withdraw.fields.effectiveDate")}</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
        )} />
      </form>
    </Form>
  );

  if (!isDesktop) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} dismissible={false}>
        <DrawerContent role="alertdialog" closeLabel={tCommon("close")}>
          <DrawerHeader><DrawerTitle>{title}</DrawerTitle><DrawerDescription>{t("withdraw.description")}</DrawerDescription></DrawerHeader>
          {body}
          <DrawerFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>{tCommon("cancel")}</Button>
            <Button variant="destructive" isLoading={mutation.isPending} loadingLabel={t("withdraw.submitting")} onClick={handleSubmit}>
              {result?.failed.length ? t("withdraw.retry") : confirmLabel}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{t("withdraw.description")}</AlertDialogDescription></AlertDialogHeader>
        {body}
        <AlertDialogFooter>
          <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={mutation.isPending} onClick={(event) => { event.preventDefault(); handleSubmit(event); }}>
            {result?.failed.length ? t("withdraw.retry") : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

(`DrawerContent`'s `closeLabel` prop — confirmed required, `packages/ui/src/components/drawer.tsx:113`; `dismissible={false}` stays on `Drawer` itself, matching `exit-staff-dialog.tsx`'s real split.)

- [ ] **Step 3: Confirm the tests pass by construction**

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/features/students/withdraw-student-dialog.tsx apps/dashboard/src/features/students/__tests__/withdraw-student-dialog.test.tsx
git commit -m "feat(dashboard): add the withdraw-student dialog with idempotent retry"
```

- [ ] **Step 5: Push and read CI**

---

## Task 8: `student-columns.tsx`, `student-directory-filters.tsx`, `student-toolbar.tsx`, `student-directory-table.tsx`

**Files:**
- Create: `apps/dashboard/src/features/students/student-columns.tsx`
- Create: `apps/dashboard/src/features/students/student-directory-filters.tsx`
- Create: `apps/dashboard/src/features/students/student-toolbar.tsx`
- Create: `apps/dashboard/src/features/students/student-directory-table.tsx`
- Create: `apps/dashboard/src/features/students/__tests__/{student-toolbar,student-directory-table}.test.tsx`

**Interfaces:**
- Consumes: `Services.students.fetchStudentsPage`, `Services.dashboard.fetchCampuses`, `Services.schoolOrganization.fetchHouses` (Task 3), `StudentRow`/`toStudentRow` (Task 3), `StudentFormDialog` (Task 5), `StudentDetailSheet` (Task 6), `WithdrawStudentDialog` (Task 7).
- Produces: `StudentToolbar()`, `StudentDirectoryTable()`.

- [ ] **Step 1: Write the failing test for the toolbar**

```tsx
jest.mock("next/navigation", () => ({ usePathname: () => "/students" }));
jest.mock("@/services", () => ({
  Services: {
    students: { fetchStudentsPage: jest.fn() },
    dashboard: { fetchCampuses: jest.fn().mockResolvedValue([]) },
    schoolOrganization: { fetchHouses: jest.fn().mockResolvedValue([]) },
  },
  ApiError: jest.requireActual("@schoolhub/api-client").ApiError,
}));
jest.mock("@/hooks/use-current-user", () => ({
  useCurrentUser: () => ({ data: { id: "u1", permissions: ["students.student.view", "students.student.create"] }, isError: false }),
}));

const mockFetchStudentsPage = Services.students.fetchStudentsPage as jest.MockedFunction<typeof Services.students.fetchStudentsPage>;

describe("StudentToolbar", () => {
  beforeEach(() => mockFetchStudentsPage.mockReset());

  it("shows the total and active counts as two distinct figures", async () => {
    mockFetchStudentsPage.mockImplementation((q) =>
      Promise.resolve({ items: [], pagination: { page: 1, page_size: 1, total_count: q.status === "active" ? 190 : 214, total_pages: 1 } }),
    );
    renderWithProviders(<StudentToolbar />);
    await waitFor(() => expect(screen.getByText("214")).toBeInTheDocument());
    expect(screen.getByText("190")).toBeInTheDocument();
  });

  it("opens the create-student dialog when New student is clicked", async () => {
    mockFetchStudentsPage.mockResolvedValue({ items: [], pagination: { page: 1, page_size: 1, total_count: 0, total_pages: 0 } });
    renderWithProviders(<StudentToolbar />);
    await userEvent.setup().click(await screen.findByRole("button", { name: /new student/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Confirm it fails by construction, then write `student-toolbar.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button, StatCard } from "@schoolhub/ui";
import { Plus } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { StudentFormDialog } from "./student-form-dialog";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";

export function StudentToolbar() {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const t = useTranslations("students");
  const tCommon = useTranslations("common");

  const totalQuery = useQuery({
    queryKey: queryKeys.list("students", "students", { statsAll: true }),
    queryFn: () => Services.students.fetchStudentsPage({ page: 1, pageSize: 1 }),
  });
  const activeQuery = useQuery({
    queryKey: queryKeys.list("students", "students", { statsActive: true }),
    queryFn: () => Services.students.fetchStudentsPage({ page: 1, pageSize: 1, status: "active" }),
  });

  const { data: currentUser, isError: isCurrentUserError } = useCurrentUser();
  const canCreate = hasPermission(currentUser, "students.student.create");
  const permissionsUnknownTitle = currentUser ? undefined : isCurrentUserError ? tCommon("permissionsLoadFailed") : tCommon("permissionsLoading");

  return (
    <>
      <Toolbar>
        <ToolbarHeading />
        <ToolbarActions>
          <StatCard label={t("stats.total")} value={totalQuery.data?.pagination?.total_count?.toString() ?? ""} state={totalQuery.isPending ? "loading" : totalQuery.isError ? "unavailable" : "ready"} unavailableLabel={t("stats.unavailable")} />
          <StatCard label={t("stats.active")} value={activeQuery.data?.pagination?.total_count?.toString() ?? ""} state={activeQuery.isPending ? "loading" : activeQuery.isError ? "unavailable" : "ready"} unavailableLabel={t("stats.unavailable")} />
          <span title={permissionsUnknownTitle}>
            <Button onClick={() => setAddDialogOpen(true)} disabled={!canCreate}><Plus />{t("actions.create")}</Button>
          </span>
        </ToolbarActions>
      </Toolbar>
      <StudentFormDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} mode="create" />
    </>
  );
}
```

`Page<T>.pagination` is itself optional (`packages/types/src/api.ts:120-123`), so the double optional chain (`data?.pagination?.total_count`) is required for `tsc`, not just defensive style — a single `data?.pagination.total_count` still fails to compile.

- [ ] **Step 3: Write `student-columns.tsx`**

```tsx
"use client";

import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Avatar, AvatarFallback, AvatarImage, Badge, Button, createSelectColumn, DataGridColumnHeader } from "@schoolhub/ui";
import { Pencil, UserMinus } from "lucide-react";
import { getInitials } from "@/lib/helpers";
import type { StudentRow } from "./student-row";

export const SORT_FIELD: Record<string, string> = {
  name: "last_name", admissionNumber: "admission_number", admissionDate: "admission_date", status: "status", campus: "campus_name",
};

export function useStudentColumns(canUpdate: boolean, canWithdraw: boolean, onEdit: (id: string) => void, onWithdraw: (id: string, name: string) => void): ColumnDef<StudentRow>[] {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");
  return [
    createSelectColumn<StudentRow>({ selectAll: t("idCards.selectAll"), selectRow: t("idCards.selectRow") }),
    {
      accessorKey: "name",
      header: ({ column }) => <DataGridColumnHeader column={column} title={t("columns.name")} />,
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8"><AvatarImage src={row.original.signedPhotoUrl} alt="" /><AvatarFallback>{getInitials(row.original.name)}</AvatarFallback></Avatar>
          <div><div className="font-medium">{row.original.name}</div><div className="text-muted-foreground text-xs">{row.original.admissionNumber}</div></div>
        </div>
      ),
    },
    { accessorKey: "campus", header: ({ column }) => <DataGridColumnHeader column={column} title={t("fields.campus")} /> },
    {
      accessorKey: "status",
      header: ({ column }) => <DataGridColumnHeader column={column} title={t("columns.status")} />,
      cell: ({ row }) => <Badge appearance="light">{t(`status.${row.original.status}`)}</Badge>,
    },
    { accessorKey: "admissionDate", header: ({ column }) => <DataGridColumnHeader column={column} title={t("columns.admissionDate")} /> },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          {canUpdate && <Button size="icon" variant="ghost" aria-label={`${tCommon("edit")} ${row.original.name}`} onClick={() => onEdit(row.original.id)}><Pencil className="size-4" /></Button>}
          {canWithdraw && row.original.status === "active" && <Button size="icon" variant="ghost" aria-label={`${t("actions.withdraw")} ${row.original.name}`} onClick={() => onWithdraw(row.original.id, row.original.name)}><UserMinus className="size-4" /></Button>}
        </div>
      ),
    },
  ];
}
```

`createSelectColumn<TData>(labels: { selectAll: string; selectRow: string; skeleton?: ReactNode })` — confirmed against `packages/ui/src/components/data-grid-table.tsx:398-410`; its own row-click-suppression (`:250-256`) means this file does **not** need its own `stopPropagation` wrapper around the checkbox column, unlike the row-actions cell, which still does. Wrap the returned `ColumnDef<StudentRow>[]` in `useMemo(() => [...], [t, canUpdate, canWithdraw, onEdit, onWithdraw])` inside `useStudentColumns` rather than rebuilding it on every render, matching `staff-directory-table.tsx:316-435`'s own memoized columns.

- [ ] **Step 4: Write `student-directory-filters.tsx`**

```tsx
"use client";

import { useTranslations } from "next-intl";
import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@schoolhub/ui";
import { STUDENT_STATUS_VALUES } from "@schoolhub/types";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";

const ALL = "all";

export interface StudentDirectoryFiltersProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  campusId: string;
  onCampusIdChange: (value: string) => void;
  houseId: string;
  onHouseIdChange: (value: string) => void;
}

export function StudentDirectoryFilters({
  searchInput, onSearchInputChange, statusFilter, onStatusFilterChange, campusId, onCampusIdChange, houseId, onHouseIdChange,
}: StudentDirectoryFiltersProps) {
  const t = useTranslations("students");
  const campusesQuery = useQuery({ queryKey: queryKeys.list("school-organization", "campuses"), queryFn: () => Services.dashboard.fetchCampuses() });
  const housesQuery = useQuery({ queryKey: queryKeys.list("school-organization", "houses"), queryFn: () => Services.schoolOrganization.fetchHouses() });

  return (
    <>
      <Input aria-label={t("filters.search")} placeholder={t("list.searchPlaceholder")} value={searchInput} onChange={(e) => onSearchInputChange(e.target.value)} className="max-w-64" />
      <Select value={statusFilter} onValueChange={onStatusFilterChange}>
        <SelectTrigger className="w-40" aria-label={t("filters.status")}><SelectValue placeholder={t("filters.status")} /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
          {STUDENT_STATUS_VALUES.map((s) => <SelectItem key={s} value={s}>{t(`status.${s}`)}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={campusId || ALL} onValueChange={(v) => onCampusIdChange(v === ALL ? "" : v)}>
        <SelectTrigger className="w-40" aria-label={t("filters.campus")}><SelectValue placeholder={t("filters.campus")} /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
          {(campusesQuery.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={houseId || ALL} onValueChange={(v) => onHouseIdChange(v === ALL ? "" : v)}>
        <SelectTrigger className="w-40" aria-label={t("filters.house")}><SelectValue placeholder={t("filters.house")} /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
          {(housesQuery.data ?? []).map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </>
  );
}
```

- [ ] **Step 5: Write the failing test for the directory table**

```tsx
it("filters by campus", async () => {
  mockFetchStudentsPage.mockResolvedValue({ items: [], pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 0 } });
  mockFetchCampuses.mockResolvedValue([{ id: "c1", name: "Main Campus" }]);
  renderWithProviders(<StudentDirectoryTable />);
  await userEvent.setup().click(await screen.findByRole("combobox", { name: /campus/i }));
  await userEvent.setup().click(await screen.findByRole("option", { name: "Main Campus" }));
  await waitFor(() => expect(mockFetchStudentsPage).toHaveBeenCalledWith(expect.objectContaining({ campusId: "c1", page: 1 })));
});

it("shows the unfiltered empty state when there are simply no students yet", async () => {
  // The directory's status filter defaults to "active", not "all" — that default alone
  // must not read as "filtered" (round-4 review finding: an earlier version of this
  // test asserted `noMatches` with no filter actually changed, which can never be true
  // since `hasActiveFilter` is false at the default and `list.emptyTitle` renders instead).
  mockFetchStudentsPage.mockResolvedValue({ items: [], pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 0 } });
  renderWithProviders(<StudentDirectoryTable />);
  expect(await screen.findByText(/no students yet/i)).toBeInTheDocument();
});

it("shows a not-forbidden, not-broken empty state for a legitimately empty *filtered* result", async () => {
  mockFetchStudentsPage.mockResolvedValue({ items: [], pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 0 } });
  renderWithProviders(<StudentDirectoryTable />);
  await userEvent.setup().type(screen.getByRole("textbox", { name: /search students/i }), "nonexistent");
  await waitFor(() => expect(mockFetchStudentsPage).toHaveBeenCalledWith(expect.objectContaining({ search: "nonexistent" })));
  expect(await screen.findByText(/no students match these filters/i)).toBeInTheDocument();
  expect(screen.queryByText(/don't have permission/i)).not.toBeInTheDocument();
});

it("hides the row-level Withdraw action for a graduated student", async () => {
  mockFetchStudentsPage.mockResolvedValue({ items: [studentRecord({ status: "graduated" })], pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1 } });
  renderWithProviders(<StudentDirectoryTable />);
  await screen.findByText(/graduated/i);
  expect(screen.queryByRole("button", { name: /withdraw/i })).not.toBeInTheDocument();
});

it("shows the row-level Withdraw action for an active student (positive control)", async () => {
  mockFetchStudentsPage.mockResolvedValue({ items: [studentRecord({ status: "active", first_name: "Ayesha" })], pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1 } });
  renderWithProviders(<StudentDirectoryTable />);
  expect(await screen.findByRole("button", { name: /^withdraw/i })).toBeInTheDocument();
});

it("shows a permission-denied message, not the generic one, for a 403", async () => {
  mockFetchStudentsPage.mockRejectedValue(new ApiError({ code: "permission_denied", message: "Forbidden.", status: 403, url: "/students" }));
  renderWithProviders(<StudentDirectoryTable />);
  expect(await screen.findByText(/don't have permission to view students/i)).toBeInTheDocument();
});

it("shows a generic failure message, not the permission one, for a network error", async () => {
  mockFetchStudentsPage.mockRejectedValue(new ApiError({ code: "network_error", message: "", status: 0, url: "/students" }));
  renderWithProviders(<StudentDirectoryTable />);
  // The real errors.network_error string, not a guessed pattern (round-4 review
  // finding: an earlier version of this regex matched nothing in the real en.json).
  expect(await screen.findByText(/we could not reach the server/i)).toBeInTheDocument();
  expect(screen.queryByText(/don't have permission/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 6: Confirm the tests fail by construction, then implement `student-directory-table.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { getCoreRowModel, useReactTable, type SortingState } from "@tanstack/react-table";
import {
  Card, CardFooter, CardHeader, CardTable, DATA_GRID_CARD_CLASSNAME, DataGrid, DataGridPagination,
  DataGridTable, EmptyState, ScrollArea, ScrollBar,
} from "@schoolhub/ui";
import { Users } from "lucide-react";
import { isOffsetPagination } from "@schoolhub/types";
import { ApiError, Services } from "@/services";
import { DASHBOARD_DATA_GRID_LABELS } from "@/app/(app)/shell/data-grid-labels";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants";
import { resolveErrorMessage } from "@/lib/error-message";
import { useCurrentUser } from "@/hooks/use-current-user";
import { StudentFormDialog } from "./student-form-dialog";
import { StudentDetailSheet } from "./student-detail-sheet";
import { WithdrawStudentDialog } from "./withdraw-student-dialog";
import { StudentDirectoryFilters } from "./student-directory-filters";
import { SORT_FIELD, useStudentColumns } from "./student-columns";
import { toStudentRow, type StudentRow } from "./student-row";

export function StudentDirectoryTable() {
  const t = useTranslations("students");
  const tErrors = useTranslations("errors");

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [campusId, setCampusId] = useState("");
  const [houseId, setHouseId] = useState("");
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [formDialog, setFormDialog] = useState<{ mode: "create" } | { mode: "edit"; studentId: string } | null>(null);
  const [withdrawDialog, setWithdrawDialog] = useState<{ ids: string[]; names: string[] } | null>(null);
  const [detailRow, setDetailRow] = useState<StudentRow | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const hasActiveFilter = search !== "" || statusFilter !== "active" || campusId !== "" || houseId !== "";
  useEffect(() => { setPagination((p) => ({ ...p, pageIndex: 0 })); }, [search, sorting, statusFilter, campusId, houseId]);

  const ordering = sorting[0] ? `${sorting[0].desc ? "-" : ""}${SORT_FIELD[sorting[0].id] ?? sorting[0].id}` : undefined;
  const { page, pageSize } = { page: pagination.pageIndex + 1, pageSize: pagination.pageSize };

  const query = useQuery({
    queryKey: queryKeys.list("students", "students", { page, pageSize, search, ordering, statusFilter, campusId, houseId }),
    queryFn: () => Services.students.fetchStudentsPage({
      page, pageSize, search: search || undefined, ordering,
      status: statusFilter === "all" ? undefined : statusFilter,
      campusId: campusId || undefined, houseId: houseId || undefined,
    }),
    placeholderData: keepPreviousData,
  });

  const pageMeta = query.data?.pagination;
  const pageCount = pageMeta && isOffsetPagination(pageMeta) ? pageMeta.total_pages : 1;
  const totalCount = pageMeta && isOffsetPagination(pageMeta) ? pageMeta.total_count : 0;
  useEffect(() => { setPagination((p) => (p.pageIndex >= pageCount && pageCount > 0 ? { ...p, pageIndex: pageCount - 1 } : p)); }, [pageCount]);

  const rows = useMemo(() => (query.data?.items ?? []).map(toStudentRow), [query.data]);

  const { data: currentUser } = useCurrentUser();
  const canUpdate = hasPermission(currentUser, "students.student.update");
  const canWithdraw = hasPermission(currentUser, "students.student.withdraw");

  const columns = useStudentColumns(
    canUpdate, canWithdraw,
    (id) => setFormDialog({ mode: "edit", studentId: id }),
    (id, name) => setWithdrawDialog({ ids: [id], names: [name] }),
  );

  const table = useReactTable({
    data: rows, columns, pageCount,
    state: { pagination, sorting, rowSelection },
    onPaginationChange: setPagination, onSortingChange: setSorting, onRowSelectionChange: setRowSelection,
    manualPagination: true, manualSorting: true, enableRowSelection: true,
    getRowId: (r) => r.id, getCoreRowModel: getCoreRowModel(),
  });

  const selected = table.getSelectedRowModel().rows.map((r) => r.original);
  const selectedWithdrawable = selected.filter((s) => s.status === "active");

  useEffect(() => { if (withdrawDialog === null) setRowSelection({}); }, [withdrawDialog]);

  if (query.isError) {
    const isPermissionDenied = query.error instanceof ApiError && query.error.isPermissionDenied;
    return <Card><p className="text-muted-foreground p-6 text-sm">{isPermissionDenied ? t("list.forbidden") : resolveErrorMessage(query.error, tErrors, t("list.forbidden"))}</p></Card>;
  }

  return (
    <>
      <DataGrid
        table={table}
        recordCount={totalCount}
        isLoading={query.isPending}
        onRowClick={setDetailRow}
        labels={DASHBOARD_DATA_GRID_LABELS}
        emptyState={<EmptyState icon={Users} title={t(hasActiveFilter ? "list.noMatches" : "list.emptyTitle")} description={t("list.emptyDescription")} />}
      >
        <Card className={DATA_GRID_CARD_CLASSNAME}>
          <CardHeader className="flex flex-wrap items-center gap-2.5 py-3.5">
            <StudentDirectoryFilters
              searchInput={searchInput} onSearchInputChange={setSearchInput}
              statusFilter={statusFilter} onStatusFilterChange={setStatusFilter}
              campusId={campusId} onCampusIdChange={setCampusId}
              houseId={houseId} onHouseIdChange={setHouseId}
            />
            {selectedWithdrawable.length > 0 && canWithdraw && (
              <Button variant="destructive" onClick={() => setWithdrawDialog({ ids: selectedWithdrawable.map((s) => s.id), names: selectedWithdrawable.map((s) => s.name) })}>
                {t("withdraw.confirmBulk", { count: selectedWithdrawable.length })}
              </Button>
            )}
          </CardHeader>
          <ScrollArea><CardTable><DataGridTable /></CardTable><ScrollBar orientation="horizontal" /></ScrollArea>
          <CardFooter><DataGridPagination /></CardFooter>
        </Card>
      </DataGrid>
      {formDialog && <StudentFormDialog open onOpenChange={(open) => !open && setFormDialog(null)} mode={formDialog.mode} studentId={formDialog.mode === "edit" ? formDialog.studentId : undefined} />}
      {withdrawDialog && <WithdrawStudentDialog open onOpenChange={(open) => !open && setWithdrawDialog(null)} studentIds={withdrawDialog.ids} studentNames={withdrawDialog.names} />}
      <StudentDetailSheet
        row={detailRow} canUpdate={canUpdate} canWithdraw={canWithdraw}
        onOpenChange={(open) => !open && setDetailRow(null)}
        onEdit={(id) => { setDetailRow(null); setFormDialog({ mode: "edit", studentId: id }); }}
        onWithdraw={(id, name) => { setDetailRow(null); setWithdrawDialog({ ids: [id], names: [name] }); }}
      />
    </>
  );
}
```

(`Button` needs importing from `@schoolhub/ui` in this file — omitted from the import list above only by oversight in this draft, add it.)

Add `SEARCH_DEBOUNCE_MS` to `apps/dashboard/src/lib/constants.ts` if it doesn't already exist there (round-2 review found it already does — confirm and reuse, don't redeclare).

- [ ] **Step 7: Confirm the tests pass by construction**

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/features/students/student-columns.tsx apps/dashboard/src/features/students/student-directory-filters.tsx apps/dashboard/src/features/students/student-toolbar.tsx apps/dashboard/src/features/students/student-directory-table.tsx apps/dashboard/src/features/students/__tests__/student-toolbar.test.tsx apps/dashboard/src/features/students/__tests__/student-directory-table.test.tsx apps/dashboard/messages/en.json apps/dashboard/messages/ur.json
git commit -m "feat(dashboard): add the student directory table and toolbar"
```

- [ ] **Step 9: Push and read CI**

---

## Task 9: wire the route, add e2e coverage

**Files:**
- Modify: `apps/dashboard/src/app/(app)/students/page.tsx`
- Create: `e2e/src/mocks/domains/students.ts`
- Modify: `e2e/src/mocks/domains/school-organization.ts`, `e2e/src/mocks/index.ts`
- Create: `e2e/src/pages/dashboard/students.page.ts`
- Modify: `e2e/src/pages/index.ts`, `e2e/src/fixtures/index.ts`
- Create: `e2e/tests/dashboard/students.spec.ts`
- Modify: `apps/dashboard/eslint-suppressions.json`

- [ ] **Step 1: Replace the placeholder route**

```tsx
import { Container } from "@/app/(app)/shell/partials/common/container";
import { StudentDirectoryTable } from "@/features/students/student-directory-table";
import { StudentToolbar } from "@/features/students/student-toolbar";

export default function StudentsPage() {
  return (
    <>
      <Container><StudentToolbar /></Container>
      <Container><StudentDirectoryTable /></Container>
    </>
  );
}
```

Prune this route's `react/jsx-no-literals` entry from `apps/dashboard/eslint-suppressions.json` — the placeholder's hardcoded "Coming soon." text is gone, so the suppression is now unused, and an unused suppression fails lint (the baseline may only shrink).

- [ ] **Step 2: Add `/houses` to the existing `school-organization` mock module**

Read `e2e/src/mocks/domains/school-organization.ts`'s current shape first, then add a `houses` option and a `GET /houses` stub following the same static-list pattern it already uses for campuses.

- [ ] **Step 3: Write the e2e mock domain for students**

```ts
import { id } from "@/data/factories";
import { fail, ok, pagedList } from "../envelope";
import type { MockModule } from "../router";

export interface Student {
  id: string; admission_number: string; user_id: string | null; first_name: string; last_name: string;
  preferred_name: string | null; date_of_birth: string; gender: "male" | "female" | "other" | "unspecified";
  photo_file_id: string | null; photo_url: string | null; campus_id: string; campus_name: string;
  house_id: string | null; house_name: string | null; status: "active" | "suspended" | "transferred" | "withdrawn" | "graduated";
  admission_date: string; blood_group: string | null; nationality: string | null; religion: string | null;
  previous_school: string | null; medical_notes: string | null; address: Record<string, unknown> | null;
  created_at: string; updated_at: string;
}

export function buildStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: id("student"), admission_number: "2026-0001", user_id: null, first_name: "Ayesha", last_name: "Khan",
    preferred_name: null, date_of_birth: "2012-05-01", gender: "female", photo_file_id: null, photo_url: null,
    campus_id: "campus-0001", campus_name: "Main Campus", house_id: null, house_name: null, status: "active",
    admission_date: "2026-01-10", blood_group: null, nationality: null, religion: null, previous_school: null,
    medical_notes: null, address: null, created_at: "2026-01-10T00:00:00Z", updated_at: "2026-01-10T00:00:00Z",
    ...overrides,
  };
}

export interface StudentOptions { students?: Student[] }

export function studentsModule(options: StudentOptions = {}): MockModule {
  return (api) => {
    const students = [...(options.students ?? [])];

    api.get("/students", (request) => {
      const matching = filterAndOrder(students, request.searchParams);
      const pageSize = Number(request.searchParams.get("page_size") ?? matching.length) || 1;
      const page = Number(request.searchParams.get("page") ?? 1) || 1;
      const start = (page - 1) * pageSize;
      return pagedList(matching.slice(start, start + pageSize), { page, page_size: pageSize, total_count: matching.length });
    });

    api.get("/students/:studentId", (request) => {
      const match = students.find((s) => s.id === request.params["studentId"]);
      return match ? ok(match) : fail(404, "Not found.");
    });

    api.post("/students", (request) => {
      const body = (request.json() as Partial<Student> | null) ?? {};
      const missing = (["first_name", "last_name", "date_of_birth", "gender", "campus_id", "admission_date"] as const).filter((f) => !body[f]);
      if (missing.length > 0) return fail(400, "Validation failed.", { details: missing.map((field) => ({ field, issue: "This field is required." })) });
      const created = buildStudent({ ...body, id: id("student"), admission_number: `2026-${String(students.length + 1).padStart(4, "0")}` });
      students.push(created);
      return ok(created, { status: 201 });
    });

    api.patch("/students/:studentId", (request) => {
      const match = students.find((s) => s.id === request.params["studentId"]);
      if (!match) return fail(404, "Not found.");
      Object.assign(match, (request.json() as Partial<Student> | null) ?? {}, { updated_at: "2026-09-02T00:00:00Z" });
      return ok(match);
    });

    api.post("/students/:studentAction", (request) => {
      const [studentId, action] = (request.params["studentAction"] ?? "").split(":");
      const match = students.find((s) => s.id === studentId);
      if (action !== "withdraw" || !match) return fail(404, "Not found.");
      if (match.status !== "active") {
        return fail(422, `Student is ${match.status}, not active.`, { code: "domain_rule_violation", details: [{ field: "non_field", issue: `Student is ${match.status}, not active.` }] });
      }
      Object.assign(match, { status: "withdrawn", updated_at: "2026-09-02T00:00:00Z" });
      return ok(match);
    });
  };
}

function filterAndOrder(students: Student[], params: URLSearchParams): Student[] {
  const status = params.get("status");
  const campusId = params.get("campus_id");
  const houseId = params.get("house_id");
  const search = params.get("search")?.toLowerCase();
  const ordering = params.get("ordering");

  const matching = students.filter((s) =>
    (!status || s.status === status) && (!campusId || s.campus_id === campusId) && (!houseId || s.house_id === houseId) &&
    (!search || `${s.first_name} ${s.last_name}`.toLowerCase().includes(search) || s.admission_number.toLowerCase().includes(search)));
  if (!ordering) return matching;
  const descending = ordering.startsWith("-");
  const field = (descending ? ordering.slice(1) : ordering) as keyof Student;
  const sortKey = (s: Student) => { const v = s[field]; return typeof v === "string" ? v : ""; };
  return [...matching].sort((a, b) => (descending ? -1 : 1) * sortKey(a).localeCompare(sortKey(b)));
}
```

Register it in `e2e/src/mocks/index.ts`: `export * from "./domains/students";`.

- [ ] **Step 4: Write the page object and register it**

```ts
import { BasePage } from "../base.page";

export class StudentsPage extends BasePage {
  path = "/students";

  get searchInput() { return this.page.getByPlaceholder(/search by name or admission/i); }
  get addStudentButton() { return this.page.getByRole("button", { name: /new student/i }); }
  row(name: string) { return this.page.getByRole("row", { name: new RegExp(name, "i") }); }
  // The button's accessible name is "{Action} {student name}" (e.g. "Withdraw Ayesha
  // Khan"), not a bare "Edit"/"Withdraw" — a screen-reader user tabbing through many
  // rows needs to hear which row's button they're on, not just which action it is.
  rowAction(rowName: string, action: "Edit" | "Withdraw") { return this.row(rowName).getByRole("button", { name: new RegExp(`^${action} `) }); }
}
```

`e2e/src/pages/index.ts`: `export * from "./dashboard/students.page";` (leave every existing export untouched).

- [ ] **Step 5: Add a `studentsPage` fixture, alongside the existing ones**

In `e2e/src/fixtures/index.ts`: add `StudentsPage` to the `@/pages` import list; add `studentsPage: StudentsPage;` to the fixtures type (its real name is `E2EFixtures` — confirm against `fixtures/index.ts` before writing, not `Fixtures`); add the `async ({ page }, use) => { await use(new StudentsPage(page)); }` implementation beside `staffPage`'s.

- [ ] **Step 6: Write `e2e/tests/dashboard/students.spec.ts`**

```ts
import { expect, test } from "@/fixtures";
import { buildUser, SCHOOL_ADMIN_PERMISSIONS } from "@/data/factories";
import { buildCampus, buildStudent, schoolOrganizationModule, studentsModule } from "@/mocks";

const campuses = [buildCampus({ id: "campus-0001", name: "Main Campus" })];

test.describe("students directory", () => {
  test.use({
    authUser: buildUser({ permissions: [...SCHOOL_ADMIN_PERMISSIONS, "students.student.create", "students.student.update", "students.student.withdraw"] }),
  });

  test.beforeEach(async ({ signedIn: _signedIn, mockApi, studentsPage }) => {
    mockApi.use(
      schoolOrganizationModule({ campuses, houses: [] }),
      studentsModule({ students: [buildStudent({ id: "student-0001", first_name: "Ayesha", last_name: "Khan" })] }),
    );
    await studentsPage.goto();
  });

  test("adds a student", async ({ page, studentsPage }) => {
    await studentsPage.addStudentButton.click();
    await page.getByLabel(/first name/i).fill("Bilal");
    await page.getByLabel(/last name/i).fill("Ahmed");
    await page.getByLabel(/date of birth/i).fill("2013-02-14");
    await page.getByRole("combobox", { name: /gender/i }).click();
    await page.getByRole("option", { name: /^male$/i }).click();
    await page.getByRole("combobox", { name: /^campus$/i }).click();
    await page.getByRole("option", { name: "Main Campus" }).click();
    await page.getByLabel(/admission date/i).fill("2026-03-01");
    const request = page.waitForRequest((r) => r.url().includes("/students") && r.method() === "POST");
    await page.getByRole("button", { name: /new student/i }).click();
    expect((await request).postDataJSON()).toMatchObject({ first_name: "Bilal", last_name: "Ahmed", date_of_birth: "2013-02-14", gender: "male", campus_id: "campus-0001", admission_date: "2026-03-01" });
    await expect(studentsPage.row("Bilal Ahmed")).toBeVisible();
  });

  test("withdraws a student, and the row leaves the (active-filtered) default view", async ({ page, studentsPage }) => {
    const request = page.waitForRequest((r) => r.url().includes("student-0001:withdraw"));
    await studentsPage.rowAction("Ayesha Khan", "Withdraw").click();
    await page.getByLabel(/reason/i).fill("Relocated to another city");
    await page.getByLabel(/effective date/i).fill("2026-03-15");
    await page.getByRole("button", { name: /^withdraw$/i }).click();
    expect((await request).postDataJSON()).toMatchObject({ reason: "Relocated to another city", effective_date: "2026-03-15" });
    // The directory defaults to status=active — a withdrawn student drops out of it,
    // exactly as a resigned staff member drops out of /staff's own default filter.
    await expect(studentsPage.row("Ayesha Khan")).toHaveCount(0);
    // Switch the status filter to see it withdrawn, and confirm the action is gone there too.
    await page.getByRole("combobox", { name: /status/i }).click();
    await page.getByRole("option", { name: /^all$/i }).click();
    await expect(studentsPage.row("Ayesha Khan").getByText(/withdrawn/i)).toBeVisible();
    await expect(studentsPage.rowAction("Ayesha Khan", "Withdraw")).toHaveCount(0);
  });
});

test.describe("students directory, view-only permissions", () => {
  // SCHOOL_ADMIN_PERMISSIONS holds only `students.student.view` by default — confirmed
  // against e2e/src/data/factories.ts before writing this (round-2 review caught an
  // earlier draft's wrong assumption that it already included create/update/withdraw).
  test.use({ authUser: buildUser({ permissions: SCHOOL_ADMIN_PERMISSIONS }) });

  test("hides the withdraw action entirely for a user without the permission", async ({ signedIn: _signedIn, mockApi, studentsPage }) => {
    mockApi.use(schoolOrganizationModule({ campuses, houses: [] }), studentsModule({ students: [buildStudent({ id: "student-0001", first_name: "Ayesha", last_name: "Khan" })] }));
    await studentsPage.goto();
    await expect(studentsPage.row("Ayesha Khan")).toBeVisible();
    await expect(studentsPage.rowAction("Ayesha Khan", "Withdraw")).toHaveCount(0);
  });
});
```

- [ ] **Step 7: Commit**

```bash
git add "apps/dashboard/src/app/(app)/students/page.tsx" apps/dashboard/eslint-suppressions.json e2e/src/mocks/domains/students.ts e2e/src/mocks/domains/school-organization.ts e2e/src/mocks/index.ts e2e/src/pages/dashboard/students.page.ts e2e/src/pages/index.ts e2e/src/fixtures/index.ts e2e/tests/dashboard/students.spec.ts
git commit -m "feat(dashboard): wire up /students and add its mocked e2e coverage"
```

- [ ] **Step 8: Push and read CI**

Confirm the `dashboard` Playwright project passes. Confirm `e2e-live`'s `students-admission-enrollment.spec.ts` is unaffected (still red for its pre-existing Guardians-tab reason — note in `deferred-work.md`, Task 10, that this live spec needs a rewrite once Phase 2 ships, not just unblocking, since it currently drives `/students/new` through page objects targeting a route this phase never builds).

---

## Task 10: Docs, including the new ADR

**Files:**
- Create: `docs/decisions/0017-generated-wire-types-for-new-domains.md`
- Create: `docs/superpowers/plans/2026-09-30-students-dashboard-phase-1.md`
- Modify: `docs/decisions/README.md`, `docs/03-modules/student-management.md`, `docs/project-status.md`, `docs/metronic-dashboard-shell.md`, `docs/deferred-work.md`, `docs/02-architecture/repo-structure.md`
- Modify: `.claude/skills/schoolhub-api-services/SKILL.md`, `packages/types/src/index.ts`, `apps/dashboard/AGENTS.md`

- [ ] **Step 1: Write the ADR**

`docs/decisions/0017-generated-wire-types-for-new-domains.md`, copying `0000-template.md` exactly — Status/Date/Enforced-by are not optional fields, and this record needs an index row:

```markdown
# 0017. Generated wire types for new domains

- **Status:** Accepted
- **Date:** 2026-09-30
- **Enforced by:** review only — no lint rule catches a hand-written domain interface that
  happens to compile; the next domain's plan review is what checks this

## Context

`schoolhub-api-services/SKILL.md` and `packages/types`' own header describe hand-maintained
domain types in `packages/types` as the target, following `auth.ts`. In practice, every domain
built since `auth` (`staff`, `dashboard`'s reference-data helpers) hand-rolled its wire types
locally in its own service file instead — `packages/types` has never gained a second domain.
Building `students`, a hand-written `StudentRecord` in `packages/types` drifted from the real,
already-generated contract (`packages/api-client`'s OpenAPI generator, which post-dates when
`auth.ts` was written) before a line of the rest of the module existed: it was missing
`custom_fields`, mistyped `address`, and got `admission_number`'s optionality backwards.

## Decision

A new domain's wire shape is the generated `ApiSchemas["<Model>"]` (`@schoolhub/api-client`),
type-aliased and re-exported from that domain's own `services/modules/<domain>/` (e.g.
`export type StudentRecord = ApiSchemas["Student"]`). Components import it from `@/services`,
never `@schoolhub/api-client` directly. `packages/types` keeps only genuinely hand-authored,
cross-cutting types with no generated source: the envelope/pagination primitives, auth/RBAC
types, tenant/website types, and small runtime value-arrays an enum-backed `<Select>` or
`z.enum(...)` needs (e.g. `GENDER_VALUES`) — the OpenAPI generator can emit these as a
`--enum-values` array too, which this repo's generator invocation does not currently turn on;
until it does, these hand-copied arrays are a second source of truth by necessity, not an
oversight, and are the one exception to "no second source of truth" below.

## Alternatives considered

- **Keep hand-maintaining `packages/types`, following `auth.ts` and the skill as written.**
  Why not: this is what the first draft of the `students` module did, and it drifted from the
  real contract before the rest of the module was even built — see Context.
- **Migrate `auth.ts` to the generated types now, for full consistency.** Why not: out of
  scope here and not free — `AuthenticatedUser` and friends predate a clean generated
  equivalent in places; a separate, deliberate migration, not a side effect of this decision.
- **Turn on the OpenAPI generator's `--enum-values` flag instead of hand-copying enum arrays.**
  Why not: a real option, deferred rather than rejected — it would remove the one exception
  this record carries, but changing the generator invocation is its own small change with its
  own blast radius (every other generated enum in the codebase), not bundled into this PR.

## Consequences

- No second source of truth to drift from the real contract, except the documented enum-array
  exception above.
- `auth.ts` stays as it is; migrating it is a separate, future decision.
- `schoolhub-api-services/SKILL.md`, `packages/types/src/index.ts`'s header,
  `docs/02-architecture/repo-structure.md` §2's "a shared TypeScript type → `packages/types`"
  row, and `apps/dashboard/AGENTS.md`'s matching guidance are all updated in this same PR to
  point here, so the next domain doesn't rediscover this the hard way a third time.
```

Add a row for it to `docs/decisions/README.md`'s Index table: `| [0017](0017-generated-wire-types-for-new-domains.md) | A new domain's wire types come from the generated API contract, not a hand-written packages/types copy | Accepted | review only |`.

- [ ] **Step 2: Update every doc that currently points the other way**

`.claude/skills/schoolhub-api-services/SKILL.md` — its "Types come from `packages/types`... the one place domain types live in this repo" line (and its two other mentions of the same guidance) need a line each pointing at ADR-0017: a domain's own wire shape is the generated `ApiSchemas` type, re-exported from its service module; `packages/types` is for the cross-cutting/no-generated-source cases only.

`packages/types/src/index.ts`'s header comment — add: "A new domain's own wire types come from `ApiSchemas` (`@schoolhub/api-client`), re-exported from its `services/modules/<domain>/` — see ADR-0017. This file is for cross-cutting types and runtime value-arrays with no generated source."

`docs/02-architecture/repo-structure.md` §2's "A shared TypeScript type → `packages/types/src/`" row — add "(a new domain's own wire type: see ADR-0017 instead)".

`apps/dashboard/AGENTS.md`'s matching guidance, wherever it currently says the same thing — same addition.

- [ ] **Step 3: Commit this plan to its repo location**

- [ ] **Step 4: Add §20 to the module doc**

```markdown
## 20. Implementation notes

**Dashboard, Phase 1 (as shipped).** `/students` ships a directory (`DataGrid`, search +
status/campus/house filters), create/edit (`StudentFormDialog`), a flat profile detail view
(`StudentDetailSheet`, including address fields and the read-only admission number), and
withdrawal (`WithdrawStudentDialog`, single or bulk, offered only for `active` students and
honoring `Idempotency-Key`). `photo_url` was added to `StudentSerializer`, mirroring
`staff_management/staff/serializers.py`. `waive_clearance` is not exposed — `clearance_blockers()`
always returns `[]` until a fees/library/transport module ships (`deferred-work.md`). Wire types
are the generated `ApiSchemas["Student"]`, not a hand-maintained duplicate (ADR-0017). Guardians,
emergency contacts, documents, enrollment/transfers, and bulk import/export/ID-cards are
sequenced as later phases — see `docs/project-status.md`.

The backend's own `emergency_contacts/`, `guardians/`, `student_guardians/` and `transfers/`
packages exist but are not wired into `urls.py` — a separate, backend-only follow-up.
```

- [ ] **Step 5: Update `project-status.md`, `metronic-dashboard-shell.md`, `deferred-work.md`**

`project-status.md`: update the `student-management` row's "Dashboard screens" column; correct the stale "Both full-stack complete" claim and the live-spec description if stale; fix "every list screen is `useTableParams` + `DataTable`" to name `DataGrid`; add a "Start here next session" bullet pointing at this plan's Roadmap.

`metronic-dashboard-shell.md`: remove "students" from the Backlog's route list, noting Phase 1 scope.

`deferred-work.md`: resolve the student-photo entry (students' `photo_url` shipped; guardians' stays deferred); add entries for the duplicate-admission override, `waive_clearance`, and the deferred class/section/session filters, each pointing at this plan's Roadmap for the phase that picks it up.

- [ ] **Step 6: Commit**

```bash
git add docs/decisions/0017-generated-wire-types-for-new-domains.md docs/decisions/README.md docs/superpowers/plans/2026-09-30-students-dashboard-phase-1.md docs/03-modules/student-management.md docs/project-status.md docs/metronic-dashboard-shell.md docs/deferred-work.md docs/02-architecture/repo-structure.md .claude/skills/schoolhub-api-services/SKILL.md packages/types/src/index.ts apps/dashboard/AGENTS.md
git commit -m "docs: record the students dashboard Phase 1 delivery and add ADR-0017"
```

---

## Task 11: write the `schoolhub-dashboard-screen` skill

**Files:**
- Create: `.claude/skills/schoolhub-dashboard-screen/SKILL.md`
- Modify: root `AGENTS.md`

- [ ] **Step 1: Write the skill**

Follow `schoolhub-api-services/SKILL.md`'s format and depth. Content, using `/students` Phase 1 as the worked example:

- **Frontmatter:**
  ```yaml
  ---
  name: schoolhub-dashboard-screen
  description: Use when building a new dashboard feature screen — a directory list, create/edit form, detail view, and a destructive/lifecycle action — phrases like "build the X screen", "add a directory for Y", "port the old Z UI", or any new file under `apps/dashboard/src/features/<module>/`. SKIP for wiring a single API call with no screen around it (use schoolhub-api-services) or for a new packages/ui primitive (use schoolhub-ui-port).
  ---
  ```
- Feature code in `src/features/<module>/`. Wire types from `ApiSchemas` per ADR-0017, not `packages/types`.
- Split a form/table into a schema/mapping file, a sub-field component, and a filters/columns file *before* hitting the 400-line `max-lines` ceiling — new files cannot add a suppression to the shrink-only baseline, so this isn't optional polish.
- The `DataGrid` shape: `DataGridColumnHeader`/`createSelectColumn` (don't hand-roll a sort header or a checkbox column when these exist), local debounced search state using the shared `SEARCH_DEBOUNCE_MS` constant, `isOffsetPagination`/`isCursorPagination` narrowing before touching pagination fields, bulk selection filtered to rows the action is actually valid for, and gating a row action on the record's own state when the backend itself refuses certain states — not just on the viewer's permission.
- The `ResponsiveDialog`/`ResponsiveSheet` pair, `useIsDesktopShell()` vs `useIsDrawer()`, and the mobile `<form>` `flex min-h-0 grow flex-col` requirement inside a `Drawer`.
- The form-dialog shape: snake_case zod schema, `Object.entries(error.fieldErrors())` (never a `for...of`, it's a `Record`), `resolveErrorMessage(..., "non_field")` for a domain-rule error with no matching form field, an `isDetailLoading` gate that keeps `Select` fields unmounted until an edit's prefill has actually applied (Radix blanks a `Select` whose value changes before its `<option>`s have registered), an "open session" counter (not a boolean) for a stale-upload guard, and create-vs-edit clearing semantics (`undefined` = omit on create, `null` = clear on edit).
- A destructive/idempotent action passes `RequestOptions.idempotencyKey`, generated once per dialog-open and reused on retry.
- Query keys: `queryKeys.list/detail/module`; invalidate `queryKeys.module("dashboard")` too when a mutation changes a count the dashboard home displays.
- i18n: reuse `common.*` for generic labels (Cancel/Save/Close) rather than adding near-duplicate per-screen keys.
- Tests: `renderWithProviders` for most cases; a locally-built `QueryClientProvider` `wrapper` (not `renderWithProviders`, which can't survive `rerender`) for any test that needs the *same* component instance across prop changes — a stale-upload or reopen-after-close regression test.
- e2e: `MockApi`/envelope pattern; the fixtures/pages barrel files are the actual contract, not dead code to delete; `test.use()` at `describe`/file scope only; a screen's own default filter (e.g. `status=active`) means a row that just left that status drops out of the default view — assert that, don't assert it's merely "disabled."
- **Checklist**, mirroring `schoolhub-api-services`'s.
- **What this does NOT cover:** tabbed detail views with nested CRUD; bulk import/export (point at `/staff`'s shipped pattern).
- **Related:** this plan, ADR-0017, `/staff`'s source, `schoolhub-api-services`, `schoolhub-ui-port`.

- [ ] **Step 2: Add the skill to root `AGENTS.md`'s skill table**

Add a row: `A dashboard feature screen (list + form + detail + an action) | schoolhub-dashboard-screen`, in the same table as the existing `schoolhub-api-services`/`schoolhub-backend-module`/etc. rows.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/schoolhub-dashboard-screen/SKILL.md AGENTS.md
git commit -m "docs(skills): add schoolhub-dashboard-screen, written from the shipped students Phase 1"
```

---

## Roadmap: Phases 2–4 (each becomes its own plan)

### Phase 2 — Relations: guardians, emergency contacts, documents

Wraps Phase 1's flat `StudentDetailSheet` in `Tabs`. **Guardians:** own `Services.guardians` (ADR-0011); no Combobox primitive exists, build "search existing" as the same `Select`-based composition Task 8 uses for campus/house. **Emergency contacts:** Add-only — no update/delete endpoint exists. **Documents:** list/create/delete/verify via `Services.files.uploadFile`. Cross-tenant test gaps to close: emergency contacts have none at all; `GET /student-guardians/{id}` and the guardians list are untested; `PATCH /guardians/{id}` is untested.

### Phase 3 — Enrollment lifecycle and transfers

Blocked on Phase 2 (§11: enrolling needs a guardian and an emergency contact on file). Unblocks the `class_id`/`section_id`/`academic_session_id` directory filters. **Known gap:** `StudentTransferViewSet` has no `student_id` filter — add `filterset_fields = ["student_id"]` with its own cross-tenant test and OpenAPI regen.

### Phase 4 — Bulk operations

Import mirrors `/staff`'s `StaffImportDialog`. Required columns: `first_name, last_name, date_of_birth, gender, campus_code, admission_date`; optional: `preferred_name, blood_group, nationality, religion, previous_school` — show as a fixed reference table, no column-mapping UI exists server-side. Export mirrors `/staff`'s toolbar flow. ID cards: `POST /id-cards:generate`, a batch action alongside bulk withdraw. Final mobile/RTL audit; close the `students-admission-enrollment.spec.ts` live-lane gap once Phase 2 makes its assertions satisfiable.

### Out of scope for all of the above

- Finishing the backend's `student_management` package split (ADR-0010) — zero UI dependency.
- Moving `fetchCampuses` out of `Services.dashboard`, updating `/staff`'s one call site — its own small plan.
- Migrating `/staff` to `src/features/staff/` — its own small plan.

---

## Verification

Each task ends in push-and-read-CI. End-to-end after Task 9: sign in as `school_admin` on a seeded dev tenant, confirm `/students` lists the 24 demo students, create a student (including address fields), edit it (clear a field, confirm it actually clears, including clearing an address down to nothing), open its detail sheet (admission number visible, medical notes correctly restricted or shown), withdraw it (single and bulk) and confirm the withdrawn row leaves the default active-filtered view and its withdraw action is gone wherever it appears, confirm the toolbar's two stat cards and the dashboard home's own student count update without a manual refresh, confirm campus/house filtering works via keyboard as well as mouse, and confirm a `class_teacher` sees an empty (not forbidden, not broken) directory on a fresh tenant.

## Known follow-ups not fixed in this plan (accepted, not oversights)

Four rounds of independent review (below) found and fixed every production-code defect they raised. A handful of small items from round 4 are deliberately left for implementation time rather than a fifth review round, since they are genuinely minor and would be caught immediately by TDD's own test-first step, not by more prose review:
- No dedicated mobile-drawer-branch test for the withdraw dialog or the detail sheet's footer (the desktop branch is fully tested; `setMatchesMobile(true)` variants exist for neither).
- `student-form-dialog.tsx`'s stale inline note claiming `UseFormReturn`'s import "needs confirming" is now resolved code, not an open question — the prose note around it wasn't fully cleaned up.
- `StudentDirectoryFilters`' actions-column note about needing `stopPropagation` is stale — `DataGridTable`'s row click already ignores clicks from inside any `<button>`, confirmed in round 4.
- `DataGrid` has no `caption` prop passed, though `students.list.caption` already exists in i18n.
- The toolbar's stat values use `.toString()` rather than `.toLocaleString()` (staff's own convention).
- `SchoolOrganizationOption` is a small hand-written interface in the same PR that adds ADR-0017 — consistent with the ADR's own carve-out for small reference-data shapes, not a violation of it, but worth a second look during implementation.
- The new `e2e/src/pages/dashboard/students.page.ts` sits beside, not inside, the existing `e2e/src/pages/dashboard/students/` folder that already holds the stale pre-reset page objects.

---

## Independent review — summary across four rounds

This plan went through four rounds of adversarial review by the `plan-reviewer` agent before this document reached its current state (each round's full findings table is preserved in this session's record, not reproduced in full here to keep the plan itself readable):

- **Round 1 — REVISE, 6 High findings.** Caught genuine compile/runtime breaks: deleting a still-used `endpoints.dashboard.students` entry, a duplicated `fetchCampuses` with a wrong response-shape assumption, backend tests written in a style this suite's test runner never executes, e2e fixture/barrel files that would fail to import, and a `field`-less error-message call that defeated Review Focus #1's own point.
- **Round 2 — REVISE, 5 High findings** (after round 1's fixes verified correct). Caught a generic fallback message still hiding the real server text, an e2e withdraw test whose own assertion contradicted the directory's default filter, a permission test missing its sign-in fixture, a stale-upload regression test that would crash instead of testing anything, and a re-introduced Radix `Select`-blanking bug on the edit-prefill path that `/staff` had already fixed once.
- **Round 3 — REVISE, 4 High findings** (after round 2's fixes verified correct). Caught a dirty-tracking flag for address edits that was never set true (silently dropping every real address edit), a desktop dialog with no height bound (Save button off-screen at the CI runner's own viewport), completely unlabeled filter controls (failing two of the plan's own pinned tests and WCAG 4.1.2), and a test wrapper missing a required provider that would throw before any assertion ran.
- **Round 4 — REVISE, 2 High + 5 Medium findings** (after round 3's fixes verified correct, with no regressions). The residual dropped to test-assertion bugs (a regex that didn't match the real i18n string, an empty-state test that didn't account for the directory's own default filter) plus documentation completeness (a half-applied i18n dedup, a `git add` list missing three doc files, an edge case where a fully-cleared address couldn't actually be cleared, and thin coverage on two specific input classes). All of these are now fixed above.

## Independent review (round 4)

- **Reviewer:** plan-reviewer agent, 2026-10-01
- **Verdict:** REVISE — right approach, and round 3's four Highs landed; two newly added Review Focus #4 tests would fail in CI (network-error regex vs real en.json text; empty-state test vs the implicit status=active default), plus five Mediums (half-applied i18n dedup, RF#3 falsy case untested, Task 10 git add missing README/repo-structure/dashboard AGENTS, address uncleareable on edit, no mobile-branch tests).
- **Findings addressed:** All 2 High and 4 of 5 Medium findings fixed inline above (network-error test text corrected; empty-state test now applies a real filter, with a separate unfiltered-empty test added; i18n dedup completed — `actions.edit`/`form.loading`/`detail.close` removed, call sites switched to `tCommon`; Task 10's `git add` and File Structure now include `docs/decisions/README.md`, `docs/02-architecture/repo-structure.md` and `apps/dashboard/AGENTS.md`; address clearing on edit now sends `null` when every sub-field is emptied; a `medical_notes: null` case added alongside the existing "present but falsy-looking" case). The fifth Medium (no dedicated mobile-branch tests for the withdraw dialog / detail-sheet footer) and several Low findings are deliberately left for implementation time — see "Known follow-ups" above — rather than triggering a fifth review round for what TDD's own test-first step would catch directly.
- **Unresolved:** None blocking. The mobile-branch-test gap and the small Low-severity items listed under "Known follow-ups" are accepted, not unresolved — surfaced to the user rather than silently dropped.
