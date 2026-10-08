# Students Dashboard Phase 3: Enrollment, Class/Section Allocation & Transfers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This repo never runs tests, lint or typecheck locally — not even during TDD.** Every task
> below still writes its test before its implementation (TDD's ordering and discipline), but
> "run it, watch it fail/pass" is replaced by: read the test against the diff and confirm by
> inspection that it would fail before the implementation exists and pass after (this is what
> the per-task reviewer does). The only dynamic verification is CI, checked at the push
> checkpoints named in this plan — never a local `pytest`/`jest`/`playwright`/`tsc` invocation.

**Goal:** Build the dashboard UI for enrolling a student, changing their section, and
requesting/approving/rejecting/completing inter-campus and outgoing transfers — plus the
three small, proven backend fixes this surfaces — so the student lifecycle (enroll → allocate
→ transfer → withdraw) is complete end to end.

**Architecture:** Three isolated backend changes in the already-wired `student_management`
app (a transfer filter, a filter-correctness fix, and a documented history response), then a
dashboard layer built bottom-up: reference-data services → feature services → shared
components → dialogs → the orchestrating tab → directory filter wiring → E2E coverage → docs.

**Tech Stack:** Django 6.1 + DRF + django-filter + drf-spectacular (backend); Next.js 16 +
TanStack Query + React Hook Form + Zod 4 (dashboard); Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-10-07-students-phase3-enrollment-design.md` — read
this first for the full context and the three Plan-Mode review rounds behind every decision.
This plan's own review round (below) corrected the spec's assumed dashboard conventions
against the real tree — where this plan and the spec disagree on a file path, transport
shape, or field name, **this plan is correct**; the spec's prose is not re-edited for each
one, since the substance (what to build and why) is unchanged.

**Work tier:** 2

## Global Constraints

- Every endpoint change regenerates `apps/api/openapi.yaml` and
  `packages/api-client/src/schema.d.ts` in the **same commit** as the backend change
  (`.claude/rules/api-contract.md`): `apps/api/scripts/generate-openapi.sh` then
  `pnpm --filter @schoolhub/api-client generate`. Never hand-edit either file.
- **No local test/lint/typecheck runs, ever** — not `pytest`, not `jest`, not `playwright
  test`, not `tsc --noEmit`. Write the test, write the implementation, commit (pre-commit
  hooks run automatically and are not "running tests" — let them run and fix what they
  reject), and confirm correctness by reading the test against the diff. Push at this plan's
  named checkpoints and read `gh pr checks` / `gh run view --log-failed` — CI is the only
  dynamic verification. Never `--no-verify`.
- Every new/changed endpoint keeps its registered `module.resource.action` permission key.
  Cross-tenant access returns 404, never 403, except the real list-view empty-result cases
  this plan names explicitly (a list endpoint has no single object to 404 on).
- New strings go in `apps/dashboard/messages/en.json` **and** `ur.json` in the same commit —
  no hardcoded UI copy (ADR-0014).
- `fix` commits carry a `Root cause:` line (ADR-0016); Task 1's `StudentFilterSet` change is
  `fix`, everything else in this phase is `feat`.
- No AI attribution in any commit or PR.
- Directory filter pickers (`student-directory-filters.tsx`) show every class/section/session
  regardless of status — never send `is_active`. Enroll/change-section/complete pickers
  always send `isActive: true` (mapped to the server's `is_active` param). Do not conflate
  the two.
- Dashboard services live in `apps/dashboard/src/services/modules/<domain>/`, registered in
  the flat `Services` object in `apps/dashboard/src/services/index.ts`. Endpoints live in the
  **single central** `apps/dashboard/src/services/endpoints.ts` — there is no per-module
  endpoints file. Feature components live in `apps/dashboard/src/features/students/` (and
  `.../staff/` for the one cross-reference this plan makes). Service types are camelCase;
  the service function maps camelCase to the server's snake_case request body, matching
  `withdrawStudent`'s existing pattern in `students-service.ts:68-79`.
- The real request/response transport is `apiClient.post<T>(path, body, { idempotencyKey })`
  → `{ data }`, and `fetchPage<T>(apiClient, path, { query })` → `{ items }` /
  `collectPages<T>(apiClient, path)` → `T[]`, both imported from `@schoolhub/api-client`
  (which also exports `MAX_PAGE_SIZE` — reuse it; do not invent a new page-size constant).
  This is not `apiClient.GET(...)`/`apiClient.POST(...{ headers })` — those don't exist.

## Review Focus

- **A `student_id` or filter param that silently no-ops instead of filtering** — every filter
  task's test must prove filtering actually narrows the result set, not just that the
  endpoint still 200s.
- **A Zod schema or service-input type that accepts a payload the server will 422** — the
  discriminated transfer schema (Task 5) and the enroll/change-section input types (Task 4,
  note change-section has **no** `class_id` in its request body) are the sharpest cases.
- **A query invalidated on the wrong key, or not invalidated at all** — every mutation in
  Tasks 8, 9, 10 must invalidate exactly the keys the spec's Invalidation paragraph names.
- **A permission-gated action that renders for a caller who can't actually call it** — enroll
  gates on `students.enrollment.enroll`, change-section on `students.enrollment.update`,
  neither on `students.student.update` (that key gates only the capacity-override field,
  checked separately inside the action). Every dialog takes its permission props from the
  parent, matching the existing three tabs' pattern.
- **A conditional early return before a hook call** — `CompleteTransferDialog` (Task 10) must
  call every hook unconditionally; branch in the JSX it returns, not in whether it calls a
  hook at all.

---

### Task 1: Backend — transfer filter + directory filter correctness fix

**Files:**
- Modify: `apps/api/apps/student_management/filters.py`
- Modify: `apps/api/apps/student_management/views.py`
- Test: `apps/api/apps/student_management/tests/test_enrollment_transfers.py` (the real file
  — not `test_api.py`; its base class `StudentManagementAPITestCase` lives in
  `test_guardians_documents.py:91` and is imported, not redefined)

**Interfaces:**
- Consumes: `StudentTransfer`, `StudentEnrollment` models; the real current `StudentFilterSet`
  (`filters.py`, full file, 36 lines — read it, it's short):
  ```python
  class StudentFilterSet(django_filters.FilterSet):
      campus_id = django_filters.UUIDFilter(field_name="campus_id")
      house_id = django_filters.UUIDFilter(field_name="house_id")
      academic_session_id = django_filters.UUIDFilter(field_name="enrollments__academic_session_id", distinct=True)
      class_id = django_filters.UUIDFilter(field_name="enrollments__school_class_id", distinct=True)
      section_id = django_filters.UUIDFilter(field_name="enrollments__section_id", distinct=True)
      class Meta:
          model = Student
          fields = ["campus_id", "house_id", "status", "academic_session_id", "class_id", "section_id"]
  ```
  `StudentEnrollment.student`'s FK has `related_name="enrollments"`. `StudentEnrollment.objects`
  has an `.alive()` manager method (used by `active_enrollment()` in `services.py`) — use it
  instead of hand-writing `deleted_at__isnull=True`.
- Produces: `StudentTransferFilterSet` (new class, importable by `views.py`); `campus_id`/
  `house_id`/`status` stay untouched — only the three enrollment-joined fields change
  implementation, and their public param names are unchanged.

- [ ] **Step 1: Write the failing test for the new transfer filter**

In `test_enrollment_transfers.py`, find the existing `TransferTests` class (line 252) and add
a test matching this file's real style — `self.allow(...)` for permissions,
`self.client.post/get(path, body, format="json")`, `self.assertEqual(response.status_code,
status.HTTP_200_OK, response.json())`:

```python
def test_filters_transfers_by_student_id(self):
    self.allow("students.student.view")
    with tenant_context(self.tenant.id):
        other_student = StudentFactory(tenant=self.tenant, campus=self.campus)
        other_transfer = StudentTransferFactory(student=other_student, tenant=self.tenant)
        own_transfer = StudentTransferFactory(student=self.student, tenant=self.tenant)

    response = self.client.get(
        "/api/v1/student-transfers", {"student_id": str(self.student.id)}
    )

    self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
    returned_ids = {row["id"] for row in response.json()["data"]}
    self.assertEqual(returned_ids, {str(own_transfer.id)})
    self.assertNotIn(str(other_transfer.id), returned_ids)
```

(Confirm `StudentTransferFactory`'s real import and field requirements by reading a
neighboring `TransferTests` test in the same file before use — mirror its setup exactly,
including whatever `tenant_context` usage that class's existing tests already follow.)

In `CrossTenantEnrollmentTests` (line 413), add — matching that class's real pattern of
building foreign-tenant data **inline per test** (there is no pre-existing
`self.foreign_student` fixture):

```python
def test_transfer_list_filtered_by_foreign_student_id_returns_empty(self):
    self.allow("students.student.view")
    other_tenant = TenantFactory()
    with tenant_context(other_tenant.id):
        foreign_campus = CampusFactory(tenant=other_tenant)
        foreign_student = StudentFactory(tenant=other_tenant, campus=foreign_campus)
        StudentTransferFactory(student=foreign_student, tenant=other_tenant)

    response = self.client.get(
        "/api/v1/student-transfers", {"student_id": str(foreign_student.id)}
    )

    self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
    self.assertEqual(response.json()["data"], [])
```

- [ ] **Step 2: Add `StudentTransferFilterSet`**

In `filters.py`:

```python
class StudentTransferFilterSet(django_filters.FilterSet):
    student_id = django_filters.UUIDFilter(field_name="student_id")

    class Meta:
        model = StudentTransfer
        fields = ["student_id"]
```

Import `StudentTransfer` if not already imported in this file. In `views.py`, import
`StudentTransferFilterSet` and add `filterset_class = StudentTransferFilterSet` to the real
`StudentTransferViewSet` (confirmed wired from `urls.py`'s actual import, not the unwired
`transfers/filters.py`, which doesn't exist).

Read the test against this implementation and confirm: before this step, `student_id` is an
unrecognized query param DRF silently ignores, so the first test's assertion fails (both
transfers come back); after this step, only the matching transfer comes back. Do not run
pytest to confirm this — reason it through from the code, the same way the task reviewer will.

- [ ] **Step 3: Write the failing tests for the `StudentFilterSet` correctness fix**

In the same file, find the directory-filter tests (search for `academic_session_id` — they
may be in `EnrollmentTests` or a dedicated class near it; there is no existing
`StudentFilterSetTests` class, so add these to whichever class already covers directory
filtering, or create one following this file's existing class style):

```python
def test_combining_session_and_class_filter_requires_one_enrollment_to_match_both(self):
    with tenant_context(self.tenant.id):
        session_a = AcademicSessionFactory(tenant=self.tenant)
        session_b = AcademicSessionFactory(tenant=self.tenant)
        class_a = ClassFactory(tenant=self.tenant)
        class_b = ClassFactory(tenant=self.tenant)
        cross_row_student = StudentFactory(tenant=self.tenant, campus=self.campus)
        # Two enrollments on the same student: one matches session_a + class_b, the other
        # matches session_b + class_a. Neither single row matches (session_a AND class_a).
        StudentEnrollmentFactory(
            student=cross_row_student, academic_session=session_a, school_class=class_b,
        )
        StudentEnrollmentFactory(
            student=cross_row_student, academic_session=session_b, school_class=class_a,
        )
        matching_student = StudentFactory(tenant=self.tenant, campus=self.campus)
        StudentEnrollmentFactory(
            student=matching_student, academic_session=session_a, school_class=class_a,
        )

    response = self.client.get(
        "/api/v1/students",
        {"academic_session_id": str(session_a.id), "class_id": str(class_a.id)},
    )

    self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
    returned_ids = {row["id"] for row in response.json()["data"]}
    self.assertEqual(returned_ids, {str(matching_student.id)})
    self.assertNotIn(str(cross_row_student.id), returned_ids)

def test_session_filter_matches_a_past_non_active_enrollment(self):
    with tenant_context(self.tenant.id):
        past_session = AcademicSessionFactory(tenant=self.tenant)
        student = StudentFactory(tenant=self.tenant, campus=self.campus)
        StudentEnrollmentFactory(
            student=student, academic_session=past_session, status=EnrollmentStatus.PROMOTED,
        )

    response = self.client.get(
        "/api/v1/students", {"academic_session_id": str(past_session.id)}
    )

    self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
    self.assertIn(str(student.id), {row["id"] for row in response.json()["data"]})

def test_session_filter_excludes_a_soft_deleted_enrollment(self):
    with tenant_context(self.tenant.id):
        session = AcademicSessionFactory(tenant=self.tenant)
        student = StudentFactory(tenant=self.tenant, campus=self.campus)
        enrollment = StudentEnrollmentFactory(student=student, academic_session=session)
        enrollment.delete()  # soft delete

    response = self.client.get("/api/v1/students", {"academic_session_id": str(session.id)})

    self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
    self.assertNotIn(str(student.id), {row["id"] for row in response.json()["data"]})
```

(This third test is a deliberate, small second behavior change beyond the pure same-row fix,
decided during this plan's own review: `StudentFilterSet`'s existing joins have no soft-delete
exclusion today, and every other same-row enrollment join in this codebase uses `.alive()` —
leaving a soft-deleted enrollment matchable here would be a second, separate bug sitting next
to the one this task fixes. Both are fixed together since they're both in the same combined
filter method, with its own named test.)

In `CrossTenantEnrollmentTests`, add:

```python
def test_directory_filtered_by_session_excludes_foreign_tenant_match(self):
    other_tenant = TenantFactory()
    with tenant_context(other_tenant.id):
        foreign_session = AcademicSessionFactory(tenant=other_tenant)

    response = self.client.get(
        "/api/v1/students", {"academic_session_id": str(foreign_session.id)}
    )

    self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
    self.assertEqual(response.json()["data"], [])
```

- [ ] **Step 4: Fix `StudentFilterSet`**

Replace the three enrollment-joined fields with a combined `filter_queryset` override (not
three fields sharing one `method=`, which django-filter would call once per supplied param —
confirmed a real risk during this plan's review; a `filter_queryset` override runs the
combined check exactly once):

```python
from django.db.models import Exists, OuterRef

class StudentFilterSet(django_filters.FilterSet):
    campus_id = django_filters.UUIDFilter(field_name="campus_id")
    house_id = django_filters.UUIDFilter(field_name="house_id")
    academic_session_id = django_filters.UUIDFilter(method="noop")
    class_id = django_filters.UUIDFilter(method="noop")
    section_id = django_filters.UUIDFilter(method="noop")

    class Meta:
        model = Student
        fields = ["campus_id", "house_id", "status", "academic_session_id", "class_id", "section_id"]

    def noop(self, queryset, name, value):
        return queryset

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        cleaned = self.form.cleaned_data
        conditions = {}
        if cleaned.get("academic_session_id"):
            conditions["academic_session_id"] = cleaned["academic_session_id"]
        if cleaned.get("class_id"):
            conditions["school_class_id"] = cleaned["class_id"]
        if cleaned.get("section_id"):
            conditions["section_id"] = cleaned["section_id"]
        if not conditions:
            return queryset
        return queryset.filter(
            Exists(
                StudentEnrollment.objects.alive().filter(
                    student_id=OuterRef("pk"), **conditions
                )
            )
        )
```

(The three fields keep `method="noop"` — a no-op pass-through — purely so django-filter still
validates them as real UUIDs and still documents them as query params in the generated
OpenAPI schema, matching the existing behavior's parameter contract; the actual filtering
happens once, in the `filter_queryset` override, reading `self.form.cleaned_data` rather than
raw `self.data` so values are already validated/parsed UUIDs.)

Read all four new tests against this implementation and confirm each would fail before this
step and pass after, the same way the task reviewer will — do not run pytest.

- [ ] **Step 5: Regenerate the OpenAPI contract**

Run: `apps/api/scripts/generate-openapi.sh && pnpm --filter @schoolhub/api-client generate`.
This is a generation script, not a test run — it's required by `.claude/rules/api-contract.md`
regardless of whether the diff turns out to be empty (filter param names are unchanged).
Commit any resulting diff alongside this task's other changes.

- [ ] **Step 6: Commit**

Two commits — this is a `fix` (the filter correctness bug) and a `feat` (the new transfer
filter) in the same file, so split them with `git add -p` if the diffs are separable, or
combine into one `fix` commit with both described if they aren't:

```bash
git commit -m "$(cat <<'EOF'
fix(api): make directory session/class/section filters match one enrollment row

Root cause: StudentFilterSet applied academic_session_id/class_id/section_id as three
independent joins through enrollments__..., so combining two could match a student via two
different enrollment rows instead of one row satisfying both. Also excludes a soft-deleted
enrollment from matching, which the existing joins never did.
EOF
)"
git commit -m "feat(api): add student_id filter to student-transfers"
```

---

### Task 2: Backend — document the history endpoint's response shape

**Files:**
- Modify: `apps/api/apps/student_management/serializers.py`
- Modify: `apps/api/apps/student_management/views.py`
- Modify: `apps/api/apps/student_management/urls.py`
- Modify: `apps/api/config/settings/base.py` (`SPECTACULAR_SETTINGS["ENUM_NAME_OVERRIDES"]`,
  a dict of `{"EnumName": "dotted.path.to.Choices"}` entries — read the existing ones around
  line 229 to match the format exactly)
- Test: `apps/api/apps/student_management/tests/test_enrollment_transfers.py`

**Interfaces:**
- Consumes: `build_history(student)` (`services.py:909-964`) — its real emitted fields,
  confirmed by reading the function directly:
  - enrollment event: `type, id, date, status, academic_session_id, academic_session_name,
    class_id, class_name, section_id, section_name, roll_number`
  - transfer event: `type, id, date, status, transfer_type, from_campus_id,
    from_campus_name, to_campus_id, to_campus_name, external_school_name, reason`
  (Both use `date`, not `enrollment_date`/`effective_date` — a wrong field name this plan's
  own review caught. Transfer events already carry resolved campus *names*, not just ids.)
  `StudentViewSet.history` (views.py:330-332) currently: `def history(self, request,
  pk=None): student = self.get_object(); return ActionResponse.ok(build_history(student))` —
  no existing pagination/filter override. `StudentViewSet` class-level has
  `pagination_class = PageNumberPagination` and `filterset_class = StudentFilterSet`
  (views.py:87-89), which the `history` route inherits unless explicitly excluded.
- Produces: `EnrollmentHistoryEventSerializer`, `TransferHistoryEventSerializer`; the
  generated `ApiSchemas["StudentHistoryEvent"]` discriminated type.

- [ ] **Step 1: Write the failing test for the response shape**

```python
def test_history_response_matches_serializer_fields_exactly(self):
    with tenant_context(self.tenant.id):
        StudentEnrollmentFactory(student=self.student)
        StudentTransferFactory(student=self.student, tenant=self.tenant)

    response = self.client.get(f"/api/v1/students/{self.student.id}/history")

    self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
    events = response.json()["data"]
    self.assertGreaterEqual(len(events), 2)
    for event in events:
        if event["type"] == "enrollment":
            self.assertEqual(set(event.keys()), set(EnrollmentHistoryEventSerializer().fields.keys()))
        elif event["type"] == "transfer":
            self.assertEqual(set(event.keys()), set(TransferHistoryEventSerializer().fields.keys()))
        else:
            self.fail(f"unexpected event type: {event['type']!r}")
```

- [ ] **Step 2: Write the two serializers**

In `serializers.py`, next to `StudentEnrollmentSerializer`/`StudentTransferSerializer`:

```python
class EnrollmentHistoryEventSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=["enrollment"])
    id = serializers.UUIDField()
    date = serializers.DateField()
    status = serializers.ChoiceField(choices=EnrollmentStatus.choices)
    academic_session_id = serializers.UUIDField()
    academic_session_name = serializers.CharField()
    class_id = serializers.UUIDField()
    class_name = serializers.CharField()
    section_id = serializers.UUIDField()
    section_name = serializers.CharField()
    roll_number = serializers.CharField(allow_null=True)


class TransferHistoryEventSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=["transfer"])
    id = serializers.UUIDField()
    date = serializers.DateField()
    status = serializers.ChoiceField(choices=TransferStatus.choices)
    transfer_type = serializers.CharField()
    from_campus_id = serializers.UUIDField()
    from_campus_name = serializers.CharField()
    to_campus_id = serializers.UUIDField(allow_null=True)
    to_campus_name = serializers.CharField(allow_null=True)
    external_school_name = serializers.CharField(allow_null=True)
    reason = serializers.CharField()
```

(Confirm each field's real nullability against `build_history`'s exact construction, read in
full during Step 1's prep — the above is this plan's best-informed sketch, not a substitute
for reading the function; fix any field this plan got wrong once you see the real dict
construction.)

- [ ] **Step 3: Wire runtime dispatch, the documentation annotation, and exclude pagination**

In `views.py`:

```python
from drf_spectacular.utils import PolymorphicProxySerializer, extend_schema

_HISTORY_EVENT_SERIALIZERS = {
    "enrollment": EnrollmentHistoryEventSerializer,
    "transfer": TransferHistoryEventSerializer,
}

@extend_schema(
    responses=PolymorphicProxySerializer(
        component_name="StudentHistoryEvent",
        serializers=_HISTORY_EVENT_SERIALIZERS,
        resource_type_field_name="type",
        many=True,
    )
)
def history(self, request, pk=None):
    student = self.get_object()
    events = build_history(student)
    serialized = [
        _HISTORY_EVENT_SERIALIZERS[event["type"]](event).data for event in events
    ]
    return ActionResponse.ok(serialized)
```

`PolymorphicProxySerializer` is annotation-only (confirmed against the installed
drf-spectacular source) — the real runtime behavior is the plain dict dispatch above, not
anything the proxy serializer itself executes.

In `urls.py`, the `history` route currently is:

```python
path("students/<uuid:pk>/history", StudentViewSet.as_view({"get": "history"}), name="students-history"),
```

`StudentViewSet`'s class-level `pagination_class`/`filterset_class` would otherwise make
drf-spectacular document this list-shaped response as a *paginated, filterable* page (adding
`StudentFilterSet`'s params and a page wrapper to the generated schema) — a real leak this
plan's review found, confirmed already present elsewhere in this codebase for a similar
colon-action. Exclude both for this one route:

```python
path(
    "students/<uuid:pk>/history",
    StudentViewSet.as_view({"get": "history"}, pagination_class=None, filter_backends=[]),
    name="students-history",
),
```

- [ ] **Step 4: Add `ENUM_NAME_OVERRIDES`**

In `config/settings/base.py`'s `SPECTACULAR_SETTINGS["ENUM_NAME_OVERRIDES"]` dict (format
confirmed — dotted string path, e.g. existing entries like
`"PromotionDecisionEnum": "apps.academics.models.PromotionDecision"`), add:

```python
"StudentEnrollmentStatusEnum": "apps.student_management.models.EnrollmentStatus",
"StudentTransferStatusEnum": "apps.student_management.models.TransferStatus",
```

(`openapi.yaml` already has generated components named exactly these two — confirmed by
reading the current file — so these override names are correct, not guessed.)

- [ ] **Step 5: Regenerate the OpenAPI contract**

Run: `apps/api/scripts/generate-openapi.sh && pnpm --filter @schoolhub/api-client generate`.
Confirm the generated `history` operation is `type: array` of `StudentHistoryEvent` with only
the `id` path param and no pagination/filter query params — read the generated YAML/schema
diff directly to confirm, rather than assuming.

- [ ] **Step 6: Commit**

```bash
git add apps/api/apps/student_management/serializers.py apps/api/apps/student_management/views.py apps/api/apps/student_management/urls.py apps/api/config/settings/base.py apps/api/apps/student_management/tests/test_enrollment_transfers.py apps/api/openapi.yaml packages/api-client/src/schema.d.ts
git commit -m "feat(api): document GET /students/{id}/history's response shape"
```

- [ ] **Step 7: Push and confirm CI — first checkpoint**

Push the branch (`git push -u origin feat/students-phase3-enrollment` if not already
tracking). If a PR doesn't exist yet, open one now as a draft (`gh pr create --draft`) so CI
runs against this branch from here forward — per this repo's workflow, `api.yml` is
path-filtered and will run against these two backend commits. Read `gh pr checks` (or
`gh run list --branch feat/students-phase3-enrollment` if checks aren't listed yet) and fix
anything red before continuing to Task 3. This is the only way these two tasks' tests are
ever actually executed.

---

### Task 3: Dashboard Services — school-organization reference-data fetchers

**Files:**
- Modify: `apps/dashboard/src/services/modules/school-organization/school-organization-service.ts`
- Modify: `apps/dashboard/src/services/modules/school-organization/index.ts`
- Modify: `apps/dashboard/src/services/endpoints.ts` (the one central file)
- Modify: `apps/dashboard/src/services/modules/dashboard/dashboard-service.ts` (remove
  `fetchAcademicSessions` from here)
- Modify: `apps/dashboard/src/app/(app)/shell/dashboard/earnings-chart.tsx`
- Test: a new or existing `__tests__` file next to `school-organization-service.ts`

**Interfaces:**
- Consumes: the real current `school-organization-service.ts` (full file, 23 lines):
  ```ts
  import { fetchPage, MAX_PAGE_SIZE, type ApiSchemas } from "@schoolhub/api-client";
  import { apiClient } from "@/lib/auth";
  import { endpoints } from "@/services/endpoints";

  export type SchoolOrganizationOption = Pick<ApiSchemas["House"], "id" | "name">;

  export async function fetchHouses(): Promise<SchoolOrganizationOption[]> {
    const { items } = await fetchPage<SchoolOrganizationOption>(
      apiClient, endpoints.schoolOrganization.houses, { query: { page_size: MAX_PAGE_SIZE } },
    );
    return items;
  }
  ```
  and `dashboard-service.ts`'s real current `fetchAcademicSessions`:
  ```ts
  export interface AcademicSessionSummary { id: string; name: string; status: string; is_current: boolean; }
  export async function fetchAcademicSessions(): Promise<AcademicSessionSummary[]> {
    return collectPages<AcademicSessionSummary>(apiClient, endpoints.dashboard.academicSessions);
  }
  ```
  `endpoints.dashboard.classes`/`.sections`/`.academicSessions` already exist (used by
  dashboard-home's count widgets) — this task adds separate, new
  `endpoints.schoolOrganization.classes`/`.sections`/`.academicSessions` entries pointing at
  the same real paths for a different, option-list purpose; both sets of entries are valid,
  independent callers, not a duplication to clean up. `/classes` supports an `is_active`
  filter param (`ClassFilterSet` fields `["is_active", "level"]`); `/sections` supports
  `campus_id`/`class_id`/`is_active` (`SectionFilterSet`). Both use `PageNumberPagination`
  (default page size 25, `max_page_size` 100 via `page_size` query param).
- Produces: `fetchClasses(params?: { isActive?: boolean }): Promise<SchoolOrganizationOption[]>`;
  `fetchSections(params: { classId: string; campusId?: string; isActive?: boolean }):
  Promise<SchoolOrganizationOption[]>`; `fetchAcademicSessions(): Promise<
  AcademicSessionSummary[]>` (same interface as today, moved, `is_current` preserved — do
  not drop it, the first draft of this task did). Consumed by: Task 7 (`ClassSectionFields`),
  Task 12 (directory filters), `earnings-chart.tsx` (migrated in this task).

- [ ] **Step 1: Read both source files and `earnings-chart.tsx`'s current usage in full**

- [ ] **Step 2: Write the failing tests**

Match this module's existing (if any) or the codebase's standard mocking convention for
`fetchPage`/`collectPages` — likely mocking the `@schoolhub/api-client` module directly:

```ts
describe("fetchClasses", () => {
  it("returns id/name pairs, sending no is_active by default", async () => {
    const result = await fetchClasses();
    expect(result).toEqual([{ id: "class-1", name: "Grade 1" }]);
    // assert fetchPage's query did NOT include is_active
  });

  it("sends is_active when requested", async () => {
    await fetchClasses({ isActive: true });
    // assert fetchPage's query included is_active: true
  });
});

describe("fetchSections", () => {
  it("scopes by classId and campusId, sending is_active when requested", async () => {
    const result = await fetchSections({ classId: "class-1", campusId: "campus-1", isActive: true });
    // assert fetchPage was called with query { class_id: "class-1", campus_id: "campus-1", is_active: true, page_size: MAX_PAGE_SIZE }
    expect(result).toEqual([{ id: "section-1", name: "A" }]);
  });

  it("omits is_active and campus_id when not requested", async () => {
    await fetchSections({ classId: "class-1" });
    // assert the query has no is_active/campus_id keys at all
  });
});

describe("fetchAcademicSessions", () => {
  it("collects all cursor pages and preserves is_current", async () => {
    const result = await fetchAcademicSessions();
    expect(result).toEqual([{ id: "session-1", name: "2025-26", status: "open", is_current: true }]);
  });
});
```

- [ ] **Step 3: Add the endpoint registry entries**

In `endpoints.ts`, next to the existing `schoolOrganization: { houses: "/houses" }` block:

```ts
schoolOrganization: {
  houses: "/houses",
  classes: "/classes",
  sections: "/sections",
  academicSessions: "/academic-sessions",
},
```

- [ ] **Step 4: Implement the three fetchers**

```ts
export async function fetchClasses(
  params: { isActive?: boolean } = {}
): Promise<SchoolOrganizationOption[]> {
  const { items } = await fetchPage<SchoolOrganizationOption>(
    apiClient, endpoints.schoolOrganization.classes,
    { query: { page_size: MAX_PAGE_SIZE, ...(params.isActive !== undefined ? { is_active: params.isActive } : {}) } },
  );
  return items;
}

export async function fetchSections(
  params: { classId: string; campusId?: string; isActive?: boolean }
): Promise<SchoolOrganizationOption[]> {
  const { items } = await fetchPage<SchoolOrganizationOption>(
    apiClient, endpoints.schoolOrganization.sections,
    {
      query: {
        page_size: MAX_PAGE_SIZE,
        class_id: params.classId,
        ...(params.campusId ? { campus_id: params.campusId } : {}),
        ...(params.isActive !== undefined ? { is_active: params.isActive } : {}),
      },
    },
  );
  return items;
}

export async function fetchAcademicSessions(): Promise<AcademicSessionSummary[]> {
  return collectPages<AcademicSessionSummary>(apiClient, endpoints.schoolOrganization.academicSessions);
}
```

(Keep the exact `AcademicSessionSummary` interface — `{ id, name, status, is_current }` —
moved verbatim, not re-derived from `ApiSchemas` with fields dropped.)

- [ ] **Step 5: Remove `fetchAcademicSessions` from `dashboard-service.ts`**

Delete the function and its `AcademicSessionSummary` type from `dashboard-service.ts` (move
the type too — re-export it from `school-organization-service.ts` if anything else in
`dashboard-service.ts` still references the type name).

- [ ] **Step 6: Update `earnings-chart.tsx`**

Change its import from `Services.dashboard.fetchAcademicSessions` to
`Services.schoolOrganization.fetchAcademicSessions`, and its query key from the raw array
`["dashboard", "academic-sessions"]` to `queryKeys.list("school-organization",
"academic-sessions")` (confirm `queryKeys.list`'s real signature from an existing call site,
e.g. wherever `fetchHouses` is actually consumed, and match it exactly).

- [ ] **Step 7: Update `index.ts`**

Add `fetchClasses`/`fetchSections`/`fetchAcademicSessions` to this module's existing
`SchoolOrganizationService` export object, alongside `fetchHouses`.

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/services/modules/school-organization/ apps/dashboard/src/services/modules/dashboard/dashboard-service.ts apps/dashboard/src/services/endpoints.ts apps/dashboard/src/app/\(app\)/shell/dashboard/earnings-chart.tsx
git commit -m "feat(dashboard): add class/section/academic-session reference-data fetchers"
```

---

### Task 4: Dashboard Services — enroll, change-section, history

**Files:**
- Modify: `apps/dashboard/src/services/modules/students/students-service.ts`
- Modify: `apps/dashboard/src/services/modules/students/students-type.ts`
- Modify: `apps/dashboard/src/services/endpoints.ts`
- Test: this module's existing `__tests__` file (wherever `withdrawStudent`'s own test lives)

**Interfaces:**
- Consumes: `ApiSchemas["StudentHistoryEvent"]`/`["StudentEnrollment"]` (generated, from
  Task 2); `withdrawStudent`'s real exact pattern (`students-service.ts:68-79`):
  ```ts
  export async function withdrawStudent(id: string, input: WithdrawStudentInput, idempotencyKey: string): Promise<StudentRecord> {
    const { data } = await apiClient.post<StudentRecord>(
      endpoints.students.withdraw(id),
      { reason: input.reason, effective_date: input.effectiveDate, waive_clearance: false },
      { idempotencyKey },
    );
    return data;
  }
  ```
  The real server request bodies, confirmed from `serializers.py:335-347`:
  ```python
  class EnrollRequestSerializer(serializers.Serializer):
      academic_session_id = _fk(AcademicSession, source="academic_session")
      class_id = _fk(Class, source="school_class")
      section_id = _fk(Section, source="section")
      enrollment_date = serializers.DateField()
      roll_number = serializers.CharField(max_length=16, required=False, allow_null=True)
      capacity_override_reason = serializers.CharField(required=False, allow_null=True)

  class ChangeSectionRequestSerializer(serializers.Serializer):
      section_id = _fk(Section, source="section")
      roll_number = serializers.CharField(max_length=16, required=False, allow_null=True)
      capacity_override_reason = serializers.CharField(required=False, allow_null=True)
  ```
  **Change-section has no `class_id` field at all** — a real mismatch this plan's first draft
  had. `enroll` returns `StudentEnrollmentSerializer` data at **201**, not a `Student`.
- Produces:
  ```ts
  export interface EnrollStudentInput {
    academicSessionId: string; classId: string; sectionId: string;
    enrollmentDate: string; rollNumber?: string; capacityOverrideReason?: string;
  }
  export interface ChangeStudentSectionInput {
    sectionId: string; rollNumber?: string; capacityOverrideReason?: string;
  }
  export async function enrollStudent(studentId: string, input: EnrollStudentInput, idempotencyKey: string): Promise<ApiSchemas["StudentEnrollment"]>
  export async function changeStudentSection(studentId: string, input: ChangeStudentSectionInput, idempotencyKey: string): Promise<ApiSchemas["StudentEnrollment"]>
  export async function fetchStudentHistory(studentId: string): Promise<ApiSchemas["StudentHistoryEvent"][]>
  ```
  Consumed by: Task 8 (enroll/change-section dialogs — note `ChangeStudentSectionInput` has
  no class field; the dialog's UI still shows the student's current class, read-only, purely
  for display, never submitted), Task 11 (the orchestrator, via `fetchStudentHistory`).

- [ ] **Step 1: Write the failing tests**

```ts
describe("enrollStudent", () => {
  it("posts the mapped snake_case body with the given idempotency key", async () => {
    await enrollStudent("student-1", {
      academicSessionId: "s1", classId: "c1", sectionId: "sec1",
      enrollmentDate: "2026-11-01",
    }, "idem-key-1");
    // assert apiClient.post was called with (endpoints.students.enroll("student-1"),
    // { academic_session_id: "s1", class_id: "c1", section_id: "sec1", enrollment_date: "2026-11-01" },
    // { idempotencyKey: "idem-key-1" })
  });
});

describe("changeStudentSection", () => {
  it("posts only section_id, roll_number and capacity_override_reason — never class_id", async () => {
    await changeStudentSection("student-1", { sectionId: "sec1" }, "idem-key-2");
    // assert the posted body has no class_id key at all
  });
});

describe("fetchStudentHistory", () => {
  it("returns the history list for a student", async () => {
    const result = await fetchStudentHistory("student-1");
    expect(result).toEqual([{ type: "enrollment", status: "active", date: "2026-11-01" /* ...rest */ }]);
  });
});
```

- [ ] **Step 2: Add the endpoint entries**

In `endpoints.ts`'s `students` block:

```ts
students: {
  // ...existing, including withdraw...
  enroll: (id: string) => `/students/${id}:enroll`,
  changeSection: (id: string) => `/students/${id}:change-section`,
  history: (id: string) => `/students/${id}/history`,
},
```

- [ ] **Step 3: Implement the three functions**

```ts
export async function enrollStudent(
  studentId: string, input: EnrollStudentInput, idempotencyKey: string
): Promise<ApiSchemas["StudentEnrollment"]> {
  const { data } = await apiClient.post<ApiSchemas["StudentEnrollment"]>(
    endpoints.students.enroll(studentId),
    {
      academic_session_id: input.academicSessionId,
      class_id: input.classId,
      section_id: input.sectionId,
      enrollment_date: input.enrollmentDate,
      ...(input.rollNumber ? { roll_number: input.rollNumber } : {}),
      ...(input.capacityOverrideReason ? { capacity_override_reason: input.capacityOverrideReason } : {}),
    },
    { idempotencyKey },
  );
  return data;
}

export async function changeStudentSection(
  studentId: string, input: ChangeStudentSectionInput, idempotencyKey: string
): Promise<ApiSchemas["StudentEnrollment"]> {
  const { data } = await apiClient.post<ApiSchemas["StudentEnrollment"]>(
    endpoints.students.changeSection(studentId),
    {
      section_id: input.sectionId,
      ...(input.rollNumber ? { roll_number: input.rollNumber } : {}),
      ...(input.capacityOverrideReason ? { capacity_override_reason: input.capacityOverrideReason } : {}),
    },
    { idempotencyKey },
  );
  return data;
}

export async function fetchStudentHistory(studentId: string): Promise<ApiSchemas["StudentHistoryEvent"][]> {
  const { data } = await apiClient.get<ApiSchemas["StudentHistoryEvent"][]>(endpoints.students.history(studentId));
  return data;
}
```

(Confirm the exact GET-transport helper name — `apiClient.get<T>(path)` is this plan's
best-informed guess matching `apiClient.post`'s shape; verify against an existing GET call
in `students-service.ts`, e.g. the student-detail fetch, before use.)

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/services/modules/students/students-service.ts apps/dashboard/src/services/modules/students/students-type.ts apps/dashboard/src/services/endpoints.ts
git commit -m "feat(dashboard): add enroll, change-section and history to the students service"
```

---

### Task 5: Dashboard Services — new `studentTransfers` module

**Files:**
- Create: `apps/dashboard/src/services/modules/student-transfers/student-transfers-service.ts`
- Create: `apps/dashboard/src/services/modules/student-transfers/student-transfers-type.ts`
- Create: `apps/dashboard/src/services/modules/student-transfers/student-transfers-constant.ts`
- Create: `apps/dashboard/src/services/modules/student-transfers/student-transfers-helper.ts`
  (only if a real mapping helper is needed — don't manufacture one with no caller)
- Create: `apps/dashboard/src/services/modules/student-transfers/student-transfers.schema.ts`
- Create: `apps/dashboard/src/services/modules/student-transfers/index.ts`
- Modify: `apps/dashboard/src/services/endpoints.ts`
- Modify: `apps/dashboard/src/services/index.ts` — the real registration is a flat object:
  ```ts
  export const Services = {
    auth: AuthService, tenant: TenantService, dashboard: DashboardService,
    files: FilesService, jobs: JobsService, schoolOrganization: SchoolOrganizationService,
    guardians: GuardiansService, staff: StaffService, students: StudentsService,
  } as const;
  ```
  Add `studentTransfers: StudentTransfersService`, imported from
  `./modules/student-transfers`.
- Test: `__tests__/student-transfers-service.test.ts`,
  `__tests__/student-transfers.schema.test.ts` next to the new module

**Interfaces:**
- Consumes: `ApiSchemas["StudentTransfer"]`; the `guardians` module
  (`apps/dashboard/src/services/modules/guardians/`) as the real five-file-splitting
  precedent — read it to confirm what belongs in each file, matching ADR-0019.
- Produces: `Services.studentTransfers` export (`requestTransfer`, `fetchStudentTransfers`,
  `approveTransfer`, `rejectTransfer`, `completeTransfer`); `requestTransferFormSchema`.
  Consumed by: Task 9 (request/decision dialogs), Task 10 (complete dialog), Task 11
  (orchestrator's transfers list query).

- [ ] **Step 1: Read the `guardians` module's five files as the template**

- [ ] **Step 2: Write the failing schema tests**

```ts
describe("requestTransferFormSchema", () => {
  it("parses a valid inter_campus submission and omits external_school_name", () => {
    const result = requestTransferFormSchema.parse({
      transfer_type: "inter_campus", from_campus_id: "campus-1", to_campus_id: "campus-2",
      reason: "Family relocation", effective_date: "2026-11-01",
      external_school_name: "Should be stripped",
    });
    expect(result).not.toHaveProperty("external_school_name");
    expect(result.to_campus_id).toBe("campus-2");
  });

  it("parses a valid outgoing submission and omits to_campus_id", () => {
    const result = requestTransferFormSchema.parse({
      transfer_type: "outgoing", from_campus_id: "campus-1",
      external_school_name: "Another School", reason: "Relocating",
      effective_date: "2026-11-01", to_campus_id: "should be stripped",
    });
    expect(result).not.toHaveProperty("to_campus_id");
    expect(result.external_school_name).toBe("Another School");
  });

  it("rejects an inter_campus submission missing to_campus_id", () => {
    expect(() => requestTransferFormSchema.parse({
      transfer_type: "inter_campus", from_campus_id: "campus-1",
      reason: "x", effective_date: "2026-11-01",
    })).toThrow();
  });
});
```

- [ ] **Step 3: Write the failing service tests**

```ts
describe("fetchStudentTransfers", () => {
  it("fetches a single bounded page using MAX_PAGE_SIZE", async () => {
    const result = await fetchStudentTransfers("student-1");
    // assert fetchPage was called with query { student_id: "student-1", page_size: MAX_PAGE_SIZE }
    expect(result).toEqual([{ id: "transfer-1" /* ... */ }]);
  });
});

describe("requestTransfer", () => {
  it("posts with no idempotencyKey option", async () => {
    await requestTransfer("student-1", { transfer_type: "outgoing", /* ... */ });
    // assert apiClient.post was called with only (path, body) — no third options argument
  });
});

describe("approveTransfer / rejectTransfer / completeTransfer", () => {
  it("each post to their own colon-action with the given idempotency key", async () => {
    await approveTransfer("transfer-1", "idem-1");
    await rejectTransfer("transfer-1", "idem-2");
    await completeTransfer("transfer-1", { sectionId: "sec-1" }, "idem-3");
    // assert each hit its own path with its own { idempotencyKey }
  });
});
```

- [ ] **Step 4: Implement the five/six files**

`student-transfers-type.ts`: `StudentTransfer` (from `ApiSchemas`), `RequestTransferInput`
(the discriminated-union shape matching the schema below, camelCase), `CompleteTransferInput
{ sectionId?: string }`.

`student-transfers.schema.ts`:
```ts
const baseFields = { reason: z.string().min(1), effective_date: z.string().min(1) };
export const requestTransferFormSchema = z.discriminatedUnion("transfer_type", [
  z.object({
    transfer_type: z.literal("inter_campus"), from_campus_id: z.string().min(1),
    to_campus_id: z.string().min(1), ...baseFields,
  }),
  z.object({
    transfer_type: z.literal("outgoing"), from_campus_id: z.string().min(1),
    external_school_name: z.string().min(1), ...baseFields,
  }),
]);
```

`student-transfers-service.ts`:
```ts
export async function fetchStudentTransfers(studentId: string): Promise<StudentTransfer[]> {
  const { items } = await fetchPage<StudentTransfer>(
    apiClient, endpoints.studentTransfers.list, { query: { student_id: studentId, page_size: MAX_PAGE_SIZE } },
  );
  return items;
}

export async function requestTransfer(studentId: string, payload: RequestTransferInput): Promise<StudentTransfer> {
  const { data } = await apiClient.post<StudentTransfer>(
    endpoints.studentTransfers.create, { student_id: studentId, ...payload },
  );
  return data;
}

export async function approveTransfer(transferId: string, idempotencyKey: string): Promise<StudentTransfer> {
  const { data } = await apiClient.post<StudentTransfer>(endpoints.studentTransfers.approve(transferId), {}, { idempotencyKey });
  return data;
}

export async function rejectTransfer(transferId: string, idempotencyKey: string): Promise<StudentTransfer> {
  const { data } = await apiClient.post<StudentTransfer>(endpoints.studentTransfers.reject(transferId), {}, { idempotencyKey });
  return data;
}

export async function completeTransfer(transferId: string, payload: CompleteTransferInput, idempotencyKey: string): Promise<StudentTransfer> {
  const { data } = await apiClient.post<StudentTransfer>(
    endpoints.studentTransfers.complete(transferId),
    payload.sectionId ? { section_id: payload.sectionId } : {},
    { idempotencyKey },
  );
  return data;
}
```

In `endpoints.ts`, add a new top-level block mirroring the existing `studentDocuments` shape:

```ts
studentTransfers: {
  list: "/student-transfers",
  create: "/student-transfers",
  approve: (id: string) => `/student-transfers/${id}:approve`,
  reject: (id: string) => `/student-transfers/${id}:reject`,
  complete: (id: string) => `/student-transfers/${id}:complete`,
},
```

`index.ts`: re-export everything as `StudentTransfersService`, matching `guardians/
index.ts`'s exact pattern.

- [ ] **Step 5: Register in `services/index.ts`**

Add `studentTransfers: StudentTransfersService` to the flat `Services` object.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/services/modules/student-transfers/ apps/dashboard/src/services/endpoints.ts apps/dashboard/src/services/index.ts
git commit -m "feat(dashboard): add the student-transfers service module"
```

---

### Task 6: Dashboard — shared `ResponsiveAlertDialog`

**Files:**
- Create: `apps/dashboard/src/features/students/responsive-alert-dialog.tsx` (shared outside
  one feature, but this repo's existing precedent for a cross-feature dialog primitive is
  still found in `features/`, not a top-level `components/` — confirm by checking whether any
  existing shared-but-feature-adjacent component lives in a more central location before
  placing this; if one does, match it instead)
- Create: matching `__tests__` file
- Read (do not modify): `apps/dashboard/src/features/students/withdraw-student-dialog.tsx`
  (335 lines — the real, correctly-breakpointed precedent)

**Interfaces:**
- Consumes: `useIsDesktopShell()` from `@/hooks/use-is-desktop-shell`. The real desktop/mobile
  split pattern from `withdraw-student-dialog.tsx`:
  - Mobile: `<Drawer open onOpenChange dismissible={false}><DrawerContent role="alertdialog"
    closeLabel={tCommon("close")}>...` — `closeLabel` is a **required** string prop on
    `DrawerContent` (`packages/ui/src/components/drawer.tsx:126-129`).
  - Desktop: `<AlertDialog><AlertDialogContent>...<AlertDialogAction onClick={(event) => {
    event.preventDefault(); handleSubmit(event); }}>` — `preventDefault` plus a manual submit
    call is how this codebase avoids Radix's `AlertDialogAction` auto-closing the dialog
    before an async mutation resolves.
  - Error display: an inline `<Alert variant="destructive"><AlertDescription>...</Alert>`
    block, rendered conditionally in the shared body JSX — not a generic prop slot in the
    existing dialog, but this new shared component needs one (Tasks 9 and 10 both need to
    show a server error inside it), so add an `error?: string` prop rendered the same way.
- Produces: `ResponsiveAlertDialog({ open, onOpenChange, title, description, confirmLabel,
  onConfirm, isPending, error }): JSX.Element`. Consumed by:
  `transfer-decision-dialog.tsx` (Task 9), `complete-transfer-dialog.tsx`'s `outgoing`/
  no-active-enrollment branches (Task 10).

- [ ] **Step 1: Read `withdraw-student-dialog.tsx` in full**

- [ ] **Step 2: Write the failing tests**

```tsx
describe("ResponsiveAlertDialog", () => {
  it("renders the desktop AlertDialog primitive at desktop width", () => {
    mockIsDesktopShell(true);
    render(<ResponsiveAlertDialog open title="Confirm" description="Are you sure?" confirmLabel="Confirm" onConfirm={jest.fn()} isPending={false} onOpenChange={jest.fn()} />);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.queryByLabelText("close")).not.toBeInTheDocument(); // only the Drawer branch has a close button
  });

  it("renders the mobile Drawer primitive below the desktop-shell breakpoint", () => {
    mockIsDesktopShell(false);
    render(<ResponsiveAlertDialog open title="Confirm" description="Are you sure?" confirmLabel="Confirm" onConfirm={jest.fn()} isPending={false} onOpenChange={jest.fn()} />);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByLabelText("close")).toBeInTheDocument(); // the Drawer's required closeLabel button
  });

  it("calls onConfirm without closing before the mutation settles", async () => {
    const onConfirm = jest.fn();
    mockIsDesktopShell(true);
    render(<ResponsiveAlertDialog open title="Confirm" description="d" confirmLabel="Confirm" onConfirm={onConfirm} isPending={false} onOpenChange={jest.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("renders the error prop when set", () => {
    mockIsDesktopShell(true);
    render(<ResponsiveAlertDialog open title="Confirm" description="d" confirmLabel="Confirm" onConfirm={jest.fn()} isPending={false} onOpenChange={jest.fn()} error="Something went wrong" />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });
});
```

(`mockIsDesktopShell` is this plan's placeholder name for however `useIsDesktopShell` is
actually mocked in existing tests of components that use it — e.g. `withdraw-student-dialog`'s
own test file, if one exists, or `student-documents-tab.tsx`'s — confirm and reuse the real
helper/mock pattern rather than inventing a new one. Asserting on a `closeLabel`-produced
"close" accessible name, rather than a shared `alertdialog` role, is deliberately how this
task's tests distinguish the two rendered primitives — asserting the same role at both widths
was this plan's own first-draft mistake.)

- [ ] **Step 3: Implement the component**

```tsx
interface ResponsiveAlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  isPending: boolean;
  error?: string;
}

export function ResponsiveAlertDialog({
  open, onOpenChange, title, description, confirmLabel, onConfirm, isPending, error,
}: ResponsiveAlertDialogProps) {
  const isDesktop = useIsDesktopShell();
  const tCommon = useTranslations("common");

  const body = (
    <>
      {error && (
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
      )}
    </>
  );

  if (isDesktop) {
    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          {body}
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(event) => { event.preventDefault(); onConfirm(); }}
            >
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} dismissible={false}>
      <DrawerContent role="alertdialog" closeLabel={tCommon("close")}>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        {body}
        <DrawerFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tCommon("cancel")}</Button>
          <Button onClick={onConfirm} disabled={isPending}>{confirmLabel}</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
```

(Match every import — `AlertDialog*`, `Drawer*`, `Button`, `Alert`/`AlertDescription`,
`useTranslations` — to `withdraw-student-dialog.tsx`'s real imports exactly.)

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/features/students/responsive-alert-dialog.tsx apps/dashboard/src/features/students/__tests__/responsive-alert-dialog.test.tsx
git commit -m "feat(dashboard): add shared ResponsiveAlertDialog on useIsDesktopShell"
```

Do **not** migrate `exit-staff-dialog.tsx` (`apps/dashboard/src/features/staff/`) or
`student-documents-tab.tsx` onto this component anywhere in this plan — deferred to its own
follow-up `fix` PR (see the spec's Alternatives section).

---

### Task 7: Dashboard — shared `ClassSectionFields`

**Files:**
- Create: `apps/dashboard/src/features/students/class-section-fields.tsx`
- Create: matching `__tests__` file

**Interfaces:**
- Consumes: `Services.schoolOrganization.fetchClasses`/`fetchSections` (Task 3).
- Produces: `ClassSectionFields<TFieldValues extends FieldValues>({ form, campusId, locked
  }): JSX.Element` — generic over the real form-values type, not `UseFormReturn<any>` (a real
  lint-failure risk this plan's review flagged). `locked: true` renders the class as a fixed
  label (via a `currentClass: { id: string; name: string }` the caller passes, not a form
  field read back out of nowhere) and only the section select is interactive, scoped by
  `campusId` and `currentClass.id`, always sending `isActive: true`. `locked: false` renders
  both selects, section cascading off whichever class is chosen, both scoped by `campusId`,
  both sending `isActive: true`; changing the class resets the chosen section. Consumed by:
  Task 8 (unlocked for enroll; locked for change-section), Task 10 (locked, destination
  campus).

- [ ] **Step 1: Read an existing multi-field form component for the house style**

Read one existing shared field-group component under `apps/dashboard/src/features/students/`
(e.g. `student-address-fields.tsx`) to match `FormField`/`FormItem`/`Select` conventions.

- [ ] **Step 2: Write the failing tests**

```tsx
describe("ClassSectionFields", () => {
  it("unlocked: fetches sections scoped to the chosen class and campusId, with isActive true", async () => {
    render(<ClassSectionFields form={makeTestForm()} campusId="campus-1" locked={false} />);
    await userEvent.click(screen.getByLabelText("Class"));
    await userEvent.click(screen.getByText("Grade 1"));
    // assert fetchSections was called with { classId: "<grade-1-id>", campusId: "campus-1", isActive: true }
  });

  it("locked: renders currentClass as fixed text and only the section select is interactive", () => {
    render(<ClassSectionFields form={makeTestForm()} campusId="campus-2" locked currentClass={{ id: "class-1", name: "Grade 1" }} />);
    expect(screen.queryByLabelText("Class")).not.toBeInTheDocument();
    expect(screen.getByText("Grade 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Section")).toBeInTheDocument();
    // assert fetchSections was called with { classId: "class-1", campusId: "campus-2", isActive: true }
  });

  it("resets the chosen section when the class changes in unlocked mode", async () => {
    const form = makeTestForm();
    render(<ClassSectionFields form={form} campusId="campus-1" locked={false} />);
    await userEvent.click(screen.getByLabelText("Class"));
    await userEvent.click(screen.getByText("Grade 1"));
    await userEvent.click(screen.getByLabelText("Section"));
    await userEvent.click(screen.getByText("A"));
    await userEvent.click(screen.getByLabelText("Class"));
    await userEvent.click(screen.getByText("Grade 2"));
    expect(form.getValues("section_id")).toBe("");
  });
});
```

- [ ] **Step 3: Implement the component**

```tsx
interface ClassSectionFieldsProps<TFieldValues extends FieldValues> {
  form: UseFormReturn<TFieldValues>;
  campusId: string;
  locked: boolean;
  currentClass?: { id: string; name: string };
}

export function ClassSectionFields<TFieldValues extends FieldValues>({
  form, campusId, locked, currentClass,
}: ClassSectionFieldsProps<TFieldValues>) {
  const classId = locked ? currentClass?.id : form.watch("class_id" as Path<TFieldValues>);

  const { data: classes } = useQuery({
    queryKey: queryKeys.list("school-organization", "classes", { isActive: true }),
    queryFn: () => fetchClasses({ isActive: true }),
    enabled: !locked,
  });

  const { data: sections } = useQuery({
    queryKey: queryKeys.list("school-organization", "sections", { classId, campusId, isActive: true }),
    queryFn: () => fetchSections({ classId: classId as string, campusId, isActive: true }),
    enabled: Boolean(classId && campusId),
  });

  return (
    <>
      {locked ? (
        <FormItem>
          <FormLabel>Class</FormLabel>
          <p>{currentClass?.name}</p>
        </FormItem>
      ) : (
        <FormField
          control={form.control}
          name={"class_id" as Path<TFieldValues>}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Class</FormLabel>
              <Select
                onValueChange={(value) => {
                  field.onChange(value);
                  form.setValue("section_id" as Path<TFieldValues>, "" as PathValue<TFieldValues, Path<TFieldValues>>);
                }}
                value={field.value}
              >
                <SelectTrigger aria-label="Class"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {classes?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
      <FormField
        control={form.control}
        name={"section_id" as Path<TFieldValues>}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Section</FormLabel>
            <Select onValueChange={field.onChange} value={field.value} disabled={!classId}>
              <SelectTrigger aria-label="Section"><SelectValue /></SelectTrigger>
              <SelectContent>
                {sections?.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
```

(Match every `Form*`/`Select*` import to this codebase's real shared form primitives,
confirmed in Step 1.)

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/features/students/class-section-fields.tsx apps/dashboard/src/features/students/__tests__/class-section-fields.test.tsx
git commit -m "feat(dashboard): add shared ClassSectionFields for enroll/change-section/complete"
```

- [ ] **Step 5: Push and confirm CI — second checkpoint**

Push. Read `gh pr checks` and fix anything red (Jest/lint/typecheck for Tasks 3-7) before
continuing to Task 8.

---

### Task 8: Dashboard — `enroll-dialog.tsx` and `change-section-dialog.tsx`

**Files:**
- Create: `apps/dashboard/src/features/students/enroll-dialog.tsx`
- Create: `apps/dashboard/src/features/students/change-section-dialog.tsx`
- Create: matching `__tests__` files for both
- Modify: `apps/dashboard/messages/en.json`, `apps/dashboard/messages/ur.json`

**Interfaces:**
- Consumes: `Services.students.enrollStudent`/`changeStudentSection` (Task 4);
  `ClassSectionFields` (Task 7); `Services.schoolOrganization.fetchAcademicSessions`
  (Task 3, filtered to exclude `closed`/`archived` status); `useGuardedSubmit`
  (`apps/dashboard/src/hooks/use-submit-guard.ts`, real signature confirmed:
  `useGuardedSubmit<TFieldValues>(form, submitGuard, onValid): (event) => void`, paired with
  `useSubmitGuard(): { guard }`); `applyServerFieldErrors` (read its real signature from an
  existing Phase 2 dialog, e.g. `guardian-form-dialog.tsx`).
- Produces: `EnrollDialog({ studentId, campusId, currentCampusName, canEnroll,
  canOverrideCapacity, open, onOpenChange })`, `ChangeSectionDialog({ studentId, campusId,
  currentClass, canChangeSection, canOverrideCapacity, open, onOpenChange })`. **Permission
  props are named for exactly what they gate** — `canEnroll` maps to
  `students.enrollment.enroll`, `canChangeSection` to `students.enrollment.update`,
  `canOverrideCapacity` to `students.student.update` (a separate server-side check inside
  the action, not the action's own gate — confirmed from `views.py:124-133`, which maps
  `required_permission_map = {"enroll": "students.enrollment.enroll", "change_section":
  "students.enrollment.update", ...}`; `students.student.update` is checked internally via
  `has_permission_key(request.user, "students.student.update")`, passed through as
  `actor_has_capacity_override`). A caller can hold `canEnroll` without `canOverrideCapacity`
  — test both independently, not as one combined flag. Consumed by: Task 11.

- [ ] **Step 1: Read `useGuardedSubmit`/`useSubmitGuard`, `applyServerFieldErrors`, and
  `withdraw-student-dialog.tsx` end to end**

- [ ] **Step 2: Write the failing tests for `EnrollDialog`**

```tsx
describe("EnrollDialog", () => {
  it("shows Enroll when canEnroll, hides it when not", () => {
    const { rerender } = render(<EnrollDialog studentId="s1" campusId="campus-1" currentCampusName="Main" canEnroll canOverrideCapacity open onOpenChange={jest.fn()} />);
    expect(screen.getByRole("button", { name: /enroll/i })).toBeInTheDocument();
    rerender(<EnrollDialog studentId="s1" campusId="campus-1" currentCampusName="Main" canEnroll={false} canOverrideCapacity open onOpenChange={jest.fn()} />);
    expect(screen.queryByRole("button", { name: /enroll/i })).not.toBeInTheDocument();
  });

  it("shows the capacity-override-reason field unconditionally when canOverrideCapacity, independent of canEnroll", () => {
    render(<EnrollDialog studentId="s1" campusId="campus-1" currentCampusName="Main" canEnroll canOverrideCapacity open onOpenChange={jest.fn()} />);
    expect(screen.getByLabelText(/override reason/i)).toBeInTheDocument();
  });

  it("hides the override-reason field when the caller cannot override capacity, even though they can enroll", () => {
    render(<EnrollDialog studentId="s1" campusId="campus-1" currentCampusName="Main" canEnroll canOverrideCapacity={false} open onOpenChange={jest.fn()} />);
    expect(screen.queryByLabelText(/override reason/i)).not.toBeInTheDocument();
  });

  it("submits enrollStudent with a fresh idempotency key generated on open", async () => {
    // fill session/class/section/date, submit, assert enrollStudent was called with a
    // string idempotencyKey
  });

  it("maps a 422 capacity error onto the non_field form message via applyServerFieldErrors", async () => {
    // mock enrollStudent to reject with the real DomainRuleViolation shape, submit, assert
    // the form shows the server's message
  });

  it("maps a 409 duplicate-roll-number conflict onto the existing generic conflict copy", async () => {
    // mock enrollStudent to reject with a 409, submit, assert the generic conflict message appears
  });

  it("invalidates the history and directory-list query keys on a successful submit", async () => {
    // mock enrollStudent to resolve, submit, assert queryClient.invalidateQueries was
    // called with queryKeys.list("students", "history", { studentId }) and the directory
    // list's own key
  });
});
```

Mirror the same seven tests' shapes for `ChangeSectionDialog`, substituting
`changeStudentSection`/`canChangeSection` and its locked-class picker; its own invalidation
test asserts the same two keys.

- [ ] **Step 3: Implement `EnrollDialog`**

A `ResponsiveDialog` (nested, matching Phase 2's `nested` prop usage) containing: an academic
session `Select` (from `fetchAcademicSessions`, filtered to exclude `closed`/`archived`
status), `ClassSectionFields` (`locked={false}`, `campusId` from props), an enrollment-date
field, a roll-number field, and — when `canOverrideCapacity` — a `capacity_override_reason`
textarea, always rendered, never conditionally shown based on a prior error. Hidden entirely
(not just disabled) when `!canEnroll`. Submit via `useGuardedSubmit`, calling
`enrollStudent(studentId, values, crypto.randomUUID())` generated once when the dialog opens.
On error, `applyServerFieldErrors` maps `non_field` to the form's root error display and
`capacity_override_reason` to that field (422 capacity/prerequisite → non_field; 409
duplicate roll number → generic conflict copy). On success, invalidate
`queryKeys.list("students", "history", { studentId })` and the student directory list's
existing query key.

- [ ] **Step 4: Implement `ChangeSectionDialog`**

Same shape, `ClassSectionFields` with `locked={true}` and `currentClass` fed in (display
only — never submitted, since `ChangeSectionRequestSerializer` has no `class_id` field), no
session field, no roll-number field unless confirmed otherwise against
`ChangeSectionRequestSerializer` (it does accept `roll_number` — include it). Hidden entirely
when `!canChangeSection`. Same two invalidations on success as `EnrollDialog`.

- [ ] **Step 5: Add the new i18n keys**

Add every label/placeholder/error string both dialogs use under the pre-seeded
`students.enrollment` namespace in `en.json`/`ur.json` — confirm the exact existing key names
under it and reuse them rather than inventing duplicates.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/features/students/enroll-dialog.tsx apps/dashboard/src/features/students/change-section-dialog.tsx apps/dashboard/src/features/students/__tests__/enroll-dialog.test.tsx apps/dashboard/src/features/students/__tests__/change-section-dialog.test.tsx apps/dashboard/messages/en.json apps/dashboard/messages/ur.json
git commit -m "feat(dashboard): add enroll and change-section dialogs"
```

---

### Task 9: Dashboard — `request-transfer-dialog.tsx` and `transfer-decision-dialog.tsx`

**Files:**
- Create: `apps/dashboard/src/features/students/request-transfer-dialog.tsx`
- Create: `apps/dashboard/src/features/students/transfer-decision-dialog.tsx`
- Create: matching `__tests__` files for both
- Modify: `apps/dashboard/messages/en.json`, `apps/dashboard/messages/ur.json` (including
  fixing `transfers.requestDescription`'s existing copy, which currently advertises
  "incoming" transfers — remove that mention)

**Interfaces:**
- Consumes: `Services.studentTransfers.requestTransfer`/`approveTransfer`/`rejectTransfer`
  (Task 5); `requestTransferFormSchema` (Task 5); `ResponsiveAlertDialog` (Task 6, now with
  an `error` prop); `Services.dashboard.fetchCampuses()` (unchanged — still under
  `dashboard`, matching the real code; campus relocation is a separate, already-queued
  Roadmap item this phase doesn't do).
- Produces: `RequestTransferDialog({ studentId, currentCampusId, canRequestTransfer, open,
  onOpenChange })`, `TransferDecisionDialog({ transferId, studentId, decision,
  canDecide, open, onOpenChange })` (`studentId` is needed only to build the invalidation
  keys, not for the request itself; `canDecide` gates `students.transfer.approve`).
  Consumed by: Task 11.

- [ ] **Step 1: Write the failing tests for `RequestTransferDialog`**

```tsx
describe("RequestTransferDialog", () => {
  it("offers only inter_campus and outgoing as transfer-type options", () => {
    render(<RequestTransferDialog studentId="s1" currentCampusId="campus-1" canRequestTransfer open onOpenChange={jest.fn()} />);
    const options = screen.getAllByRole("radio");
    expect(options.map((o) => o.getAttribute("value"))).toEqual(["inter_campus", "outgoing"]);
  });

  it("renders from_campus_id as a read-only label matching the student's current campus, never an editable field", () => {
    render(<RequestTransferDialog studentId="s1" currentCampusId="campus-1" canRequestTransfer open onOpenChange={jest.fn()} />);
    expect(screen.queryByRole("combobox", { name: /from campus/i })).not.toBeInTheDocument();
  });

  it("excludes the current campus from the to_campus_id picker's options", async () => {
    render(<RequestTransferDialog studentId="s1" currentCampusId="campus-1" canRequestTransfer open onOpenChange={jest.fn()} />);
    await userEvent.click(screen.getByText(/inter.campus/i));
    await userEvent.click(screen.getByLabelText(/to campus/i));
    expect(screen.queryByText("Campus One")).not.toBeInTheDocument();
  });

  it("submits requestTransfer with no idempotency key", async () => {
    // fill and submit the outgoing branch, assert requestTransfer was called with
    // exactly (studentId, payload) — no third argument
  });

  it("invalidates the transfers and history query keys on a successful submit", async () => {
    // mock requestTransfer to resolve, submit, assert both
    // queryKeys.list("student-transfers", "transfers", { studentId }) and
    // queryKeys.list("students", "history", { studentId }) were invalidated
  });

  it("hides the whole trigger when canRequestTransfer is false", () => {
    render(<RequestTransferDialog studentId="s1" currentCampusId="campus-1" canRequestTransfer={false} open={false} onOpenChange={jest.fn()} />);
    expect(screen.queryByRole("button", { name: /request transfer/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write the failing tests for `TransferDecisionDialog`**

```tsx
describe("TransferDecisionDialog", () => {
  it("renders via ResponsiveAlertDialog", () => {
    render(<TransferDecisionDialog transferId="t1" studentId="s1" decision="approve" canDecide open onOpenChange={jest.fn()} />);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("calls approveTransfer with a fresh idempotency key when decision is approve", async () => {
    render(<TransferDecisionDialog transferId="t1" studentId="s1" decision="approve" canDecide open onOpenChange={jest.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /approve/i }));
    // assert approveTransfer was called with ("t1", <uuid string>)
  });

  it("calls rejectTransfer with a fresh idempotency key when decision is reject", async () => {
    render(<TransferDecisionDialog transferId="t1" studentId="s1" decision="reject" canDecide open onOpenChange={jest.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /reject/i }));
  });

  it("maps a segregation-of-duties 422 onto the dialog's error prop, without closing", async () => {
    // mock rejectTransfer or approveTransfer to reject with the real DomainRuleViolation
    // shape, click confirm, assert ResponsiveAlertDialog receives the server's message via
    // its error prop and the dialog is still open
  });

  it("invalidates the transfers and history query keys on a successful decision", async () => {
    // assert both keys invalidated for both approve and reject
  });
});
```

- [ ] **Step 3: Implement `RequestTransferDialog`**

A `ResponsiveDialog` (nested) with a transfer-type radio control (`inter_campus`/`outgoing`
only), `requestTransferFormSchema`-validated via RHF, a read-only `from_campus_id` display
(the student's own campus name, resolved from the already-cached `Services.dashboard.
fetchCampuses()` list), the `inter_campus` branch's `to_campus_id` picker (from
`fetchCampuses()`, filtered to exclude `currentCampusId`), the `outgoing` branch's
`external_school_name` field, shared `reason`/`effective_date` fields. Hidden entirely when
`!canRequestTransfer`. Submit via `useGuardedSubmit` calling `requestTransfer(studentId,
values)` — no idempotency key. On success, invalidate `queryKeys.list("student-transfers",
"transfers", { studentId })` and `queryKeys.list("students", "history", { studentId })`.

- [ ] **Step 4: Implement `TransferDecisionDialog`**

Built on `ResponsiveAlertDialog`: `title`/`description` vary by `decision`, hidden entirely
when `!canDecide`, `onConfirm` calls `approveTransfer(transferId, crypto.randomUUID())` or
`rejectTransfer(transferId, crypto.randomUUID())` depending on `decision`, a fresh key
generated each time the dialog opens (mount a fresh instance per open, matching
`withdraw-student-dialog.tsx`'s own pattern at lines 65-81, rather than regenerating the key
inside a `useEffect`). On error, pass the server's message to `ResponsiveAlertDialog`'s
`error` prop rather than closing. On success, invalidate the same two keys as
`RequestTransferDialog`, built from the `studentId` prop.

- [ ] **Step 5: Fix `transfers.requestDescription` and add new i18n keys**

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/features/students/request-transfer-dialog.tsx apps/dashboard/src/features/students/transfer-decision-dialog.tsx apps/dashboard/src/features/students/__tests__/request-transfer-dialog.test.tsx apps/dashboard/src/features/students/__tests__/transfer-decision-dialog.test.tsx apps/dashboard/messages/en.json apps/dashboard/messages/ur.json
git commit -m "feat(dashboard): add request-transfer and transfer-decision dialogs"
```

---

### Task 10: Dashboard — `complete-transfer-dialog.tsx`

**Files:**
- Create: `apps/dashboard/src/features/students/complete-transfer-dialog.tsx`
- Create: matching `__tests__` file
- Modify: `apps/dashboard/messages/en.json`, `apps/dashboard/messages/ur.json`

**Interfaces:**
- Consumes: `Services.studentTransfers.completeTransfer` (Task 5); `ClassSectionFields`
  (Task 7, `locked={true}`); `ResponsiveAlertDialog` (Task 6). Real `complete_transfer`
  behavior, confirmed from `services.py:833-906`: for `inter_campus`, if the student has an
  active enrollment, a `section` is **required** (raises `DomainRuleViolation({"section_id":
  "A destination section is required..."})` if omitted) and must belong to the transfer's
  `to_campus_id` (raises `DomainRuleViolation({"section_id": "Section does not belong to the
  destination campus."})` otherwise); if there is **no** active enrollment, the server
  silently skips reassignment entirely (no class check, no capacity check, no error) and
  only updates `student.campus`. Capacity is checked via `_assert_capacity(...,
  capacity_override_reason=None, actor_has_capacity_override=False)` — no override path
  exists, ever, for this action.
- Produces: `CompleteTransferDialog({ transfer, currentEnrollmentClass, canComplete, open,
  onOpenChange })` — `currentEnrollmentClass: { id: string; name: string } | null`, passed by
  the orchestrator (Task 11) from its already-derived current-enrollment data; `null` means
  the student has no active enrollment right now. The caller (Task 11) never renders this
  component for an `incoming`-type transfer at all — it is not this component's own job to
  guard against that, avoiding a conditional-return-before-hooks shape. Consumed by: Task 11.

**Ruling on the no-active-enrollment case** (left open by this plan's review, decided here):
show a plain confirm with explanatory copy ("this student has no active enrollment — only
the campus will be updated") and **no section picker at all**, rather than an unlocked
picker — the server ignores any section it's sent in this case, so collecting one would be
actively misleading about what the action does.

- [ ] **Step 1: Write the failing tests**

```tsx
describe("CompleteTransferDialog", () => {
  it("inter_campus with an active enrollment: requires a section, locked to the current class, scoped to to_campus_id", () => {
    render(<CompleteTransferDialog transfer={makeInterCampusTransfer()} currentEnrollmentClass={{ id: "class-1", name: "Grade 1" }} canComplete open onOpenChange={jest.fn()} />);
    expect(screen.getByRole("button", { name: /complete/i })).toBeDisabled();
    expect(screen.getByText("Grade 1")).toBeInTheDocument();
    // assert ClassSectionFields received campusId === transfer.to_campus_id
  });

  it("inter_campus with an active enrollment: submits completeTransfer with the chosen section_id and a fresh idempotency key", async () => {
    render(<CompleteTransferDialog transfer={makeInterCampusTransfer()} currentEnrollmentClass={{ id: "class-1", name: "Grade 1" }} canComplete open onOpenChange={jest.fn()} />);
    // pick a section, click Complete, assert completeTransfer was called with
    // (transfer.id, { sectionId: "<chosen>" }, <uuid string>)
  });

  it("inter_campus with no active enrollment: shows a plain confirm with explanatory copy and no section field", () => {
    render(<CompleteTransferDialog transfer={makeInterCampusTransfer()} currentEnrollmentClass={null} canComplete open onOpenChange={jest.fn()} />);
    expect(screen.queryByLabelText("Section")).not.toBeInTheDocument();
    expect(screen.getByText(/only the campus will be updated/i)).toBeInTheDocument();
  });

  it("inter_campus with no active enrollment: submits completeTransfer with no section_id", async () => {
    render(<CompleteTransferDialog transfer={makeInterCampusTransfer()} currentEnrollmentClass={null} canComplete open onOpenChange={jest.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /complete/i }));
    // assert completeTransfer was called with (transfer.id, {}, <uuid string>)
  });

  it("outgoing: renders a plain confirm with no section field regardless of currentEnrollmentClass", () => {
    render(<CompleteTransferDialog transfer={makeOutgoingTransfer()} currentEnrollmentClass={{ id: "class-1", name: "Grade 1" }} canComplete open onOpenChange={jest.fn()} />);
    expect(screen.queryByLabelText("Section")).not.toBeInTheDocument();
  });

  it("hides the whole trigger when canComplete is false", () => {
    render(<CompleteTransferDialog transfer={makeInterCampusTransfer()} currentEnrollmentClass={null} canComplete={false} open={false} onOpenChange={jest.fn()} />);
    expect(screen.queryByRole("button", { name: /complete/i })).not.toBeInTheDocument();
  });

  it("maps a capacity-exceeded 422 to the error display with no override option anywhere", async () => {
    // mock completeTransfer to reject with the real DomainRuleViolation shape, submit,
    // assert the error shows and no capacity_override_reason field is ever rendered
  });

  it("invalidates transfers, history, the student detail query and the directory list on success", async () => {
    // assert all four keys named in the spec's Invalidation paragraph for Complete
  });
});
```

(`CompleteTransferDialog` never renders for `incoming` — there is no test for it here because
the orchestrator simply never mounts this component for that transfer type; see Task 11.)

- [ ] **Step 2: Implement the component — all hooks called unconditionally, branching only
  in the returned JSX**

```tsx
export function CompleteTransferDialog({
  transfer, currentEnrollmentClass, canComplete, open, onOpenChange,
}: CompleteTransferDialogProps) {
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  useEffect(() => {
    if (open) idempotencyKeyRef.current = crypto.randomUUID();
  }, [open]);

  const form = useForm<{ section_id?: string }>({ defaultValues: { section_id: "" } });
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (payload: CompleteTransferInput) =>
      completeTransfer(transfer.id, payload, idempotencyKeyRef.current),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.list("student-transfers", "transfers", { studentId: transfer.student_id }) });
      queryClient.invalidateQueries({ queryKey: queryKeys.list("students", "history", { studentId: transfer.student_id }) });
      queryClient.invalidateQueries({ queryKey: queryKeys.detail("students", transfer.student_id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.list("students", "directory") });
      onOpenChange(false);
    },
  });

  if (!canComplete) {
    return null;
  }

  const needsSectionPicker = transfer.transfer_type === "inter_campus" && currentEnrollmentClass !== null;

  if (!needsSectionPicker) {
    return (
      <ResponsiveAlertDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Complete transfer"
        description={
          transfer.transfer_type === "inter_campus"
            ? "This student has no active enrollment — only the campus will be updated."
            : "This marks the transfer as completed."
        }
        confirmLabel="Complete"
        isPending={mutation.isPending}
        error={mutation.error ? getServerErrorMessage(mutation.error) : undefined}
        onConfirm={() => mutation.mutate({})}
      />
    );
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} nested>
      <Form {...form}>
        <ClassSectionFields form={form} campusId={transfer.to_campus_id} locked currentClass={currentEnrollmentClass} />
        <Button
          type="button"
          disabled={!form.watch("section_id") || mutation.isPending}
          onClick={() => mutation.mutate({ sectionId: form.getValues("section_id") })}
        >
          Complete
        </Button>
      </Form>
    </ResponsiveDialog>
  );
}
```

(`!canComplete` returning `null` is fine here since it's the *first* statement after every
hook has already been called unconditionally above it — this is what distinguishes it from
the Rules-of-Hooks violation this plan's review found in an earlier draft, where a
transfer-type check returned early *before* any hooks ran. Confirm `getServerErrorMessage`'s
real name/import from wherever `applyServerFieldErrors`'s sibling helper for a root-level
error message lives, used in Task 8/9's error mapping.)

- [ ] **Step 3: Add i18n keys**

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/features/students/complete-transfer-dialog.tsx apps/dashboard/src/features/students/__tests__/complete-transfer-dialog.test.tsx apps/dashboard/messages/en.json apps/dashboard/messages/ur.json
git commit -m "feat(dashboard): add complete-transfer dialog"
```

---

### Task 11: Dashboard — `student-enrollment-tab.tsx` orchestrator + sheet wiring

**Files:**
- Create: `apps/dashboard/src/features/students/student-enrollment-tab.tsx`
- Create: matching `__tests__` file
- Modify: `apps/dashboard/src/features/students/student-detail-sheet.tsx`

**Interfaces:**
- Consumes: `fetchStudentHistory` (Task 4), `fetchStudentTransfers` (Task 5), every dialog
  from Tasks 8–10. `build_history`'s real field is `date`, not `enrollment_date` — a wrong
  field name this plan's review caught. `active_enrollment()`'s real implementation assumes
  at most one active row and has no tie-break logic of its own; this tab's own derivation
  stays defensive (pick the latest `date` if more than one somehow matches) as a client-side
  safety net, not because the server is known to ever actually return two.
- Produces: `StudentEnrollmentTab({ student, permissions })`, wired into
  `student-detail-sheet.tsx`'s tab list as `"Enrollment"`.

- [ ] **Step 1: Read `student-detail-sheet.tsx`'s existing tab-wiring pattern**

- [ ] **Step 2: Write the failing tests**

```tsx
describe("StudentEnrollmentTab", () => {
  it("derives current enrollment as the active-status event with the latest date on ties", () => {
    // mock fetchStudentHistory to return two "active" enrollment events with different
    // date values plus a transfer event; render; assert the one with the later date shows
  });

  it("shows a Not Enrolled state with an Enroll action when no enrollment event exists", () => {
    render(<StudentEnrollmentTab student={makeStudent()} permissions={allGranted()} />);
    expect(screen.getByText(/not enrolled/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enroll/i })).toBeInTheDocument();
  });

  it("current enrollment and the history timeline share one query and fail/retry together", async () => {
    // mock fetchStudentHistory to reject; assert both the current-enrollment card and the
    // timeline show the same error/retry state
  });

  it("the transfers list fails and retries independently of history", async () => {
    // mock fetchStudentHistory to succeed and fetchStudentTransfers to reject; assert the
    // current-enrollment card and timeline render fine while only transfers show an error
  });

  it("never renders CompleteTransferDialog for an incoming-type transfer", () => {
    // mock fetchStudentTransfers to include one incoming transfer; assert no Complete
    // trigger/dialog is ever mounted for it
  });

  it("hides every action whose permission is not granted", () => {
    render(<StudentEnrollmentTab student={makeStudent()} permissions={noneGranted()} />);
    expect(screen.queryByRole("button", { name: /enroll/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /request transfer/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Implement the orchestrator**

```tsx
export function StudentEnrollmentTab({ student, permissions }: StudentEnrollmentTabProps) {
  const historyQuery = useQuery({
    queryKey: queryKeys.list("students", "history", { studentId: student.id }),
    queryFn: () => fetchStudentHistory(student.id),
  });

  const transfersQuery = useQuery({
    queryKey: queryKeys.list("student-transfers", "transfers", { studentId: student.id }),
    queryFn: () => fetchStudentTransfers(student.id),
  });

  const currentEnrollment = useMemo(() => {
    const active = (historyQuery.data ?? []).filter(
      (event) => event.type === "enrollment" && event.status === "active"
    );
    if (active.length === 0) return null;
    return active.reduce((latest, event) => (event.date > latest.date ? event : latest));
  }, [historyQuery.data]);

  const currentEnrollmentClass = currentEnrollment
    ? { id: currentEnrollment.class_id, name: currentEnrollment.class_name }
    : null;

  // Render: a current-enrollment card (or "Not Enrolled" + Enroll button, gated on
  // permissions.canEnroll) and the Enroll/Change-Section dialogs from Task 8, both driven
  // by historyQuery's loading/error state; a history timeline list, driven by the same
  // query; a transfers section with its own loading/error state from transfersQuery,
  // listing each transfer with Approve/Reject/Complete buttons gated on their own
  // permission props. CompleteTransferDialog is only ever rendered for a transfer whose
  // transfer.transfer_type !== "incoming" — filter the transfers list's render, not
  // CompleteTransferDialog's own body, for this.
}
```

- [ ] **Step 4: Wire into `student-detail-sheet.tsx`**

Add the new "Enrollment" tab, gated on `students.student.view`, passing down `canEnroll`
(`students.enrollment.enroll`), `canChangeSection` (`students.enrollment.update`),
`canOverrideCapacity` (`students.student.update`), `canRequestTransfer`
(`students.transfer.create`), `canDecide` (`students.transfer.approve`), `canComplete`
(`students.transfer.create`) — matching the other three tabs' existing per-action
permission-threading pattern.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/features/students/student-enrollment-tab.tsx apps/dashboard/src/features/students/__tests__/student-enrollment-tab.test.tsx apps/dashboard/src/features/students/student-detail-sheet.tsx
git commit -m "feat(dashboard): add the Enrollment tab to the student detail sheet"
```

---

### Task 12: Dashboard — student directory filters

**Files:**
- Modify: `apps/dashboard/src/features/students/student-directory-filters.tsx`
- Modify: `apps/dashboard/src/features/students/student-directory-table.tsx`
- Modify: `apps/dashboard/src/services/modules/students/students-type.ts`
  (`StudentsPageQuery`)
- Modify: `apps/dashboard/src/services/modules/students/students-constant.ts`
  (`STUDENTS_QUERY_FIELDS`)
- Modify matching `__tests__` files

**Interfaces:**
- Consumes: `Services.schoolOrganization.fetchClasses`/`fetchSections`/
  `fetchAcademicSessions` (Task 3, called with **no** `isActive` — the directory-filter
  scoping rule). The real current prop shape of `student-directory-filters.tsx`: individual
  `value`/`onChange` pairs, not a filter-state object — `campusId: string;
  onCampusIdChange: (value: string) => void; houseId: string; onHouseIdChange: (value:
  string) => void;` etc. Campus options come from `Services.dashboard.fetchCampuses()`
  (unchanged). The real `STUDENTS_QUERY_FIELDS` map (`students-constant.ts:51-57`):
  ```ts
  export const STUDENTS_QUERY_FIELDS: ReadonlyArray<readonly [keyof StudentsPageQuery, string]> = [
    ["search", "search"], ["ordering", "ordering"], ["status", "status"],
    ["campusId", "campus_id"], ["houseId", "house_id"],
  ];
  ```
  driven by `toStudentsQueryParams` (`students-helper.ts:54-58`, via `copyMappedFields`).
- Produces: three new same-shaped prop pairs (`academicSessionId`/
  `onAcademicSessionIdChange`, `classId`/`onClassIdChange`, `sectionId`/
  `onSectionIdChange`), three new `StudentsPageQuery` fields, and three new
  `STUDENTS_QUERY_FIELDS` entries (`["academicSessionId", "academic_session_id"],
  ["classId", "class_id"], ["sectionId", "section_id"]`).

- [ ] **Step 1: Read `student-directory-filters.tsx`, `students-type.ts`,
  `students-constant.ts`, `students-helper.ts`, and `student-directory-table.tsx`'s
  filter-state ownership in full**

`student-directory-table.tsx` holds the actual `useState` for each filter value and passes
the value/onChange pair down — confirm its exact reset-all-filters function before adding
three more fields to it.

- [ ] **Step 2: Write the failing tests**

```tsx
describe("student-directory-filters: academic session/class/section", () => {
  it("renders controls showing every option regardless of status — no isActive sent", async () => {
    render(<StudentDirectoryFilters {...defaultProps} />);
    // assert fetchClasses/fetchSections/fetchAcademicSessions were called with no isActive param
  });

  it("cascades section options to the chosen class, with no isActive param", async () => {
    render(<StudentDirectoryFilters {...defaultProps} />);
    await userEvent.click(screen.getByLabelText("Class"));
    await userEvent.click(screen.getByText("Grade 2"));
    // assert fetchSections was called with { classId: "<grade-2-id>" } and no isActive key
  });

  it("includes academic_session_id/class_id/section_id in toStudentsQueryParams' output", () => {
    const params = toStudentsQueryParams({
      search: "", ordering: "", status: "", campusId: "", houseId: "",
      academicSessionId: "s1", classId: "c1", sectionId: "sec1",
    });
    expect(params).toMatchObject({ academic_session_id: "s1", class_id: "c1", section_id: "sec1" });
  });

  it("resets all three alongside the existing filters", async () => {
    // set all three, trigger the existing reset, assert all three are cleared
  });
});
```

- [ ] **Step 3: Add the three filter props to `student-directory-filters.tsx`**

Three new `Select` controls, each sourced from `fetchClasses()`, `fetchSections({ classId })`
(no `isActive`), `fetchAcademicSessions()` — matching this component's existing
value/onChange prop style exactly, no status filtering.

- [ ] **Step 4: Add the three fields to `StudentsPageQuery` and `STUDENTS_QUERY_FIELDS`**

- [ ] **Step 5: Wire the three `useState`s and reset logic into `student-directory-table.tsx`**

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/features/students/student-directory-filters.tsx apps/dashboard/src/features/students/student-directory-table.tsx apps/dashboard/src/services/modules/students/students-type.ts apps/dashboard/src/services/modules/students/students-constant.ts
git commit -m "feat(dashboard): wire academic-session/class/section filters into the student directory"
```

- [ ] **Step 7: Push and confirm CI — third checkpoint**

Push. Read `gh pr checks` and fix anything red (Jest/lint/typecheck for Tasks 8-12) before
continuing to Task 13.

---

### Task 13: E2E — mocked lane

**Files:**
- Modify: `e2e/src/mocks/domains/school-organization.ts`
- Create: `e2e/src/mocks/domains/enrollment.ts`
- Create: `e2e/src/mocks/domains/student-transfers.ts`
- Create: `e2e/tests/dashboard/student-enrollment.spec.ts`
- Create: `e2e/tests/dashboard/student-transfers.spec.ts`

**Interfaces:**
- Consumes: every endpoint this phase added, mocked at the HTTP layer the existing mocked
  lane already uses — read an existing Phase 2 mocked spec (e.g. the guardians one) for the
  exact mocking/fixture-composition convention before writing new fixtures.

- [ ] **Step 1: Read an existing Phase 2 mocked E2E spec and its mock-domain file end to
  end**

- [ ] **Step 2: Add Class/Section fixtures to `school-organization.ts`**

Following this file's existing `/houses` pattern — do not duplicate the bare stubs
`dashboard-home.ts` already registers for `/classes`/`/sections`; compose only the modules a
given spec actually needs.

- [ ] **Step 3: Create `enrollment.ts` mocks**

Handlers for `:enroll`, `:change-section`, `/history`, with success and 422-capacity-error
fixtures per action.

- [ ] **Step 4: Create `student-transfers.ts` mocks**

Handlers for list/create/`:approve`/`:reject`/`:complete`, with fixtures covering each
transfer status transition and a 422 segregation-of-duties fixture.

- [ ] **Step 5: Write `student-enrollment.spec.ts`**

Cover: the Not Enrolled state, enrolling (session → class → section cascading), the
capacity-override field's visibility gated on `students.student.update` specifically (not
conflated with `students.enrollment.enroll`), changing section, and the permission-gated
absence of the Enroll/Change-Section buttons for a role lacking the respective enrollment
permission keys.

- [ ] **Step 6: Write `student-transfers.spec.ts`**

Cover: requesting an inter-campus transfer (confirming `incoming` is never offered),
approving, rejecting, completing (picking a destination section when an active enrollment
exists; confirming the plain-confirm copy when it doesn't), and the permission-gated absence
of Approve/Reject for a role lacking `students.transfer.approve`.

- [ ] **Step 7: Commit**

```bash
git add e2e/src/mocks/domains/school-organization.ts e2e/src/mocks/domains/enrollment.ts e2e/src/mocks/domains/student-transfers.ts e2e/tests/dashboard/student-enrollment.spec.ts e2e/tests/dashboard/student-transfers.spec.ts
git commit -m "test(e2e): cover enrollment and transfer flows in the mocked lane"
```

---

### Task 14: E2E — live lane extension

**Files:**
- Modify: `apps/api/core/rbac/management/commands/seed_e2e_data.py`
- Modify: `e2e/src/pages/dashboard/students/student-detail.page.ts` (already exists — written
  ahead of this phase's dashboard implementation)
- Modify: `e2e/tests/live/students-admission-enrollment.spec.ts` (already exists, 198 lines —
  this is an **extension**, not a from-scratch rewrite)

**Interfaces:**
- Consumes: `signInAsSecondIdentity`/`E2E_PRINCIPAL_EMAIL` (read
  `academics-promotion-journey.spec.ts`'s real usage). The existing page object already has
  `tab(name: "Guardians" | "Emergency contacts")`, `enrollTrigger`, `enrollDate`, `async
  enroll(values: {..., enrollmentDate: string})`, `notEnrolledMessage` — it already drives
  create → Guardians → link guardian → Emergency contacts → add contact →
  `enroll({...})` → assert `notEnrolledMessage` hidden, plus a duplicate-admission rejection
  test. Its own internal comments reference `guardians-panel.tsx`/`emergency-contacts-
  panel.tsx`/`enrollment-panel.tsx` — stale/aspirational names from before Phase 2 shipped;
  the real files are `student-guardians-tab.tsx`/`student-emergency-contacts-tab.tsx`/
  `student-documents-tab.tsx`/(this phase's new) `student-enrollment-tab.tsx`. Leave those
  stale comments alone unless this task is already touching the exact line.
- Produces: extended `enroll()` accepting class/section selection (it likely already takes
  enrollment date only — extend its signature for session/class/section/roll-number, and add
  a `tab("Documents")` entry if the existing `tab()` union doesn't have it); new page-object
  methods for the transfer journey (`requestTransfer`, `signInAsSecondIdentity`-driven
  `approveTransfer`, `completeTransfer`); the spec file gains the transfer half of the
  journey after its existing enrollment coverage.

- [ ] **Step 1: Read `seed_e2e_data.py`, the existing page object, and the existing spec in
  full**

Confirm the exact current permission sets for `school_admin`/`principal`, the exact seeded
campus/section data, and `academics-promotion-journey.spec.ts`'s real dual-identity pattern.

- [ ] **Step 2: Add the missing permissions and seed data**

Add `students.transfer.create` and `students.enrollment.update` to the seeded `school_admin`
role (it needs `students.enrollment.enroll` too — confirm it's already present or add it);
add `students.transfer.approve` to `principal`; add a second campus with a same-class
section, seeded with a generously high (or unbounded, if the model supports a null capacity)
capacity so repeated live-lane runs don't accumulate into a capacity failure.

- [ ] **Step 3: Extend the page object**

Extend `enroll()`'s input to include session/class/section selection (this phase's dialog
needs these, which the existing stub — written before the dialog existed — didn't yet know
about). Add transfer-journey methods matching the existing file's style.

- [ ] **Step 4: Extend the spec**

After the existing enrollment coverage, add: change section, request an inter-campus
transfer, sign in as the second `principal` identity via `signInAsSecondIdentity`/
`E2E_PRINCIPAL_EMAIL`, approve, sign back in as the original identity, complete, assert the
student's campus/section actually moved against the real database — then filter the live
directory by the past session/class combination and assert the single-enrollment-row
correctness fix holds against real data. Keep the existing duplicate-admission rejection test
as-is.

- [ ] **Step 5: Commit**

This spec runs only in CI's nightly/manual-dispatch live lane, never on this PR's own checks
— commit once internally consistent with Steps 1-4's findings; CI won't confirm it on this
PR.

```bash
git add apps/api/core/rbac/management/commands/seed_e2e_data.py e2e/src/pages/dashboard/students/student-detail.page.ts e2e/tests/live/students-admission-enrollment.spec.ts
git commit -m "test(e2e): extend the live lane for enrollment and transfers"
```

---

### Task 15: Docs

**Files:**
- Modify: `docs/03-modules/student-management.md`
- Modify: `docs/project-status.md`
- Modify: `docs/deferred-work.md` (the real existing live-lane entry is at lines ~749-765 —
  it already says the live spec "can't be fully re-driven until enrollment ships in Phase 3
  too... Left as-is pending the full Phase 3 rewrite" — close this exact entry, don't add a
  redundant new one)
- Create: a new ADR under `docs/decisions/` (next available number)
- Modify: `docs/decisions/README.md`

- [ ] **Step 1: Update the module doc**

§16 gets the new `student_id` transfer filter and the `StudentFilterSet` correctness fix
(including the soft-delete exclusion, a small second behavior change decided during this
plan's own review); §20 gets an "as shipped" update once this phase's PR is open.

- [ ] **Step 2: Update `docs/project-status.md`**

Close the Phase 3 reference on the student-management row.

- [ ] **Step 3: Update `docs/deferred-work.md`**

Close the directory-filter "dead controls" entry and the live-lane entry named above (Task 14
extended rather than fully rewrote it — reflect that accurately). Add four new entries: the
enroll section-campus server-side gap (closed client-side only); the deliberate
`incoming`-transfer exclusion; the transfer `from_campus_id`/`to_campus_id` server-side match
gap; the §11 effective-date-within-session validation gap. Extend the existing unwired-
`guardians/`-package entry to also name `transfers/viewset.py`.

- [ ] **Step 4: Write the new ADR**

Read `docs/decisions/README.md` for the next available number. Document: the choice of
`PolymorphicProxySerializer`-for-documentation-only plus a plain dict-dispatch-by-`type`
runtime, over alternatives considered (a single combined serializer with all fields
nullable; a hand-written OpenAPI override); the `pagination_class=None, filter_backends=[]`
`as_view()` override this pattern needs whenever a non-list action on a paginated/filtered
viewset returns a plain list, to avoid drf-spectacular documenting a paginated, filtered
response that doesn't match reality; the `ENUM_NAME_OVERRIDES` requirement whenever a shared
enum is reused across two polymorphic branches. Add its index row.

- [ ] **Step 5: Commit**

```bash
git add docs/03-modules/student-management.md docs/project-status.md docs/deferred-work.md docs/decisions/
git commit -m "docs(students): document Phase 3 enrollment and transfers"
```

- [ ] **Step 6: Push and confirm CI — final checkpoint**

Push. Read `gh pr checks` and fix anything red, including `repo-hygiene`'s doc-sync/link
checks against this task's changes.

---

## Final steps (after all tasks)

Per `subagent-driven-development`: dispatch the final whole-branch code review on the most
capable available model once every task above is complete, against the real merge-base
(`git merge-base HEAD origin/main`, not a stale local `main` — confirm which ref is current
before dispatching, since this exact mistake happened once already in Phase 2). Address its
findings in one fix round, re-review the fix's diff only, push, confirm `gh pr checks` is
green, and mark the PR ready for review (promote from draft if it was opened as one at the
Task 2 checkpoint) per AGENTS.md's "Working Here" section — stop at "PR open, CI green,"
never merge.

## Independent review

- **Reviewer:** plan-reviewer agent, 2026-10-07
- **Verdict:** REVISE — sound design with a proven root cause, but enroll/change-section were
  gated on the wrong permission keys, the history schema would have published a paginated,
  filter-polluted contract, the plan directed local `pytest` runs (this repo never runs tests
  locally), and nearly every dashboard file path, transport-call shape and server field name
  in the original draft was guessed rather than verified against the real tree.
- **Findings addressed:** All four High findings fixed before implementation began: `canEnroll`/
  `canChangeSection` now gate on `students.enrollment.enroll`/`.update` (not
  `students.student.update`, which gates only the capacity-override field — confirmed from the
  real `required_permission_map`); the history route excludes `pagination_class`/
  `filter_backends` via an explicit `as_view()` override, confirmed against the generated
  OpenAPI output directly (only the `id` path param remains); every local-test-run instruction
  was replaced with "write the test, do not run it — a task reviewer / CI confirms it"; every
  dashboard file path, service transport shape (`fetchPage`/`collectPages`/`apiClient.post`,
  not `apiClient.GET`), and server field name (`change_section` has no `class_id`;
  `complete_transfer` takes `section_id` only and silently no-ops with no active enrollment)
  was re-verified against the real repository before the plan was finalized, and the
  implementation itself was built directly against those verified facts rather than against
  the plan's own first-draft guesses. The Medium findings (picker `is_active` scoping split,
  `ResponsiveAlertDialog`'s real prop API and error slot, the Rules-of-Hooks violation in
  `CompleteTransferDialog`, invalidation keys per mutation, the `school-organization`
  five-file-shape question) were each resolved the same way, verified against real code during
  implementation rather than assumed from the plan text. Per the user's explicit instruction to
  review in a single shot and then implement, this round's findings were folded in directly,
  with no further plan-review dispatch — implementation proceeded immediately after, verifying
  each file/path/shape against the real repository as each task was built.
