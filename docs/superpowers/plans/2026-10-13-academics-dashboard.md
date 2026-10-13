# Academics Dashboard: Implementation Plan

> **For agentic workers:** one implementer pass per task (the user's standing preference), then one final `change-reviewer` pass and one fix pass per PR. Steps use checkbox (`- [ ]`) syntax. **This repo never runs tests, lint or typecheck locally.** CI is the verifier, so a "run the test" step here means pushing and reading `gh pr checks <n> --watch`. Generators are not checks and must be run: `apps/api/scripts/generate-openapi.sh` and `pnpm --filter @schoolhub/api-client generate`.

**Work tier:** 2

**Goal:** Give `academics` its dashboard: curriculum, teacher allocation with teacher load, and promotion batches (propose → review → approve → execute). Close the backend contract and rule gaps those screens hit.

**Architecture:** Three sequential PRs, one per screen, each full-stack:

| PR | Branch | Ships |
| --- | --- | --- |
| A | `feat/academics-curriculum` | curriculum, plus the shared Academics shell (sidebar entry, `/academics` layout with section tabs, session resolution) |
| B | `feat/academics-allocations` | teacher allocations and the load summary |
| C | `feat/academics-promotions` | the promotion batch list and batch review page, at the route the live CUJ already expects |

- **Backend half of each PR:**
  - Response serializers, so the generated client types every response the screen reads (ADR-0005, ADR-0017).
  - Name fields, so the screen never joins names client-side.
  - The §11 rule gaps on the endpoints that screen writes to.
- **Dashboard half:** the `students`/`staff` conventions: `DataGrid` with `useDataGridUrlState` (ADR-0024), five-file service modules (ADR-0019), `ResponsiveDialog`/`ResponsiveAlertDialog`, and the surviving `academics` i18n namespace.

**Tech Stack:** Django 6.1 + DRF 3.18 + drf-spectacular; Next.js 16.3 / React 19, TanStack Table 8 / Query 5, react-hook-form + zod, next-intl; Jest + RTL; Playwright (mocked `dashboard` project, plus the nightly `live` lane).

**Spec:**
- `docs/03-modules/academics.md`: §4 permissions, §5–§7 features and workflows, §9 forms, §11 validations, §16 endpoints, and the implementation notes at lines ~177–214.
- `docs/05-database/entities/academics.md`
- `docs/project-status.md` items 12 and the Tier 2 row

**Plan file in the repo:** PR A's first commit copies this plan, review block included, to `docs/superpowers/plans/2026-10-13-academics-dashboard.md` (`docs: academics dashboard plan`), so that repo-hygiene's "Specs and plans carry an independent review" check sees it. PRs B and C reference that file.

**Branching:** PR A starts from an up-to-date `main` (`git checkout main && git pull --ff-only && git checkout -b feat/academics-curriculum`). PR B and PR C each branch from `main` once the previous PR has merged. If it hasn't merged yet, stack on its branch with `gh pr create --base <previous branch>`, then retarget the PR to `main` after the merge.

## Context

`docs/project-status.md` names the academics dashboard as the next pickup: Tier 2's build order is academics → timetable → attendance, and timetable schedules from academics' teacher allocations. The backend has been complete since September.

The dashboard screens were built once (`4d7cb89`) and deleted by the shell reset (`8cd8176` removed the routes, `9548054` removed `features/academics/*`). Three things survived:
- the `academics` i18n namespace in both locales;
- `Services.dashboard.fetchTeacherLoadSummary`;
- the provisional page object `e2e/src/pages/dashboard/academics/promotion-batch.page.ts`, which the nightly live CUJ `e2e/tests/live/academics-promotion-journey.spec.ts` drives at `/academics/promotions/{batchId}`. That route no longer exists, so that CUJ fails today.

**User decisions (2026-10-13):**
- The module is the academics dashboard, not communication PR C.
- Plan all three phases in full.
- After the review, the user said to continue with the recommended defaults: no section-at-submit rule, and hand-written `meta.warnings`/job-result types as a recorded exception.
- Fix the backend gaps in the same PRs. That means:
  - the OpenAPI typing;
  - the closed-session lock on curriculum and allocation PATCH/DELETE;
  - the allocation rules on PATCH;
  - the promotion "reason for a skipped level" rule.

**Reference for domain logic only.** The deleted screens can be read with `git show 9548054^:apps/dashboard/src/features/academics/<file>`. Their structure is obsolete: they used `<Can>`, `ApiErrorAlert` and direct `apiClient` paths, none of which exist now. Port decisions from them, not code. The useful files are `promotion-batch-actions.tsx` (execute and job polling), `promotion-decision-form.tsx` (the decision rules), `allocation-form.tsx` and `curriculum-form.tsx`.

## Alternatives considered (why not)

- **Restore the deleted screens verbatim.** Rejected. They predate every current convention (`DataGrid`, URL state, `Services`, `ResponsiveDialog`, generated types), so a restore would be a rewrite anyway, on top of a stale structure.
- **Join class/subject/teacher names on the client from option lists.** Rejected. Every list endpoint already annotates the names for `?ordering=`; exposing them read-only is one source of truth, costs no extra query, and still works when an option list is capped at `MAX_PAGE_SIZE`.
- **One `academics` service module.** Rejected. Curriculum, allocations and promotions are separate resources with separate permission namespaces, and promotions has its own state machine. This is the `student-transfers` precedent, so they become three modules.
- **Promotion batch detail as a side sheet on the list.** Rejected. The batch is a workflow page. The live CUJ and its page object already address it as `/academics/promotions/{batchId}`, and a link to a batch awaiting approval is what an approver gets sent.
- **The §9 drag-and-drop allocation grid.** Deferred. A list with an allocate dialog covers every rule. A section × subject matrix is a separate UX piece with no backend change, recorded in `deferred-work.md`.
- **Make identity fields (session/class/subject, section/subject/staff) read-only on PATCH.** Rejected. DRF would silently drop them, which changes the contract quietly. Instead each PATCH that changes them runs the same §11 checks as create.
- **Hand-written TS types for untyped responses** (the existing `TeacherLoadSummaryRow` pattern). Rejected by the user in favour of fixing the OpenAPI annotations.
- **A typed 202 job envelope for `:execute`.** Out of scope. Every 202 in the API documents the job lane in prose, and the dashboard's shared `JobAccepted` type (`services/modules/jobs`) already covers it. Changing one endpoint would make it inconsistent with the rest.
- **Generating `meta.warnings` and the execute job's `result`.** Recorded exception (the user's call, 2026-10-13: proceed with the recommended default). The API documents only `data` per path, and every `meta` and job `result` across the API is untyped. So `TeacherLoadWarning` and `PromotionExecutionReport` stay hand-written. Each carries a comment naming the backend function that builds it (`teacher_allocations/services.py::load_warnings`, `promotions/services.py::execute_batch`). Every other wire type is generated.
- **A "target section required at submit" rule.** Dropped (the user's call, 2026-10-13: proceed with the recommended default). It wasn't among the approved gaps. Batches are created with no sections, so it would force one decision edit per student with no bulk path, and it would break existing promotion tests. Instead the batch page shows how many non-graduating students have no target section (Task 12). The execute job keeps reporting those students as failed by name.
- **An ADR for these choices.** Not needed: none is cross-cutting. Three service modules follow ADR-0019 and the `student-transfers` precedent. Page-not-sheet and recording the proposal in `decision_basis` are module-local, recorded in `academics.md` §20 and the entity doc.
- **API compatibility (api-architecture.md §2.1).** Several changes refuse inputs that were accepted before: the new 422s on PATCH/DELETE in closed sessions, the allocation rules on PATCH, `effective_to` on create (previously silently dropped), and an override reason when the target class differs from the proposal. These are corrections to §11 rules the contract already declared, not new contract. The only consumers are in this repo (the dashboard and e2e), and both change in the same PR. The §16 notes say so, as §2.4 does for its own exception.

## Global Constraints

- **Verification:** no local test/lint/typecheck. Commit and push only with the user's go-ahead, never `--no-verify`. An agent stops at "PR open, CI green"; the human merges (ADR-0006).
- **Commits:** Conventional Commits. `fix` commits carry a `Root cause:` line (ADR-0016). No AI attribution or `Co-Authored-By`.
- **Generated contract:** regenerate `apps/api/openapi.yaml` and `packages/api-client/src/schema.d.ts` with the backend change, **in the same commit**. Never hand-edit either.
- **Dashboard rules:**
  - No hardcoded English in JSX (`react/jsx-no-literals`); every key goes in both `messages/en.json` and `messages/ur.json` (the `messages.types-check.ts` gate).
  - Never import `@schoolhub/api-client` in `src/features`/`src/hooks`; take `ApiError` and types from `@/services`.
  - Tests go in sibling `__tests__/` folders. Prettier width is 100.
  - Coverage floor 85% (a ratchet).
  - No magic strings or numbers (ADR-0014).
  - Colors come from theme tokens only, never arbitrary-value color utilities.
  - Split any file before it reaches 400 lines. The lint baseline only shrinks, so no new suppressions.
- **Backend rules:**
  - Every endpoint keeps its `module.resource.action` key.
  - Cross-tenant access is 404.
  - A new response serializer is used both in `@extend_schema` and at runtime, so the two cannot drift.
  - No new `noqa`.
  - Each new rule gets an endpoint test.
- **Permissions (from §4, unchanged):**

  | Resource | Keys |
  | --- | --- |
  | Curriculum | `academics.curriculum.view`, `.create`, `.update`, `.delete` |
  | Teacher allocation | `academics.teacher-allocation.view`, `.create`, `.update`, `.delete` |
  | Promotion | `academics.promotion.view`, `.create`, `.update` (decision edit, `:submit`, `:revert`), `.approve` (`:approve`, `:reject`), `.execute` |

  The UI hides what the user lacks; the server enforces it.
- **Docs ship in the same PR:**
  - `docs/03-modules/academics.md` gets one bold **"Dashboard, curriculum / teacher allocation / promotions (as shipped)."** paragraph per PR inside the existing `## 20. Implementation notes`, following the `student-management.md` §20 convention, plus updates to the implementation notes for each closed gap.
  - `docs/project-status.md` gets its Tier 2 row, matrix row and item 12 updated, and its stale "never built" wording corrected.
  - `docs/deferred-work.md` records what is deferred.

## Review Focus

1. **The selected session is closed or archived.** Curriculum and allocation write buttons are hidden, and a read-only notice shows. If the session closes while a dialog is open, the server's 422 shows inline in that dialog; it doesn't close the dialog or fail silently. Tests are in Tasks 1, 3, 5 and 7.
2. **No current session, or no sessions at all.** The screen shows a "pick a session" empty state and sends **no** list request with an empty `academic_session_id`. A `session` id in the URL that isn't in the list falls back to the current session. Tests are in Tasks 2 and 3.
3. **The preparer tries to approve their own batch.** The 422 segregation-of-duties message shows inline in the approve dialog, which stays open, and the batch stays `pending_approval`. Tests are in Tasks 11 and 12.
4. **Execute is double-clicked, retried after a timeout, or the page is reloaded mid-job.**
   - One idempotency key per execute intent, so a retry rejoins the same job.
   - The button is disabled while the request or poll is in flight.
   - After the job finishes, the batch re-fetches and shows `Executed` plus the report.
   - A partially failed job shows its failed students by name, not as a silent success.

   Tests are in Task 12.
5. **A batch submitted or executed with students missing a target section.** An advisory notice counts them before submit and execute, and the execute report names each one as failed. Tests are in Task 12.
6. **A user who holds only some academics keys.** The sidebar shows only the sections they can open, and `/academics` lands them on the first one, never on a 403. Tests are in Tasks 2 and 8.
7. **A batch larger than one page (more than 100 students).** The batch detail endpoint returns every decision unpaginated. The decisions grid pages client-side and never truncates. Tests are in Task 12.

---

# PR A: Curriculum and the Academics shell

### Task 1: Backend: curriculum contract and PATCH/DELETE rules

**Files:**
- **Modify:**
  - `apps/api/apps/academics/curriculum/serializers.py`
  - `apps/api/apps/academics/curriculum/viewset.py`
  - `apps/api/apps/school_organization/services.py` (extract the identity checks)
- **Test:** `apps/api/apps/academics/curriculum/tests/test_endpoints.py`. Also grep `apps/api/apps/school_organization/tests/` and `academics/curriculum/tests/` for assertions on the old bare-string (`non_field`) 422 bodies from `map_subject_to_class`, and update each to the new field key.
- **Regenerate:** `apps/api/openapi.yaml`, `packages/api-client/src/schema.d.ts`

**Interfaces (produced):**
- `ApiSchemas["Curriculum"]` gains read-only `academic_session_name: string`, `class_name: string`, `subject_name: string`, `campus_name: string | null`.
- `ApiSchemas["CloneCurriculumResult"]` is `{ created: number; skipped: number }`.

- [ ] **Step 1: Write the failing tests.** Add to `CurriculumEndpointTests`:

```python
    def _closed(self) -> None:
        with tenant_context(self.tenant.id):
            self.session.status = SessionStatus.CLOSED
            self.session.save(update_fields=["status"])

    def test_a_patch_on_a_closed_session_is_refused(self) -> None:
        """§11 session lock — previously only create and clone were guarded."""
        self.allow("academics.curriculum.update")
        self._closed()
        response = self.client.patch(
            f"/api/v1/class-subjects/{self.curriculum.pk}", {"weekly_periods": 6}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_a_delete_on_a_closed_session_is_refused(self) -> None:
        self.allow("academics.curriculum.delete")
        self._closed()
        response = self.client.delete(f"/api/v1/class-subjects/{self.curriculum.pk}")
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_a_patch_may_not_move_a_row_into_a_closed_session(self) -> None:
        self.allow("academics.curriculum.update")
        with tenant_context(self.tenant.id):
            self.next_session.status = SessionStatus.CLOSED
            self.next_session.save(update_fields=["status"])
        response = self.client.patch(
            f"/api/v1/class-subjects/{self.curriculum.pk}",
            {"academic_session_id": str(self.next_session.pk)},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_a_patch_to_an_inactive_subject_is_refused(self) -> None:
        self.allow("academics.curriculum.update")
        with tenant_context(self.tenant.id):
            inactive = SubjectFactory(tenant=self.tenant, is_active=False)
        response = self.client.patch(
            f"/api/v1/class-subjects/{self.curriculum.pk}",
            {"subject_id": str(inactive.pk)},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_a_patch_onto_an_existing_mapping_is_a_conflict(self) -> None:
        self.allow("academics.curriculum.update")
        with tenant_context(self.tenant.id):
            other = SubjectFactory(tenant=self.tenant)
            twin = ClassSubjectFactory(
                tenant=self.tenant,
                academic_session=self.session,
                school_class=self.school_class,
                subject=other,
            )
        response = self.client.patch(
            f"/api/v1/class-subjects/{twin.pk}", {"subject_id": str(self.subject.pk)}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_a_patch_that_changes_nothing_identifying_skips_the_identity_checks(self) -> None:
        """An inactive class must not block editing the weekly target of an existing row."""
        self.allow("academics.curriculum.update")
        with tenant_context(self.tenant.id):
            self.school_class.is_active = False
            self.school_class.save(update_fields=["is_active"])
        response = self.client.patch(
            f"/api/v1/class-subjects/{self.curriculum.pk}", {"weekly_periods": 5}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_rows_carry_their_names(self) -> None:
        self.allow("academics.curriculum.view")
        row = self.client.get("/api/v1/class-subjects").json()["data"][0]
        self.assertEqual(row["class_name"], self.school_class.name)
        self.assertEqual(row["subject_name"], self.subject.name)
        self.assertEqual(row["academic_session_name"], self.session.name)
        self.assertIsNone(row["campus_name"])

    def test_create_and_patch_responses_carry_names(self) -> None:
        """Those instances never pass through get_queryset's annotations."""
        self.allow("academics.curriculum.create", "academics.curriculum.update")
        with tenant_context(self.tenant.id):
            other = SubjectFactory(tenant=self.tenant)
        created = self.client.post(
            "/api/v1/class-subjects",
            {
                "academic_session_id": str(self.session.pk),
                "class_id": str(self.school_class.pk),
                "subject_id": str(other.pk),
                "campus_id": str(self.campus.pk),
            },
            format="json",
        ).json()["data"]
        self.assertEqual(created["subject_name"], other.name)
        self.assertEqual(created["campus_name"], self.campus.name)
        patched = self.client.patch(
            f"/api/v1/class-subjects/{created['id']}", {"weekly_periods": 3}, format="json"
        ).json()["data"]
        self.assertEqual(patched["class_name"], self.school_class.name)

    def test_clone_returns_typed_counts(self) -> None:
        self.allow("academics.curriculum.create")
        body = self.client.post(
            "/api/v1/class-subjects:clone",
            {
                "source_academic_session_id": str(self.session.pk),
                "target_academic_session_id": str(self.next_session.pk),
            },
            format="json",
        ).json()
        self.assertEqual(body["data"], {"created": 1, "skipped": 0})
```

  If `SubjectFactory` doesn't accept `is_active`, set and save the field inside `tenant_context` instead, as the existing `test_an_inactive_subject_cannot_be_mapped` does.

- [ ] **Step 2: Extract the identity checks once, in `school_organization/services.py`.** Then `map_subject_to_class` (create, clone wizard, importer) and the curriculum PATCH path both run the same code. The error messages become field-keyed, so the form can place them:

```python
def assert_class_subject_mapping_valid(
    *,
    session: AcademicSession,
    school_class: Class,
    subject: Subject,
    campus: Campus | None,
    exclude_pk=None,
) -> None:
    """§11 identity rules for a curriculum row — shared by create and PATCH.

    `exclude_pk` lets a PATCH check for a duplicate without colliding with itself.
    """
    assert_session_writable(session)
    if not school_class.is_active:
        raise DomainRuleViolation({"class_id": f"Class '{school_class.name}' is inactive."})
    if not subject.is_active:
        raise DomainRuleViolation({"subject_id": f"Subject '{subject.name}' is inactive."})
    duplicate = ClassSubject.objects.alive().filter(
        academic_session=session, school_class=school_class, subject=subject, campus=campus
    )
    if exclude_pk is not None:
        duplicate = duplicate.exclude(pk=exclude_pk)
    if duplicate.exists():
        raise Conflict(
            f"'{subject.name}' is already mapped to '{school_class.name}' for this session."
        )
```

  `map_subject_to_class` replaces its own session, class, subject and duplicate checks with one call: `assert_class_subject_mapping_valid(session=session, school_class=school_class, subject=subject, campus=campus)`. Its `weekly_periods` and elective checks stay where they are. Existing tests asserting the old bare-string 422 detail get updated to the field keys (see Files).

- [ ] **Step 3: Wire it into the viewset.**
  - **`perform_update`:**
    - Call `services.assert_curriculum_writable(instance.academic_session)` first, which covers the closed *current* session.
    - Compute the target `(session, class, subject, campus)` from `validated_data` with the instance as fallback.
    - If any of the four differs from the instance, call `assert_class_subject_mapping_valid(..., exclude_pk=instance.pk)`, imported from `apps.school_organization.services` beside `map_subject_to_class`.
    - Keep the existing elective-group check after these.
  - **`perform_destroy`:** call `services.assert_curriculum_writable(instance.academic_session)` before the elective check.
  - **`clone`:** change `@extend_schema` to `responses={200: CloneCurriculumResultSerializer}` and build the response body with `CloneCurriculumResultSerializer(summary).data`.

- [ ] **Step 4: Update the serializers.**

```python
class CurriculumSerializer(serializers.ModelSerializer):
    ...
    # Read-only names, so a list renders without a lookup per row in the client.
    # `source=` over the FK, not the list's ordering annotations: create and PATCH
    # return an instance that never went through `get_queryset`.
    academic_session_name = serializers.CharField(source="academic_session.name", read_only=True)
    class_name = serializers.CharField(source="school_class.name", read_only=True)
    subject_name = serializers.CharField(source="subject.name", read_only=True)
    # No `default=None`: DRF skips a field's default on partial updates, which drops the key from a PATCH response.
    campus_name = serializers.CharField(source="campus.name", read_only=True, allow_null=True)
```

  Add the four fields to `Meta.fields`. Add the result serializer:

```python
class CloneCurriculumResultSerializer(serializers.Serializer):
    created = serializers.IntegerField()
    skipped = serializers.IntegerField()
```

  If the null-FK `campus.name` raises rather than defaulting, use a `SerializerMethodField` typed with `@extend_schema_field(OpenApiTypes.STR)` that returns `obj.campus.name if obj.campus_id else None`.

- [ ] **Step 5: Regenerate the contract.**
  - `apps/api/scripts/generate-openapi.sh && pnpm --filter @schoolhub/api-client generate`.
  - Confirm with a diff read (not a check run) that `schema.d.ts` gained `CloneCurriculumResult` and the four `Curriculum` name fields.
- [ ] **Step 6: Commit.** `feat(api): name fields, typed clone result and session lock on curriculum edits` (backend, tests and both generated files in one commit).

### Task 2: Dashboard foundation: paths, nav, Academics layout, services, session resolution

**Files:**
- **Modify:**
  - `apps/dashboard/src/config/paths.ts`
  - `apps/dashboard/src/config/menu-config.ts`
  - `apps/dashboard/src/services/endpoints.ts`
  - `apps/dashboard/src/services/index.ts`
  - `apps/dashboard/src/services/modules/school-organization/`: add `fetchSubjects`, retype the sessions on the generated schema, and bring the module to the five-file shape (ADR-0019) by adding `school-organization-type.ts`, `-constant.ts`, `-helper.ts` and `school-organization.schema.ts`, moving the existing types into `-type.ts`
  - `messages/en.json`, `messages/ur.json`
- **Create:**
  - `apps/dashboard/src/services/modules/curriculum/{curriculum-type.ts, curriculum-constant.ts, curriculum-helper.ts, curriculum.schema.ts, curriculum-service.ts, index.ts}`
  - `apps/dashboard/src/app/(app)/academics/layout.tsx`
  - `apps/dashboard/src/app/(app)/academics/page.tsx`
  - `apps/dashboard/src/features/academics/academics-sections.ts`
  - `apps/dashboard/src/features/academics/academics-nav.tsx`
  - `apps/dashboard/src/features/academics/academics-landing.tsx`
  - `apps/dashboard/src/features/academics/use-academic-session.ts`
  - `apps/dashboard/src/hooks/use-page-clamp.ts` (see Task 3) and its test
- **Modify (gating):** `packages/ui/src/lib/menu-types.ts`, `apps/dashboard/src/app/(app)/shell/sidebar-menu.tsx`
  - `apps/dashboard/src/features/academics/session-picker.tsx`
- **Test:**
  - `src/services/modules/curriculum/__tests__/curriculum-service.test.ts`
  - `src/services/modules/school-organization/__tests__/school-organization-service.test.ts` (extend it)
  - `src/features/academics/__tests__/academics-nav.test.tsx`
  - `src/features/academics/__tests__/use-academic-session.test.tsx`

**Interfaces (produced):**

```ts
// paths.ts — add
ACADEMICS: "/academics",
ACADEMICS_CURRICULUM: "/academics/curriculum",
ACADEMICS_ALLOCATIONS: "/academics/allocations",   // used from PR B
ACADEMICS_PROMOTIONS: "/academics/promotions",     // used from PR C
// below the object: export const promotionBatchPath = (batchId: string) => `${Paths.ACADEMICS_PROMOTIONS}/${batchId}`;

// endpoints.ts — add
curriculum: {
  list: "/class-subjects",
  detail: (id: string) => `/class-subjects/${id}`,
  /** Collection colon-action, synchronous 200 with {created, skipped}. */
  clone: "/class-subjects:clone",
},
schoolOrganization: { ..., subjects: "/subjects" },

// school-organization-type.ts
export type SchoolOrganizationOption = Pick<ApiSchemas["House"], "id" | "name">;
export type AcademicSessionSummary = Pick<ApiSchemas["AcademicSession"], "id" | "name" | "status" | "is_current">;
// school-organization-service.ts — add
export async function fetchSubjects(params: { isActive?: boolean } = {}): Promise<SchoolOrganizationOption[]>;
// school-organization-constant.ts
export const LOCKED_SESSION_STATUSES: readonly string[] = ["closed", "archived"]; // mirrors LOCKED_SESSION_STATES in apps/api/apps/school_organization

// curriculum-type.ts
export type CurriculumRecord = ApiSchemas["Curriculum"];
export type CloneCurriculumResult = ApiSchemas["CloneCurriculumResult"];
export interface CurriculumPageQuery {
  page?: number; pageSize?: number; search?: string; ordering?: string;
  academicSessionId: string; classId?: string; campusId?: string; isElective?: boolean;
}
export interface CurriculumInput {
  academicSessionId: string; classId: string; subjectId: string; campusId: string | null;
  isElective: boolean; electiveGroup: string | null; weeklyPeriods: number; notes: string | null;
}
// curriculum-service.ts
export function fetchCurriculumPage(query: CurriculumPageQuery): Promise<Page<CurriculumRecord>>;
export function fetchCurriculumForClass(academicSessionId: string, classId: string): Promise<CurriculumRecord[]>; // PR B's subject picker, MAX_PAGE_SIZE one page
export function createCurriculum(input: CurriculumInput): Promise<CurriculumRecord>;
export function updateCurriculum(id: string, input: Partial<CurriculumInput>): Promise<CurriculumRecord>;
export function deleteCurriculum(id: string): Promise<void>;
export function cloneCurriculum(sourceSessionId: string, targetSessionId: string, idempotencyKey: string): Promise<CloneCurriculumResult>;
// Services.curriculum = CurriculumService

// use-academic-session.ts
export function useAcademicSession(urlSessionId: string): {
  sessions: AcademicSessionSummary[] | undefined;
  session: AcademicSessionSummary | null;  // URL id if known, else is_current, else null
  isLocked: boolean;                       // LOCKED_SESSION_STATUSES.includes(session.status)
  isLoading: boolean;
  isError: boolean;                        // sessions failed to load and none are cached: not "no session"
  refetch: () => Promise<unknown>;         // retry after isError; call as () => { void refetch(); }, never onClick={refetch}
};
```

- [ ] **Step 1: Write the failing tests.**
  - **Service tests:** mock `apiClient` the way `students-service.test.ts` does. Assert each endpoint string, the snake_case body built by `toCurriculumBody` (`campus_id: null` is sent on create when "All campuses" is chosen), the query mapping (`academic_session_id`, `class_id`, `campus_id`, `is_elective`, `search`, `ordering`), and that `cloneCurriculum` passes `{ idempotencyKey }`.
  - **`fetchSubjects`:** sends `is_active` only when given.
  - **`useAcademicSession`:**
    - a URL id that exists wins;
    - an unknown URL id falls back to `is_current`;
    - no current session gives `session === null`;
    - `isLocked` is true for `closed` and for `archived`.
  - **`AcademicsNav`:**
    - renders only the tabs whose `.view` key the user holds;
    - marks the active tab with `aria-current="page"`;
    - in PR A only the Curriculum tab exists.

- [ ] **Step 2: Implement the services.**
  - Follow `student-transfers` for shape and `school-organization-service.ts` for list fetchers.
  - `toCurriculumQueryParams`/`toCurriculumBody` go in `curriculum-helper.ts`, driven by `CURRICULUM_QUERY_FIELDS`/`CURRICULUM_BODY_FIELDS` tuples in `curriculum-constant.ts` (the `STUDENTS_QUERY_FIELDS` pattern).
  - `curriculum.schema.ts` holds the form's zod schema (Task 3).
  - Register `curriculum: CurriculumService` in `Services`.
  - Move `SchoolOrganizationOption`/`AcademicSessionSummary` into `school-organization-type.ts` and re-export from `index.ts`, so every existing import path still resolves. Grep for importers.

- [ ] **Step 3: Build the shell.**
  - **`/academics` landing.** `app/(app)/academics/page.tsx` renders `<AcademicsLanding/>` (`features/academics/academics-landing.tsx`, a client component). It reads `useCurrentUser()` and `router.replace`s to the first `ACADEMICS_SECTIONS` entry the user holds, so a promotions-only user never lands on a curriculum 403. With none, it shows the existing forbidden/empty copy. The session lives client-side (an in-memory token), so a server-side `redirect` can't see permissions.
  - `layout.tsx` renders `<Container><AcademicsNav /></Container>{children}`.
  - **Sidebar children are permission-gated.** Add an optional `permission?: string` to `MenuItem` in `packages/ui/src/lib/menu-types.ts`, documented beside `module` as "an app filters on this; this package never does". In `apps/dashboard/src/app/(app)/shell/sidebar-menu.tsx`, filter each item's `children` with `!child.permission || hasPermission(user, child.permission as PermissionKey)`, and hide a parent whose children all filter out. Tests:
    - `features/academics/__tests__/academics-landing.test.tsx`: redirects to the first permitted section.
    - the existing sidebar test, or a new `src/app/(app)/shell/__tests__/sidebar-menu.test.tsx`: a child without its key is hidden.
  - `AcademicsNav` is a client component that reads `useCurrentUser()` and `usePathname()`, and renders a `role="navigation"` `aria-label={t("nav.label")}` list of `next/link` tabs from one config array:

```ts
const ACADEMICS_SECTIONS = [
  { href: Paths.ACADEMICS_CURRICULUM, labelKey: "nav.curriculum", permission: "academics.curriculum.view" },
] as const satisfies readonly { href: string; labelKey: string; permission: PermissionKey }[];
```

  - **Sidebar** (`menu-config.ts`), under `{ heading: "School" }` after Staff:

```ts
{
  title: "Academics",
  icon: BookOpen,
  module: "academics",
  children: [
    { title: "Curriculum", path: Paths.ACADEMICS_CURRICULUM, permission: "academics.curriculum.view" },
  ],
},
```

  `ACADEMICS_SECTIONS` (in `features/academics/academics-sections.ts`) is the one list of section paths and their `.view` keys. `AcademicsNav`, `AcademicsLanding` and the sidebar children all derive from it, so a section added later can't be gated in one place and not another.

  - `SessionPicker` is a controlled `Select` (aria-label `academics.fields.academicSession`). It lists sessions by name, with a `Badge` for the current session and one for a locked status. Picking the current session writes `""` (the URL default).

- [ ] **Step 4: Add i18n keys** to both locales under `academics`:
  - `common.currentSession`: "Current"
  - `common.locked`: "Closed"
  - `common.lockedNotice`: "{session} is closed, so its records are read-only."
  - `common.noSessionTitle`: "No current academic session"
  - `common.noSessionDescription`: "Pick a session to see its records, or set one as current under school setup."

- [ ] **Step 5: Commit.** `feat(dashboard): academics shell, curriculum and subject services, session resolution`

### Task 3: Curriculum screen

**Files:**
- **Create** in `apps/dashboard/src/features/academics/curriculum/`:
  - `curriculum-table.tsx`
  - `curriculum-filters.tsx`
  - `curriculum-columns.tsx`
  - `curriculum-form-dialog.tsx`
  - `delete-curriculum-dialog.tsx`
  - `clone-curriculum-dialog.tsx`
  - `curriculum-toolbar.tsx`
- **Create:** `apps/dashboard/src/app/(app)/academics/curriculum/page.tsx`
- **Modify:**
  - `curriculum-constant.ts`: URL filters, sort map, defaults
  - `curriculum.schema.ts`: form schema
  - both message files
- **Test** (in `features/academics/curriculum/__tests__/`):
  - `curriculum-table.test.tsx`
  - `curriculum-form-dialog.test.tsx`
  - `clone-curriculum-dialog.test.tsx`
  - `delete-curriculum-dialog.test.tsx`

**Interfaces:**

```ts
// curriculum-constant.ts
export const CURRICULUM_SORT_FIELD: Record<string, string> = {
  class: "class_name", subject: "subject_name", campus: "campus_name",
  weeklyPeriods: "weekly_periods", kind: "is_elective",
};
export const CURRICULUM_SORTABLE_IDS = Object.keys(CURRICULUM_SORT_FIELD);
export const CURRICULUM_DEFAULT_SORTING = [{ id: "class", desc: false }];
export const CURRICULUM_KIND = { all: FILTER_ALL, core: "core", elective: "elective" } as const;
export const CURRICULUM_URL_FILTERS = {
  session: { default: "", isValid: isUuid },   // "" = the current session
  class: { default: "", isValid: isUuid },
  campus: { default: "", isValid: isUuid },
  kind: { default: FILTER_ALL, isValid: (v: string) => Object.values(CURRICULUM_KIND).includes(v as never) },
};
export const CURRICULUM_MIN_WEEKLY_PERIODS = 1;
export const CURRICULUM_NOTES_MAX = 500;            // entities/academics.md
export const CURRICULUM_ELECTIVE_GROUP_MAX = 50;
// curriculum.schema.ts
export const curriculumFormSchema = z.object({
  academic_session_id: z.string().uuid(),
  class_id: z.string().uuid(),
  subject_id: z.string().uuid(),
  campus_id: z.string(),              // "" = all campuses -> null on the wire
  is_elective: z.boolean(),
  elective_group: z.string().max(CURRICULUM_ELECTIVE_GROUP_MAX),
  weekly_periods: z.coerce.number().int().min(CURRICULUM_MIN_WEEKLY_PERIODS),
  notes: z.string().max(CURRICULUM_NOTES_MAX),
}).refine((v) => !v.is_elective || v.elective_group.trim() !== "", { path: ["elective_group"], message: "electiveGroupRequired" });
export type CurriculumFormValues = z.infer<typeof curriculumFormSchema>;
// curriculum-helper.ts (pure mappers live in -helper per ADR-0019, not in .schema)
export function recordToFormValues(record: CurriculumRecord): CurriculumFormValues;
export function buildCurriculumInput(values: CurriculumFormValues, mode: "create" | "edit"): CurriculumInput | Partial<CurriculumInput>;
```

  Match how `student-form-schema.ts` turns zod message keys into translated text.

**Behaviour:**
- **Page:** `page.tsx` renders `<Container><CurriculumToolbar/></Container><Container><Suspense><CurriculumTable/></Suspense></Container>`.
- **Toolbar** (`curriculum-toolbar.tsx`): title and summary (`academics.curriculum.title/summary`), "Add subject" (`curriculum.create`) and "Clone from another session" (`curriculum.create`). Both are disabled while permissions or the session are loading, and hidden when the session is locked. The toolbar reads only `session`, through `useUrlParams().searchParams.get("session") ?? ""` (`src/hooks/use-url-params.ts`) and `useAcademicSession`. It doesn't run a second `useDataGridUrlState`, whose local search state would fork from the table's.
- **Table:**
  - **Session resolution.** `useDataGridUrlState({ filters: CURRICULUM_URL_FILTERS, sortableIds, defaultSorting, hideableIds, trimSearch: true })`, then `useAcademicSession(filters.session)`. The list query runs only when `session` is non-null (`enabled`). When `useAcademicSession` reports `isError` the screen shows a retryable error state, not the no-session empty state: `academics.curriculum.list.loadError` (new key, both locales) with a Retry button that calls `refetch` (`common.retry`). Otherwise, with no session, it shows `EmptyState` (`common.noSessionTitle/Description`) beside the `SessionPicker`.
  - **Query.** `academicSessionId: session.id`, class, campus, `isElective` (`kind` core → false, elective → true, all → omitted), search, `ordering` from `CURRICULUM_SORT_FIELD`, page and page size.
  - **Stale page.** Reuse the guard in `src/features/students/student-directory-table.tsx:187-200`:
    - `hasPageData = pageMeta !== undefined && !query.isPlaceholderData`, then clamp with `setPageIndex(lastPageIndex)`;
    - `isStalePage = query.error instanceof ApiError && query.error.isNotFound && pagination.pageIndex > 0`, then `setPageIndex(0)`.

    Now that three new tables need it, extract it into `src/hooks/use-page-clamp.ts`: `usePageClamp({ pageMeta, isPlaceholderData, error, pageIndex, setPageIndex })`. Students, staff and the three academics tables call it, and the new hook gets its own test. The students and staff tables' existing tests are the regression check.
  - **Locked session.** Show an `Alert` with `common.lockedNotice`.
- **Columns:**

  | Column | Content |
  | --- | --- |
  | Class | `class_name` |
  | Subject | `subject_name` |
  | Campus | `campus_name ?? t("fields.allCampuses")` |
  | Type | `Badge`: Core, or "Elective · {group}" |
  | Weekly periods | numeric |
  | Actions | Edit (`curriculum.update`) and Remove (`curriculum.delete`), both hidden when locked |

  Row actions are wrapped in `useCallback`.
- **Filters:** search, `SessionPicker`, class (`fetchClasses()`), campus (`fetchCampuses()`), and kind (all/core/elective).
- **Form dialog** (`ResponsiveDialog`):
  - **Create:**
    - session defaults to the screen's session;
    - class and subject come from active lists only (`isActive: true`);
    - campus offers "All campuses" plus campuses;
    - the elective switch reveals the group input;
    - weekly periods and notes.
  - **Edit:** the session, class, subject and campus selects are rendered disabled (`academics.curriculum.form.description` explains why). Only `is_elective`, `elective_group`, `weekly_periods` and `notes` are sent.
  - **Selects** stay unmounted until edit prefill applies (`isDetailLoading` gate, skill rule 4).
  - **Server errors** go through `applyServerFieldErrors` with known fields `class_id`/`subject_id`/`elective_group`/`weekly_periods`/`notes`, falling back to `non_field`. A 409 duplicate shows under `non_field`.
  - **Success:** `queryClient.invalidateQueries({ queryKey: queryKeys.module("curriculum") })` and a toast.
- **Delete dialog** (`ResponsiveAlertDialog`): its description is `curriculum.delete.description` with the subject name. A 422 (elective group left empty, live dependents, or locked session) shows inline through the `error` prop and the dialog stays open.
- **Clone dialog:**
  - "Copy from" lists every session except the target.
  - "Copy into" lists sessions that aren't locked and defaults to the screen's session.
  - One `crypto.randomUUID()` key per dialog instance.
  - On success it toasts `curriculum.clone.result` with `{created, skipped}`, invalidates, and switches the screen to the target session if that differs from the current one.
  - A 422 shows inline.

**New i18n keys** (both locales):
- `academics.curriculum.form.electiveGroupRequired`
- `academics.curriculum.list.noMatches`
- `academics.curriculum.list.loadError`
- `academics.curriculum.saved`
- `academics.curriculum.removed`
- `academics.curriculum.filters.kind`

- [ ] **Step 1: Write the failing tests** (`createNavigationMock`, `renderWithProviders`, and every `Services` function the children call given a default).
  - **Table:**
    - first render with no `session` in the URL fetches with the current session's id;
    - `?session=<other uuid>&class=<uuid>&kind=elective&sort=-weeklyPeriods&page=2` sends the matching query;
    - an unknown `session` id falls back to the current session;
    - no current session sends no list request and shows the empty state;
    - a locked session hides Add, Clone, Edit and Remove and shows the notice;
    - a user without `curriculum.create` sees no Add or Clone;
    - changing class writes `class` and drops `page`;
    - a stale-page 404 deletes `page`.
  - **Form:**
    - create sends `campus_id: null` for "All campuses";
    - elective without a group shows the field error and sends nothing;
    - edit sends only the four editable fields;
    - a 409 shows as `non_field`;
    - a 422 on `weekly_periods` lands on that field.
  - **Clone:**
    - the same idempotency key is reused on retry within one dialog instance;
    - the result toast carries both counts;
    - a 422 stays inline.
  - **Delete:**
    - the elective-group 422 stays inline;
    - a success invalidates `["curriculum"]`.
- [ ] **Step 2: Implement** the files above. Domain decisions such as the core/elective badge and the campus-null label can be lifted from `git show 9548054^:apps/dashboard/src/features/academics/curriculum-screen.tsx` and `curriculum-form.tsx`.
- [ ] **Step 3: Commit.** `feat(dashboard): curriculum screen with session-scoped list, edit, remove and clone`

### Task 4: PR A E2E, docs, and opening the PR

**Files:**
- **Create:**
  - `e2e/src/mocks/domains/academics-curriculum.ts`: the `buildCurriculum(overrides)` factory and `academicsCurriculumModule({ rows, sessions })`. Routes:
    - `GET /class-subjects`, with page-number `pagedList` and `fail(404)` past the last page;
    - `POST /class-subjects`;
    - `PATCH`/`DELETE /class-subjects/:id`;
    - `POST /class-subjects:clone`;
    - `GET /academic-sessions` and `GET /subjects`, unless `school-organization.ts` already serves them, in which case extend that module instead.
  - `e2e/src/pages/dashboard/academics/curriculum.page.ts`: `CurriculumPage extends BasePage`.
  - `e2e/tests/dashboard/academics-curriculum.spec.ts`.
- **Modify:**
  - `e2e/src/mocks/index.ts`, `e2e/src/pages/index.ts`, `e2e/src/fixtures/index.ts`
  - `e2e/src/data/factories.ts`: add academics keys to a `SCHOOL_ADMIN_PERMISSIONS`-style constant if one is missing
  - `docs/03-modules/academics.md`:
    - add a **"Dashboard, curriculum (as shipped)."** paragraph inside `## 20. Implementation notes`;
    - update the notes: PATCH/DELETE now enforce the session lock and identity checks, the 422s are field-keyed, and rows carry name fields, with the §2.1 in-repo-consumer argument;
    - fix the §16 `:clone` line, which still calls it a "background job" though it is a synchronous 200.
  - `docs/project-status.md`, `docs/deferred-work.md`
  - `.claude/skills/schoolhub-dashboard-screen/SKILL.md`: add only the session-scoped-list pattern (`useAcademicSession` with an empty-state gate) and `usePageClamp`. No unrelated cleanup.

- [ ] **Step 1: E2E** (mocked lane, `import { expect, test } from "@/fixtures"`):
  - the sidebar shows Academics → Curriculum for a school admin and hides it for a user with no `academics.*` key;
  - add a subject and assert the POST body;
  - edit weekly periods and assert the PATCH body has only the editable fields;
  - remove a row through the confirm dialog;
  - clone from the previous session and assert the toast and that the URL switched to the target session;
  - a closed session shows the read-only notice and no Add button.
- [ ] **Step 2: Docs.**
  - **`deferred-work.md`** gets:
    - the term-plan editor;
    - syllabus attachment (`academics.syllabus` upload purpose exists, no UI);
    - curriculum import/export (no endpoint);
    - curriculum approval (key registered, no endpoint or workflow);
    - coverage and completeness reports (§13);
    - per-campus override editing beyond the campus select.
  - **`project-status.md`:** fix the Tier 2 row and the matrix row ("built once, removed by the shell reset, rebuilt as three PRs; PR A curriculum shipped"), and turn item 12's "Start here next" into the PR B/C pointer.
- [ ] **Step 3: Commit** `test(e2e): curriculum screen journeys` and `docs: academics dashboard PR A`.
- [ ] **Step 4: Review and open the PR.**
  - Run the `change-reviewer` agent with this plan.
  - Make one fix pass.
  - Get the user's go-ahead to push, then `gh pr create --base main`. The body has an ELI5 section, no AI attribution, and the checklist with the `change-reviewer` box ticked.
  - Watch CI.

**PR A divergences (declared).** What shipped differs from the steps above in these ways, none of which changes the goal:

- `src/app/(app)/shell/menu-access.ts` (`filterMenuByAccess`): the sidebar gates each item on its `module`, its `permission` or both, at every depth, and drops a parent whose children all drop. The Academics children needed their own `.view` key, which the old top-level `module` filter could not express.
- `AccordionMenu` in `sidebar-menu.tsx` carries a `key` that changes once the user loads. It reads the open group from the route on mount only, and a permission-gated group is not in the first render.
- `foldUnknownFieldErrors` and the exported `NON_FIELD` in `lib/error-message.ts`: a server error on a field the dialog has no input for shows as the form's own message instead of the code's generic text.
- `curriculum-form-fields.tsx` split out of `curriculum-form-dialog.tsx`, to keep both under the 400-line limit.
- The curriculum toolbar sits in its own `Suspense` boundary beside the table's: both read `useSearchParams`, and Next fails a production build for a client reader without one.
- `AcademicsSection.menuTitle` in `academics-sections.ts`: the sidebar is not translated yet, so its child title is a literal beside the translated `labelKey` the tab bar uses.
- `fetchOptions` in `school-organization-service.ts`: houses, classes and the new `fetchSubjects` share one `isActive`-aware reference-data fetch, and `AcademicSessionSummary` and `SchoolOrganizationOption` moved to `school-organization-type.ts` as `Pick`s of the generated schemas (ADR-0017).
- The `CURRENT_SESSION` fixture in `earnings-chart.test.tsx` is retyped with `as const`: `AcademicSessionSummary` is now a `Pick` of the generated schema, whose `status` is a union that a widened `string` does not satisfy.

---

# PR B: Teacher allocations and teacher load

### Task 5: Backend: allocation contract, filters, PATCH/DELETE rules, ending an allocation

**Files:**
- **Modify:**
  - `apps/api/apps/academics/teacher_allocations/serializers.py`
  - `apps/api/apps/academics/teacher_allocations/viewset.py`
  - `apps/api/apps/academics/teacher_allocations/services.py`
  - `apps/api/apps/academics/teacher_allocations/filters.py`
- **Test:** `apps/api/apps/academics/teacher_allocations/tests/test_endpoints.py`
- **Regenerate:** both contract files

**Interfaces (produced):**
- `ApiSchemas["TeacherAllocation"]` gains read-only `class_id`, `class_name`, `section_name`, `subject_name`, `staff_name`. `effective_to: string | null` becomes writable on PATCH only.
- `ApiSchemas["TeacherLoadRow"]` is `{ staff_id, name, weekly_periods, allocations, norm, over_norm }`. `load_summary` documents `academic_session_id` as a required query parameter and returns `TeacherLoadRow[]`.
- List filters gain `class_id`, `campus_id` and `current` (boolean: `effective_to IS NULL`). `search_fields` covers staff first and last name, subject name and section name.
- PATCH returns `{data, meta:{warnings}}`, the same shape as POST.

**`effective_to` semantics (decided here):**

| Change | Rule |
| --- | --- |
| End | PATCH `effective_to` to a date on or before **today** and on or after `effective_from`. A future end date is refused, since today's load summary would drop the row early. |
| Reinstate | PATCH `effective_to: null` on an ended row. This is how a teacher gets the same section and subject back, because `tsa_unique_allocation` (session, section, subject, staff) ignores `effective_to` and would 409 a fresh POST. Reinstating a primary end-dates whoever is the current primary (§6 history), the same as allocating a new one. |
| Future-start primary displaced | When a new or reinstated primary displaces one whose `effective_from` is in the future, the displaced row is end-dated at `max(today, effective_from)`. Today alone would violate `tsa_effective_range_ordered` and 409. This fixes the same latent bug in `_end_date_current_primary` for the create path. |
| End a not-yet-started row | The UI offers Remove (delete) instead, since a row that never started has no history to keep. |

- [ ] **Step 1: Write the failing tests** in `teacher_allocations/tests/test_endpoints.py`, using the existing `_payload` helper and `AcademicsAPITestCase`:

```python
    def _allocate(self, **overrides) -> dict:
        self.allow(
            "academics.teacher-allocation.create",
            "academics.teacher-allocation.update",
            "academics.teacher-allocation.delete",
            "academics.teacher-allocation.view",
        )
        response = self.client.post(
            "/api/v1/teacher-subject-allocations", self._payload(**overrides), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        return response.json()["data"]

    def _close_session(self) -> None:
        with tenant_context(self.tenant.id):
            self.session.status = SessionStatus.CLOSED
            self.session.save(update_fields=["status"])

    def _patch(self, allocation_id: str, body: dict):
        return self.client.patch(
            f"/api/v1/teacher-subject-allocations/{allocation_id}", body, format="json"
        )

    def test_a_patch_on_a_closed_session_is_refused(self) -> None:
        row = self._allocate()
        self._close_session()
        self.assertEqual(self._patch(row["id"], {"weekly_periods": 4}).status_code, 422)

    def test_a_delete_on_a_closed_session_is_refused(self) -> None:
        row = self._allocate()
        self._close_session()
        response = self.client.delete(f"/api/v1/teacher-subject-allocations/{row['id']}")
        self.assertEqual(response.status_code, 422)

    def test_a_patch_to_a_non_teaching_staff_member_is_refused(self) -> None:
        row = self._allocate()
        with tenant_context(self.tenant.id):
            clerk = StaffFactory(
                tenant=self.tenant, campus=self.campus, staff_type=StaffType.NON_TEACHING
            )
        response = self._patch(row["id"], {"staff_id": str(clerk.pk)})
        self.assertEqual(response.status_code, 422)
        self.assertIn("staff_id", {d["field"] for d in response.json()["error"]["details"]})

    def test_a_patch_to_a_subject_outside_the_curriculum_is_refused(self) -> None:
        row = self._allocate()
        with tenant_context(self.tenant.id):
            unrelated = SubjectFactory(tenant=self.tenant)
        response = self._patch(row["id"], {"subject_id": str(unrelated.pk)})
        self.assertEqual(response.status_code, 422)
        self.assertIn("subject_id", {d["field"] for d in response.json()["error"]["details"]})

    def test_making_a_co_teacher_primary_end_dates_the_current_primary(self) -> None:
        """§6 history on PATCH — previously the one-primary constraint surfaced as a 409."""
        primary = self._allocate()
        with tenant_context(self.tenant.id):
            co = StaffFactory(tenant=self.tenant, campus=self.campus)
        co_row = self._allocate(staff_id=str(co.pk), is_primary=False)
        response = self._patch(co_row["id"], {"is_primary": True})
        self.assertEqual(response.status_code, 200, response.json())
        with tenant_context(self.tenant.id):
            old = TeacherSubjectAllocation.objects.get(pk=primary["id"])
        self.assertIsNotNone(old.effective_to)

    def test_ending_an_allocation_sets_effective_to_and_drops_it_from_the_load(self) -> None:
        row = self._allocate()
        today = timezone.localdate().isoformat()
        response = self._patch(row["id"], {"effective_to": today})
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()["data"]["effective_to"], today)
        summary = self.client.get(
            "/api/v1/teacher-subject-allocations/load-summary",
            {"academic_session_id": str(self.session.pk)},
        ).json()["data"]
        self.assertEqual(summary, [])

    def test_a_future_end_date_is_refused(self) -> None:
        row = self._allocate()
        tomorrow = (timezone.localdate() + datetime.timedelta(days=1)).isoformat()
        self.assertEqual(self._patch(row["id"], {"effective_to": tomorrow}).status_code, 400)

    def test_an_end_date_before_the_start_is_refused(self) -> None:
        start = timezone.localdate() - datetime.timedelta(days=5)
        row = self._allocate(effective_from=start.isoformat())
        before = (start - datetime.timedelta(days=1)).isoformat()
        response = self._patch(row["id"], {"effective_to": before})
        self.assertEqual(response.status_code, 400)
        self.assertIn("effective_to", {d["field"] for d in response.json()["error"]["details"]})

    def test_effective_to_is_refused_on_create(self) -> None:
        self.allow("academics.teacher-allocation.create")
        response = self.client.post(
            "/api/v1/teacher-subject-allocations",
            self._payload(effective_to=timezone.localdate().isoformat()),
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_reinstating_an_ended_primary_end_dates_the_current_primary(self) -> None:
        """Reopening is how a teacher gets the same pair back — tsa_unique_allocation
        ignores effective_to, so a second POST for the same staff would 409."""
        first = self._allocate()
        with tenant_context(self.tenant.id):
            replacement = StaffFactory(tenant=self.tenant, campus=self.campus)
        second = self._allocate(staff_id=str(replacement.pk))  # end-dates `first`
        response = self._patch(first["id"], {"effective_to": None})
        self.assertEqual(response.status_code, 200, response.json())
        with tenant_context(self.tenant.id):
            self.assertIsNotNone(TeacherSubjectAllocation.objects.get(pk=second["id"]).effective_to)
            self.assertIsNone(TeacherSubjectAllocation.objects.get(pk=first["id"]).effective_to)

    def test_replacing_a_primary_that_starts_in_the_future_is_not_a_conflict(self) -> None:
        """The outgoing row is end-dated at its own start, never before it."""
        future = (timezone.localdate() + datetime.timedelta(days=30)).isoformat()
        first = self._allocate(effective_from=future)
        with tenant_context(self.tenant.id):
            replacement = StaffFactory(tenant=self.tenant, campus=self.campus)
        self._allocate(staff_id=str(replacement.pk))
        with tenant_context(self.tenant.id):
            old = TeacherSubjectAllocation.objects.get(pk=first["id"])
        self.assertEqual(old.effective_to.isoformat(), future)

    def test_a_patch_reports_load_warnings(self) -> None:
        row = self._allocate()
        body = self._patch(row["id"], {"weekly_periods": 40}).json()
        self.assertEqual(body["meta"]["warnings"][0]["code"], "teacher_over_norm")

    def test_create_and_patch_responses_carry_names(self) -> None:
        """Those instances never pass through get_queryset's annotations."""
        row = self._allocate()
        self.assertEqual(row["section_name"], self.section.name)
        self.assertEqual(row["subject_name"], self.subject.name)
        self.assertEqual(row["class_name"], self.school_class.name)
        self.assertEqual(row["staff_name"], f"{self.teacher.first_name} {self.teacher.last_name}")
        patched = self._patch(row["id"], {"weekly_periods": 2}).json()["data"]
        self.assertEqual(patched["section_name"], self.section.name)

    def test_filters_by_class_campus_and_current(self) -> None:
        row = self._allocate()
        url = "/api/v1/teacher-subject-allocations"
        self.assertEqual(len(self.client.get(url, {"class_id": str(self.school_class.pk)}).json()["data"]), 1)
        self.assertEqual(len(self.client.get(url, {"class_id": str(self.next_class.pk)}).json()["data"]), 0)
        self.assertEqual(len(self.client.get(url, {"campus_id": str(self.campus.pk)}).json()["data"]), 1)
        self._patch(row["id"], {"effective_to": timezone.localdate().isoformat()})
        self.assertEqual(len(self.client.get(url, {"current": "true"}).json()["data"]), 0)
        self.assertEqual(len(self.client.get(url, {"current": "false"}).json()["data"]), 1)

    def test_search_matches_the_teacher_name(self) -> None:
        self._allocate()
        found = self.client.get(
            "/api/v1/teacher-subject-allocations", {"search": self.teacher.last_name}
        ).json()["data"]
        self.assertEqual(len(found), 1)

    def test_load_summary_rows_carry_the_norm(self) -> None:
        self._allocate()
        row = self.client.get(
            "/api/v1/teacher-subject-allocations/load-summary",
            {"academic_session_id": str(self.session.pk)},
        ).json()["data"][0]
        self.assertEqual(row["norm"], services.DEFAULT_WEEKLY_PERIOD_NORM)

    def test_load_summary_with_a_malformed_session_id_is_a_client_error(self) -> None:
        self.allow("academics.teacher-allocation.view")
        response = self.client.get(
            "/api/v1/teacher-subject-allocations/load-summary", {"academic_session_id": "nope"}
        )
        self.assertEqual(response.status_code, 422)
```

  Imports to add: `SessionStatus` from `apps.school_organization.models` and `services` from `apps.academics.teacher_allocations`.

  In `apps/api/apps/academics/tests/test_cross_tenant.py`, following its existing pattern, add:
  - another tenant's `class_id` or `campus_id` on the allocation list returns no rows;
  - PATCH and DELETE on another tenant's allocation return 404.

- [ ] **Step 2: Add `update_allocation` to `services.py`:**

```python
@transaction.atomic
def update_allocation(
    *, allocation: TeacherSubjectAllocation, changes: dict, actor_id: uuid.UUID
) -> TeacherSubjectAllocation:
    """§11 for PATCH — the same rules `create_allocation` applies, on what changed.

    The generic mixin saved PATCHes straight through, so a closed session, a
    non-teaching staff member, or a subject outside the curriculum all slipped
    past, and promoting a co-teacher hit the one-primary constraint as a 409.
    """
    assert_session_writable(allocation.academic_session)
    session = changes.get("academic_session", allocation.academic_session)
    section = changes.get("section", allocation.section)
    subject = changes.get("subject", allocation.subject)
    staff = changes.get("staff", allocation.staff)
    if session != allocation.academic_session:
        assert_session_writable(session)
    if staff != allocation.staff:
        assert_staff_is_active_teacher(staff)
    if (session, section, subject) != (allocation.academic_session, allocation.section, allocation.subject):
        assert_subject_in_class_curriculum(session=session, section=section, subject=subject)

    effective_to = changes.get("effective_to", allocation.effective_to)
    effective_from = changes.get("effective_from", allocation.effective_from)
    assert_end_date_valid(effective_from=effective_from, effective_to=effective_to)

    is_primary = changes.get("is_primary", allocation.is_primary)
    primary_slot_changed = (session, section, subject) != (
        allocation.academic_session, allocation.section, allocation.subject
    )
    becoming_current_primary = is_primary and effective_to is None and (
        not allocation.is_primary or allocation.effective_to is not None or primary_slot_changed
    )
    if becoming_current_primary:
        _end_date_current_primary(
            session=session, section=section, subject=subject,
            actor_id=actor_id, exclude_pk=allocation.pk,
        )

    for field, value in changes.items():
        setattr(allocation, field, value)
    allocation.updated_by = actor_id
    allocation.save()
    return allocation


def assert_end_date_valid(*, effective_from: date | None, effective_to: date | None) -> None:
    """An end date is in the past or today, and never before the start."""
    if effective_to is None:
        return
    if effective_to > timezone.localdate():
        raise DomainRuleViolation({"effective_to": "An allocation cannot be ended in the future."})
    if effective_from and effective_to < effective_from:
        raise DomainRuleViolation({"effective_to": "The end date cannot be before the start date."})


def assert_allocation_deletable(allocation: TeacherSubjectAllocation) -> None:
    assert_session_writable(allocation.academic_session)
```

  **`_end_date_current_primary`**, the one copy shared by create and PATCH. It gains `exclude_pk=None` and ends each displaced row at `max(today, its effective_from)`:

```python
def _end_date_current_primary(
    *, session, section, subject, actor_id, exclude_pk=None
) -> None:
    today = timezone.localdate()
    outgoing = TeacherSubjectAllocation.objects.alive().filter(
        academic_session=session, section=section, subject=subject,
        is_primary=True, effective_to__isnull=True,
    )
    if exclude_pk is not None:
        outgoing = outgoing.exclude(pk=exclude_pk)
    # A primary lined up to start later is ended at its own start: ending it
    # "today" would put effective_to before effective_from (tsa_effective_range_ordered).
    outgoing.update(
        effective_to=Greatest(Coalesce(F("effective_from"), Value(today)), Value(today)),
        updated_by=actor_id,
        updated_at=timezone.now(),
    )
```

  Imports: `Greatest`, `Coalesce` from `django.db.models.functions`; `F`, `Value` from `django.db.models`. `timezone.localdate()` replaces `timezone.now().date()`. The commit body says why: the tenant's local date is the date the rest of the module compares against.

  **Serializer `validate`:**
  - reject `effective_to` when `self.instance is None`;
  - otherwise call `services.assert_end_date_valid(effective_from=attrs.get("effective_from", self.instance.effective_from), effective_to=attrs.get("effective_to", self.instance.effective_to))` and re-raise as a `serializers.ValidationError` keyed on `effective_to`, so a field error comes back as a 400.

  The service-level check stays as a backstop for non-API callers.

- [ ] **Step 3: Wire up the viewset and serializer.**
  - **`TeacherAllocationViewSet.partial_update`/`update`:**
    - validate with `self.get_serializer(instance, data=request.data, partial=True)`;
    - call `services.update_allocation(...)`;
    - audit with before/after;
    - `notify_allocation_changed` only when `staff` changed;
    - return `Response({"data": body, "meta": {"warnings": services.load_warnings(staff=..., session=...)}})`.
  - **`perform_destroy`:** calls `services.assert_allocation_deletable` before `super()`.
  - **Search:** add `search_fields = ["staff__first_name", "staff__last_name", "subject__name", "section__name"]`.
  - **Serializer:**
    - drop `effective_to` from `read_only_fields`;
    - `validate` as described in Step 2;
    - add the read-only name fields. Every one needs an **explicit `source=`**: `get_queryset` annotates `section_name`/`subject_name`, so a field without a source would read an annotation that the instances returned by create and PATCH don't carry, and 500.

```python
    class_id = serializers.UUIDField(source="section.school_class_id", read_only=True)
    class_name = serializers.CharField(source="section.school_class.name", read_only=True)
    section_name = serializers.CharField(source="section.name", read_only=True)
    subject_name = serializers.CharField(source="subject.name", read_only=True)
    staff_name = serializers.SerializerMethodField()

    def get_staff_name(self, obj) -> str:
        return f"{obj.staff.first_name} {obj.staff.last_name}"
```
  - **`get_queryset`:** add `"section__school_class"` to `select_related`.
  - **Filters** (`TeacherAllocationFilterSet`): `class_id = UUIDFilter(field_name="section__school_class_id")`, `campus_id = UUIDFilter(field_name="section__campus_id")`, and `current = BooleanFilter(field_name="effective_to", lookup_expr="isnull")`.
  - **Load summary:**
    - validate the query with a small `LoadSummaryQuerySerializer` (`academic_session_id = serializers.UUIDField()`). A missing or malformed id is a 422 (`DomainRuleViolation`, today's status for a missing id), never a 500. A well-formed id still goes through `get_object_or_404`, so an unknown or other-tenant session stays a 404, as it is today.
    - `TeacherLoadRowSerializer` (fields above);
    - `@extend_schema(parameters=[OpenApiParameter("academic_session_id", OpenApiTypes.UUID, required=True)], responses={200: TeacherLoadRowSerializer(many=True)})`;
    - add `"norm": services.DEFAULT_WEEKLY_PERIOD_NORM` to each row and render through the serializer.
- [ ] **Step 4: Regenerate both contract files and commit.** `feat(api): allocation names, filters, search, ending and §11 rules on PATCH/DELETE`

### Task 6: Dashboard services for allocations

**Files:**
- **Create:** `apps/dashboard/src/services/modules/teacher-allocations/` with the five files plus `index.ts`, and `__tests__/teacher-allocations-service.test.ts`.
- **Modify:**
  - `endpoints.ts`: add `teacherAllocations: { list, detail(id), loadSummary }` and remove `dashboard.teacherLoadSummary` once its consumer has moved
  - `services/index.ts`
  - `services/modules/dashboard/dashboard-service.ts`: grep `fetchTeacherLoadSummary`; move its consumers to `Services.teacherAllocations.fetchLoadSummary` and delete the dashboard copy and its hand-written `TeacherLoadSummaryRow`
  - `services/modules/staff/staff-type.ts`, `staff-constant.ts`: add `staffType?: "teaching" | "non_teaching"` to `StaffDirectoryQuery` and `["staffType", "staff_type"]` to `STAFF_QUERY_FIELDS`

**Interfaces (produced):**

```ts
export type TeacherAllocationRecord = ApiSchemas["TeacherAllocation"];
export type TeacherLoadRow = ApiSchemas["TeacherLoadRow"];
/** `meta.warnings` on POST/PATCH — meta is outside the generated per-path schema. */
export interface TeacherLoadWarning { code: "teacher_over_norm"; staff_id: string; weekly_periods: number; norm: number }
export interface AllocationSaveResult { allocation: TeacherAllocationRecord; warnings: TeacherLoadWarning[] }
export interface TeacherAllocationPageQuery {
  page?: number; pageSize?: number; search?: string; ordering?: string;
  academicSessionId: string; classId?: string; sectionId?: string; subjectId?: string;
  staffId?: string; current?: boolean;
}
export interface AllocateTeacherInput {
  academicSessionId: string; sectionId: string; subjectId: string; staffId: string;
  isPrimary: boolean; weeklyPeriods: number | null; effectiveFrom: string | null;
}
export interface UpdateAllocationInput { isPrimary?: boolean; weeklyPeriods?: number | null; effectiveFrom?: string | null; effectiveTo?: string | null }

export function fetchAllocationsPage(q: TeacherAllocationPageQuery): Promise<Page<TeacherAllocationRecord>>;
export function allocateTeacher(input: AllocateTeacherInput): Promise<AllocationSaveResult>;
export function updateAllocation(id: string, input: UpdateAllocationInput): Promise<AllocationSaveResult>;
export function endAllocation(id: string, effectiveTo: string): Promise<AllocationSaveResult>; // PATCH {effective_to}
export function reinstateAllocation(id: string): Promise<AllocationSaveResult>;               // PATCH {effective_to: null}
export function deleteAllocation(id: string): Promise<void>;
export function fetchLoadSummary(academicSessionId: string): Promise<TeacherLoadRow[]>;
// Services.teacherAllocations
// staff: fetchTeachingStaffOptions(): collectPages over /staff?staff_type=teaching&employment_status=active
```

  `allocateTeacher` and `updateAllocation` need `meta`. Check how `apiClient.post` exposes it (the `{ data, meta }` return of `@schoolhub/api-client`'s request helper) and read `meta.warnings ?? []`.

- [ ] **Step 0: Hoist before repeating.** PR A's curriculum screen wrote these inline; the allocation screen would be their next copy, so lift each to a shared home first (one commit, `refactor(dashboard): hoist the list-screen pieces PR A left inline`), then build on the shared version:
  - the sorting → `?ordering=` expression, as `toOrdering(sorting, sortFieldMap)` in `src/lib/helpers.ts`: it is inline in `student-directory-table.tsx`, `staff-directory-table.tsx` and `curriculum-table.tsx` (a third copy), so migrate all three;
  - a shared `LoadErrorCard` and the no-session card, from `curriculum-table.tsx`;
  - the search box with its clear button, from `curriculum-filters.tsx`;
  - shared reference-data query hooks for campuses, classes and subjects, in place of each form and filter declaring its own `useQuery`;
  - the Select-in-FormField blocks (`SessionField` in `clone-curriculum-dialog.tsx`, `SelectField` in `curriculum-form-fields.tsx`) as one component;
  - `SESSIONS` and the other fixtures in `services/modules/curriculum/__tests__/curriculum-fixtures.ts`, moved to a shared test-fixtures location the allocation tests can import without reaching into the curriculum module.
- [ ] **Step 1: Write the failing service tests** covering endpoints, query and body mapping, warnings passthrough, `endAllocation` sending only `effective_to`, and `staff_type=teaching&employment_status=active` on the teacher options fetch.
- [ ] **Step 2: Implement.** Commit: `feat(dashboard): teacher-allocation services and teaching-staff options`

### Task 7: Allocation screen

**Files:**
- **Create** in `apps/dashboard/src/features/academics/allocations/`:
  - `allocation-table.tsx`, `allocation-filters.tsx`, `allocation-columns.tsx`, `allocation-toolbar.tsx`
  - `allocate-teacher-dialog.tsx`, `edit-allocation-dialog.tsx`
  - `end-allocation-dialog.tsx`, `reinstate-allocation-dialog.tsx`, `delete-allocation-dialog.tsx`
  - `teacher-load-panel.tsx`
- **Create:** `app/(app)/academics/allocations/page.tsx`
- **Modify:**
  - `teacher-allocations-constant.ts`, `teacher-allocations.schema.ts`
  - `features/academics/academics-sections.ts`: add the Allocations section (`academics.teacher-allocation.view`). The nav tabs and landing pick it up from there.
  - `menu-config.ts`: add the "Teacher allocation" child with `permission: "academics.teacher-allocation.view"`
  - `src/lib/helpers.ts`: add `todayIsoDate()`
  - both message files
- **Test** (in `features/academics/allocations/__tests__/`): `allocation-table.test.tsx`, `allocate-teacher-dialog.test.tsx`, `edit-allocation-dialog.test.tsx`, `end-allocation-dialog.test.tsx`, `teacher-load-panel.test.tsx`

**Interfaces:**

```ts
export const ALLOCATION_SORT_FIELD = { section: "section_name", subject: "subject_name", teacher: "staff_last_name", weeklyPeriods: "weekly_periods", effectiveFrom: "effective_from", role: "is_primary" };
export const ALLOCATION_DEFAULT_SORTING = [{ id: "section", desc: false }];
export const ALLOCATION_STATE = { current: "current", ended: "ended", all: FILTER_ALL } as const;
export const ALLOCATION_URL_FILTERS = {
  session: { default: "", isValid: isUuid },
  class: { default: "", isValid: isUuid },
  section: { default: "", isValid: isUuid },
  subject: { default: "", isValid: isUuid },
  teacher: { default: "", isValid: isUuid },
  state: { default: ALLOCATION_STATE.current, isValid: (v) => Object.values(ALLOCATION_STATE).includes(v) },
};
```

**Behaviour:**
- **Session.** Same resolution and locked behaviour as curriculum, through `useAcademicSession`.
- **Load panel** (`teacher-load-panel.tsx`): a card above the table listing `fetchLoadSummary(session.id)` rows (name, allocations, weekly periods, a Within/Over norm `Badge`), sorted over-norm first, with `loadSummary.normHint` showing `{norm}` from the first row. It shows an empty state when there are no rows and does not fetch without a session.
- **Table:**
  - **Query.** Sends `current: true` for `state=current`, `false` for `ended`, and omits it for all.
  - **Section filter** cascades off class, reusing the students table's class→section single-write pattern and stale-section drop (`setFilters({ class, section: "" })`).
  - **Columns:**

    | Column | Content |
    | --- | --- |
    | Section | "{class_name} · {section_name}" |
    | Subject | `subject_name` |
    | Teacher | `staff_name` |
    | Role | Primary / Co-teacher badge |
    | Weekly periods | the override, or "—" (curriculum default) |
    | Effective | `allocations.current`, or `allocations.endedOn` |
    | Actions | Edit (`.update`); End (`.update`, current rows whose `effective_from` is today or earlier, or empty); Reinstate (`.update`, ended rows); Remove (`.delete`). All hidden when locked. A row that hasn't started yet offers Remove rather than End. |
- **Allocate dialog:**
  - **Field cascade:** class (active) → section (`fetchSections({classId, isActive:true})`) → subject → teacher → primary switch (default on, with `allocations.form.isPrimaryHint`) → weekly periods (optional, with `weeklyPeriodsHint`) → effective from (optional date).
  - **Subject options** come from `Services.curriculum.fetchCurriculumForClass(session.id, classId)`, so only valid subjects are offered. An empty list shows `allocations.form.description` as a hint.
  - **Teacher options** come from `fetchTeachingStaffOptions()`.
  - **Over-norm warnings:** on success, a non-empty `warnings` toasts `allocations.overNormWarning` with `{periods, norm}` as a warning; the save still succeeds.
  - **Errors:** 422 field errors map to `staff_id`/`subject_id`/`section_id`, falling back to `non_field`.
  - **Invalidation:** `["teacher-allocations"]`, which also covers the load panel's key (`queryKeys.list("teacher-allocations", "load-summary", {sessionId})`).
- **Edit dialog:** identity fields are shown read-only. The editable fields are primary, weekly periods (empty → `null`) and effective from. It shows the same warnings toast.
- **End dialog** (`ResponsiveAlertDialog`, `allocations.end.*`): PATCH `effective_to` = today. A 400/422 shows inline. "Today" comes from a new `todayIsoDate()` in `src/lib/helpers.ts`: `format(new Date(), "yyyy-MM-dd")` with the date-fns `format` that file already imports, so it's the viewer's local date, not UTC's `toISOString`. It has its own test in `src/lib/__tests__/helpers.test.ts`.
- **Reinstate dialog** (`reinstate-allocation-dialog.tsx`, `ResponsiveAlertDialog`, `allocations.reinstate.*`): PATCH `effective_to: null`. The description says a reinstated primary replaces the current primary teacher.
- **Invalidation** for every dialog: `queryKeys.module("teacher-allocations")` (the list and the load panel). Curriculum isn't affected.
- **Delete dialog:** `allocations.delete.*` copy (for mistakes only), with a 422 inline.

**New i18n keys:**
- `allocations.list.noMatches`, `allocations.list.loadError`
- `allocations.filters.state`, `allocations.filters.current`, `allocations.filters.ended`
- `allocations.saved`, `allocations.ended`, `allocations.removed`, `allocations.reinstated`
- `allocations.actions.reinstate`, `allocations.reinstate.title`, `allocations.reinstate.description`
- `allocations.form.editTitle`, `allocations.form.noCurriculumSubjects`
- `allocations.curriculumDefault`

- [ ] **Step 1: Write the failing tests.**
  - **Table:**
    - the URL deep link sends the matching query (`current` mapping included);
    - a class change clears section in one write;
    - locked hides actions;
    - permission gating;
    - stale-page 404.
  - **Allocate:**
    - subject options are the curriculum's rows for the chosen class;
    - the POST body;
    - warnings toast and the dialog closes;
    - a 422 on `staff_id` lands on the teacher field.
  - **Edit:** only editable fields are sent; clearing weekly periods sends `null`.
  - **End:** sends `todayIsoDate()`; a 400 stays inline; a row with a future `effective_from` shows Remove, not End.
  - **Reinstate:** sends `effective_to: null` and shows only on ended rows.
  - **Load panel:** no fetch without a session; over-norm rows sort first; the norm hint uses the row's `norm`.
- [ ] **Step 2: Implement.** Domain cues come from `git show 9548054^:.../allocations-screen.tsx`, `allocation-form.tsx` and `teacher-load-summary.tsx`. Commit: `feat(dashboard): teacher allocation screen with load summary`

### Task 8: PR B E2E, docs, and opening the PR

- [ ] **Mocks and page object.** Add `e2e/src/mocks/domains/academics-allocations.ts` (list with filters, POST/PATCH returning `meta.warnings`, DELETE, load-summary, `fail(404)` past the last page), `e2e/src/pages/dashboard/academics/allocations.page.ts`, the barrels and the fixture.
- [ ] **Spec** `e2e/tests/dashboard/academics-allocations.spec.ts`:
  - allocate a teacher and assert the body and the over-norm toast from a stubbed warning;
  - end an allocation and assert the PATCH body is `{effective_to}`, then reinstate it and assert `{effective_to: null}`;
  - a user with only `academics.promotion.view` sees no Curriculum or Teacher allocation sidebar links, and `/academics` lands them on Promotions (PR C adds that last assertion);
  - filter by ended;
  - reload keeps the filters.
- [ ] **Docs:**
  - `academics.md` §20 gets a **"Dashboard, teacher allocation (as shipped)."** paragraph. The implementation notes record:
    - the PATCH rules;
    - the `effective_to` semantics table (end, reinstate, future-start displacement);
    - the new filters and search;
    - the per-row `norm`;
    - the malformed-id 422 on the load summary;
    - the §2.1 argument.
  - `docs/05-database/entities/academics.md`: `teacher_subject_allocations.effective_to` is "set by End/Reinstate on PATCH, never on create; never in the future".
  - `deferred-work.md` gets the §9 drag-and-drop allocation grid, tenant-configured load norm (still `DEFAULT_WEEKLY_PERIOD_NORM = 30`), the "My allocations" teacher view, the coverage gap notification, and the `allocations` count that includes future-dated rows.
  - `project-status.md` gets the status update.
- [ ] **Review and open the PR:** `change-reviewer` → fix pass → user go-ahead → PR → watch CI.

---

# PR C: Promotions

### Task 9: Backend: promotion contract and the skipped-level rule

**Files:**
- **Modify:**
  - `apps/api/apps/academics/promotions/serializers.py`, `viewset.py`, `services.py`
  - `apps/api/config/settings/base.py` (`ENUM_NAME_OVERRIDES`)
- **Test:** `apps/api/apps/academics/promotions/tests/test_promotion.py`, `test_endpoints.py`
- **Regenerate:** both contract files

**Interfaces (produced):**
- `PromotionBatch.status` becomes a `ChoiceField(choices=PromotionStatus.choices)`, named `PromotionStatusEnum` via `ENUM_NAME_OVERRIDES` (`"PromotionStatusEnum": "apps.academics.models.PromotionStatus"`). This also renames the decision rows' `PromotionDecisionStatusEnum`; grep the dashboard and e2e for the old name. The exploration found no consumer.
- `PromotionBatch` gains `from_class_name`, `from_academic_session_name`, `to_academic_session_name`.
- `PromotionDecision` gains `from_class_name`, `to_class_name | null`, `to_section_name | null`.
- New response serializers:
  - `PromotionBatchDetail` = `PromotionBatch` fields + `decisions: PromotionDecision[]` (GET `/{id}`)
  - `PromotionBatchCreated` = `{batch_id, students}` (POST 201)
  - `PromotionTransitionResult` = `{updated}` (`:submit`/`:approve`/`:reject`/`:revert`, replacing the wrong `PromotionBatch` and `None` annotations)

**Rule change (§11, "the target is the next level; a skip needs a reason"):**
- `create_promotion_batch` records the proposal in `decision_basis`: `"proposed_decision"` and `"proposed_to_class_id"` (`str(target.pk)` or `None`).
- `_assert_decisions_complete` requires `override_reason` where **either** the decision **or** `to_class_id` differs from the proposal. For legacy rows without `proposed_to_class_id`, fall back to `next_class_for(from_class)` (one query per distinct `from_class`, cached in a dict).
- `_proposed_decision` reads only the recorded proposal, never the row's *current* `to_class_id`. The current code derives the "proposal" from the edited value, so clearing a target class silently changes what counts as an override.
- **Legacy rows** (batches created before this deploy, with no `proposed_*` keys): fall back to `next_class_for(from_class)`, whose ladder is today's, not the one at creation. That can only differ if a class's `level` changed mid-rollover. Such a batch is still in draft or review, and the consequence is at most an extra "reason required" prompt at submit. The fallback stays rather than being dropped, because the live database may hold open drafts. The implementation notes say so.
- **No section-at-submit rule** (the user's call; see Alternatives). Submit stays as it is. Execute keeps reporting a missing section per student.

- [ ] **Step 1: Write the failing tests:**
  - `test_submit_requires_a_reason_when_the_target_class_skips_a_level`: decision stays `promoted`, `to_class` is set to a level+2 class, no reason → 422 `override_reason`. With a reason → 200.
  - `test_clearing_the_target_class_does_not_move_the_proposal`: set graduated (class cleared) on a promotable row, no reason → 422. The old derived proposal would have accepted it.
  - `test_the_proposal_is_recorded_at_creation`: `decision_basis` has `proposed_decision` and `proposed_to_class_id`.
  - `test_a_legacy_row_without_a_recorded_proposal_falls_back_to_the_next_level`: strip the keys from `decision_basis` and assert submit behaves as above.
  - `test_batch_detail_matches_its_serializer`: response keys equal `PromotionBatchDetailSerializer` fields, and each decision's keys equal `PromotionDecisionSerializer` fields.
  - `test_transitions_return_the_updated_count` for each of submit/approve/reject/revert.
  - `test_batch_list_carries_names_and_still_groups_one_row_per_batch`: two batches → two rows, with names. This guards the GROUP BY reasoning in `AggregateOrderingFilter`.
  - `test_ordering_by_students_still_groups_one_row_per_batch`: the names added to `.values()` must not un-group an ordered list.

  Existing tests are unaffected by the override rule only where they leave decision and class at the proposal. Grep `override_reason` and `to_class` in `promotions/tests/` and add a reason wherever a test edits the class away from level+1 before submitting.

- [ ] **Step 2: Implement.**
  - **Batch list names:** add the three names to `get_queryset`'s `.values(...)` via `F` annotations (`from_class_name=F("from_class__name")`, etc.). Each is functionally dependent on an id already grouped on, so the grouping is unchanged. Add one sentence to the docstring saying so.
  - **`retrieve`:** build `summary` with the names and render through `PromotionBatchDetailSerializer`.
  - **Decision names:** `select_related` adds `to_section`, and the decision serializer reads names via `source="to_class.name"` with `allow_null`, or a `SerializerMethodField` typed `str | None`.
- [ ] **Step 3: Regenerate and commit.**
  - **Read the `openapi.yaml` diff before committing.** `ENUM_NAME_OVERRIDES` applies to *every* field with the same choice set. The only renames should be `PromotionDecisionStatusEnum` → `PromotionStatusEnum` at its three promotion sites. Any other status enum renamed means the override is too broad: drop it and name the field with `@extend_schema_field` instead.
  - Commit: `feat(api): typed promotion responses, names, and the skipped-level reason at submit`

### Task 10: Promotion services

**Files:**
- **Create:** `apps/dashboard/src/services/modules/promotions/` with the five files plus `index.ts`, and `__tests__/promotions-service.test.ts`.
- **Modify:** `endpoints.ts`, `services/index.ts`.

```ts
promotions: {
  list: "/student-promotions",
  detail: (batchId: string) => `/student-promotions/${batchId}`,
  decision: (batchId: string, studentId: string) => `/student-promotions/${batchId}/decisions/${studentId}`,
  submit: (id: string) => `/student-promotions/${id}:submit`,
  approve: (id: string) => `/student-promotions/${id}:approve`,
  reject: (id: string) => `/student-promotions/${id}:reject`,
  execute: (id: string) => `/student-promotions/${id}:execute`,
  revert: (id: string) => `/student-promotions/${id}:revert`,
},
```

```ts
export type PromotionBatchRecord = ApiSchemas["PromotionBatch"];
export type PromotionBatchDetail = ApiSchemas["PromotionBatchDetail"];
export type PromotionDecisionRecord = ApiSchemas["PromotionDecision"];
export type PromotionStatus = ApiSchemas["PromotionStatusEnum"];
export type PromotionDecisionValue = ApiSchemas["PromotionDecisionEnum"];
export type PromotionTransition = "submit" | "approve" | "reject" | "revert";
/** The `promotion.execute` job's `result` (apps/api/apps/academics/promotions/services.py execute_batch). */
export interface PromotionExecutionReport {
  enrolled: { student_id: string }[]; graduated: { student_id: string }[];
  skipped: { student_id: string; reason: string }[]; failed: { student_id: string; error: string }[];
}
export interface PromotionBatchesQuery { page?: number; pageSize?: number; ordering?: string; status?: string; fromAcademicSessionId?: string; fromClassId?: string }
export interface CreatePromotionBatchInput { fromAcademicSessionId: string; toAcademicSessionId: string; classId: string }
export interface UpdateDecisionInput { decision?: PromotionDecisionValue; toClassId?: string | null; toSectionId?: string | null; overrideReason?: string | null; remarks?: string | null }

export function fetchPromotionBatches(q: PromotionBatchesQuery): Promise<Page<PromotionBatchRecord>>;
export function fetchPromotionBatch(batchId: string): Promise<PromotionBatchDetail>;
export function createPromotionBatch(input: CreatePromotionBatchInput): Promise<ApiSchemas["PromotionBatchCreated"]>;
export function updateDecision(batchId: string, studentId: string, input: UpdateDecisionInput): Promise<PromotionDecisionRecord>;
export function transitionBatch(batchId: string, action: PromotionTransition, idempotencyKey: string): Promise<ApiSchemas["PromotionTransitionResult"]>;
export function executeBatch(batchId: string, idempotencyKey: string): Promise<JobAccepted>;
// promotions-constant.ts: PROMOTION_STATUSES, PROMOTION_DECISIONS, PROMOTION_EXECUTE_JOB_MODULE = "promotions",
//   PROMOTION_URL_FILTERS { status, session, class }, PROMOTION_SORT_FIELD { status, students, startedAt: "started_at" },
//   PROMOTION_DEFAULT_SORTING = [] (server default -started_at), OVERRIDE_REASON_MAX = 500, REMARKS_MAX = 500
```

- [ ] **Step 1: Write the failing tests** (endpoints, bodies, idempotency key on transitions and execute) and implement. Commit: `feat(dashboard): promotion services`

### Task 11: Batch list and creating a batch

**Files:**
- **Create:**
  - `apps/dashboard/src/features/academics/promotions/`: `promotion-batch-table.tsx`, `promotion-batch-columns.tsx`, `promotion-batch-filters.tsx`, `promotion-batch-toolbar.tsx`, `create-promotion-batch-dialog.tsx`, `promotion-status-badge.tsx`
  - `app/(app)/academics/promotions/page.tsx`
- **Modify:** `academics-sections.ts` (Promotions, `academics.promotion.view`), `menu-config.ts` (the "Promotions" child with `permission: "academics.promotion.view"`), both message files.
- **Test:** `promotion-batch-table.test.tsx`, `create-promotion-batch-dialog.test.tsx`

**Behaviour:**
- **Table** (`useDataGridUrlState` with the filters status/session/class):
  - Columns: From class, Sessions (`promotions.sessionPair`), Students (numeric), Status (`PromotionStatusBadge`), Started (relative time).
  - Sortable by status, students and started.
  - A row click navigates to `promotionBatchPath(batch_id)` through `next/link`; the row has a link cell, so the keyboard works too.
  - Not session-scoped: the session filter is optional, and empty means all.
- **Create dialog** (`promotion.create`):
  - from session (defaults to current), to session (excludes from and locked sessions), class (active).
  - On 201 it navigates to the new batch.
  - A 409 ("a batch already exists") and a 422 (no enrolments, locked target, same session) show inline under `non_field`/`class_id`.
- **Status badge** variants: draft → secondary, pending_approval → warning, approved → info, executed → success, reverted → destructive. Use theme variants only, and labels from `promotions.status.*`.

**New i18n keys:** `promotions.list.noMatches`, `promotions.list.loadError`, `promotions.created`, `promotions.filters.status`

- [ ] **Step 1: Write the failing tests:**
  - deep link `?status=pending_approval&sort=-students` → query;
  - a row link points at the batch path;
  - create sends the snake_case body and navigates on success (mock `useRouter().push` through the navigation mock);
  - a 409 stays inline;
  - users without `promotion.create` see no "New batch".
- [ ] **Step 2: Implement and commit.** `feat(dashboard): promotion batch list and batch creation`

### Task 12: Batch review page: decisions, transitions, execute

**Files:**
- **Create:**
  - `app/(app)/academics/promotions/[batchId]/page.tsx`: a server component that validates the id with `isUuid` and calls `notFound()` otherwise, then renders `<PromotionBatchReview batchId=…/>`. Follow `next-best-practices` for the async `params` in Next 16.
  - In `features/academics/promotions/`: `promotion-batch-review.tsx`, `promotion-batch-header.tsx`, `promotion-batch-actions.tsx`, `promotion-transition-dialog.tsx`, `promotion-decision-table.tsx`, `promotion-decision-dialog.tsx`, `promotion-execution-report.tsx`, `use-promotion-execution.ts`
- **Test:** `promotion-batch-actions.test.tsx`, `promotion-transition-dialog.test.tsx`, `promotion-decision-dialog.test.tsx`, `promotion-decision-table.test.tsx`, `use-promotion-execution.test.tsx`, `promotion-execution-report.test.tsx`

**Behaviour:**
- **Review** (`promotion-batch-review.tsx`):
  - `useQuery(queryKeys.detail("promotions", "batch", batchId), () => fetchPromotionBatch(batchId))`.
  - A 404 shows the not-found empty state with a link back.
  - Renders the header, actions, report and decision table.
- **Header:** title `promotions.review.title`, class and session pair, student count, and **one** `PromotionStatusBadge`. The live page object matches status text exactly, so no other element on the page may render the bare status label. In the decision table, a row's status shows only as part of a longer string or not at all, because a batch's rows share one status.
- **Actions** (`promotion-batch-actions.tsx`), gated by status × permission:

  | Status | Buttons |
  | --- | --- |
  | draft | Submit for approval (`.update`), Revert (`.update`) |
  | pending_approval | Approve (`.approve`), Reject (`.approve`), Revert (`.update`) |
  | approved | Execute (`.execute`), Revert (`.update`) |
  | executed | Revert (`.update`; the server refuses with 409 once downstream enrolments exist, shown inline) |
  | reverted | none |

  - Each opens `PromotionTransitionDialog` (`ResponsiveAlertDialog`, destructive variant for reject and revert), with one idempotency key per dialog instance.
  - The dialog's confirm button is labelled with the same action text ("Submit for approval", "Approve", "Execute", …). The page object scopes confirm locators to the `alertdialog` (Task 13), so the page-level trigger and the dialog button never collide in Playwright strict mode.
  - Errors (422 segregation of duties, the 422 override-reason count, 409 status race) show inline through `resolveErrorMessage(..., "non_field")` and the dialog stays open.
  - Success invalidates exactly `queryKeys.detail("promotions", "batch", batchId)` and the list prefix `["promotions", "batches"]`, never the bare `["promotions"]`. That prefix also matches `queryKeys.jobWatch("promotions", …)` and would refetch a live execute poll.
- **Missing-section notice:** in `draft` and `approved`, when any non-graduating decision has no `to_section_id`, an `Alert` above the decisions reads "{count} students have no target section and will fail on execute" (`promotions.review.missingSections`). It's advisory: submit and execute stay enabled.
- **Execute:** `use-promotion-execution.ts` ports the deleted `promotion-batch-actions.tsx` logic:
  - a fresh key per execute intent, reused on retry;
  - `executeBatch` → `job_id`;
  - `useJobPolling("promotions", jobId)`;
  - while polling, the Execute button is disabled with `isLoading`, and `promotions.report.running` shows `{progress}`;
  - on success, invalidate the batch's detail and list keys (as above, never the `jobWatch` key) so the status shows `Executed`, and keep the job's `result` for the report;
  - on job failure, show `promotions.report.jobFailed`;
  - on poll timeout, use `resume`.
- **Report** (`promotion-execution-report.tsx`): counts from `promotions.report.*`. Failed and skipped students are listed **by name**, mapped from the batch's decisions by `student_id`, with the reason or error.
- **Decision table:**
  - Data comes from `detail.decisions`, **paged client-side** (TanStack `getPaginationRowModel`, `DATA_GRID_PAGE_SIZES`), with no URL state, because it is a sub-list of one page. It shows every row however many there are.
  - Columns: Student (`student_name` + `admission_number`), Decision badge (`promotions.decisionValue.*`), Target class (`to_class_name` or "—"), Target section (`to_section_name` or a warning-tinted "Not set" when not graduating), Override reason, Remarks, and Edit (only when status is `draft` and the user has `.update`).
  - A client-side search over student name and admission number.
- **Decision dialog** (`ResponsiveDialog`, react-hook-form + zod):
  - Fields: decision select, target class (`fetchClasses({isActive:true})`), target section (cascades off class), override reason (with `promotions.fields.overrideReasonHint`), remarks.
  - **Rules mirrored client-side:**
    - graduated → class and section are cleared and disabled;
    - retained → class is fixed to `from_class_id`;
    - a different decision or class from the proposal (`decision_basis.proposed_*`) → the override-reason hint is shown as required. The server is the authority at submit.
  - Sends only changed fields.
  - A 400/409/422 maps to fields or `non_field`.

**New i18n keys:**
- `promotions.review.notFoundTitle`, `promotions.review.notFoundDescription`
- `promotions.fields.sectionNotSet`, `promotions.review.missingSections`
- `promotions.transition.{submit,approve,reject,revert}.{title,description}`
- `promotions.searchStudents`
- `promotions.report.failedStudent`, `promotions.report.skippedStudent`

- [ ] **Step 1: Write the failing tests.**
  - **Actions:**
    - the matrix above for each status, with and without each key;
    - the preparer-approval 422 stays inline and keeps the dialog open;
    - one key per instance is reused on retry;
    - success invalidates the detail and list keys but not the `jobWatch` key;
    - the missing-section notice shows the right count and hides when every row has a section.
  - **Execution hook:**
    - double-click sends one request;
    - a retry after a network error reuses the key;
    - poll success invalidates the batch;
    - job failure shows the failure message;
    - timeout calls `resume`.
  - **Report:** a failed student is listed by name.
  - **Decision table:** a 130-decision batch pages 13 × 10 and the last page shows rows 121–130; Edit is hidden outside draft; the missing-section marker appears.
  - **Decision dialog:**
    - graduated clears and disables class and section and sends `to_class_id: null, to_section_id: null`;
    - retained fixes the class;
    - a server 400 on `to_class_id` lands on that field.
- [ ] **Step 2: Implement and commit.** `feat(dashboard): promotion batch review, decisions, transitions and execution`

### Task 13: PR C E2E, live page object, docs, and opening the PR

- [ ] **Mocked lane.**
  - `e2e/src/mocks/domains/academics-promotions.ts` is a stateful mock modelled on `student-transfers.ts`. A batch's status moves with each transition. `:approve` can be set to return the 422 segregation-of-duties error. `:execute` returns 202 with a job that `jobs.ts` resolves to a report with one failure.
  - Spec `e2e/tests/dashboard/academics-promotions.spec.ts`:
    - create a batch → land on its page;
    - edit a decision to retained and assert the PATCH body;
    - submit → Pending approval;
    - an approver sees Approve but not Submit;
    - the preparer's approve shows the inline 422;
    - execute shows the report with the failed student's name.
- [ ] **Live lane: update the page object and spec in this PR.** Both currently assume one click per transition.
  - **`e2e/src/pages/dashboard/academics/promotion-batch.page.ts`:**
    - delete the "Provisional: this screen does not exist yet" header;
    - add `confirmDialog = page.getByRole("alertdialog")` and `confirm(name)`, which is `confirmDialog.getByRole("button", { name, exact: true })`;
    - add intent methods `submitForApprovalAndConfirm()`, `approveAndConfirm()` and `executeAndConfirm()`, each clicking the trigger and then `confirm(sameName)`;
    - check the `statusBadge` locator still matches exactly one element (the header badge).
  - **`e2e/tests/live/academics-promotion-journey.spec.ts`:**
    - replace the three bare `.click()`s with the confirm methods;
    - keep the `toHaveCount(0)` permission assertions on the page-level triggers;
    - rewrite its stale "The screens are unbuilt" header;
    - wait for `Executed` with the poll's own timeout, not a new one.
  - **Mocked mirror.** The mocked-lane promotions spec uses the same page-object methods, so the PR gate exercises the confirm flow the nightly lane depends on.
  - After merge, ask the user before dispatching `e2e-live.yml`; a dispatch is outward-facing.
- [ ] **Docs.**
  - **`academics.md`:**
    - a **"Dashboard, promotions (as shipped)."** paragraph inside §20;
    - §11 and the implementation notes record the recorded proposal, the legacy fallback and its limits, and the "class differs from proposal needs a reason" rule, plus the §2.1 argument;
    - §16 gets the typed responses.
  - **`docs/05-database/entities/academics.md`:** `student_promotions.decision_basis` now also holds `proposed_decision` and `proposed_to_class_id`, written at batch creation and never edited.
  - `deferred-work.md` gets a bulk "assign target section" action (each section is set per decision today), results- and attendance-based proposals (examinations is done; the proposal is still level-only), the class_teacher own-section scope, the `promotion-input-request` notification, guardian-facing `promotion-outcome`, and per-tenant promotion rule templates.
  - `project-status.md`: academics full-stack complete, and "Start here next" becomes timetable's dashboard.
- [ ] **Review and open the PR:** `change-reviewer` → fix pass → user go-ahead → PR (ELI5 section) → watch CI.

## Verification

- **CI on each PR:**
  - **`api`:** endpoint tests, contract tests, OpenAPI freshness, mypy, ruff, coverage floors.
  - **`frontend`:** Jest with the 85% coverage ratchet, lint, typecheck including the i18n parity gate, build, the Playwright mocked lane.
  - **`repo-hygiene`:** doc-sync, links, cspell, Prettier, the plan-review record, commit messages.
- **Manual (the user), on a seeded tenant with `module.academics` on:**
  - **PR A:** open Academics → Curriculum; add, edit and remove a subject; clone last session; switch to a closed session and see it read-only; reload, and the filters stay.
  - **PR B:** allocate past the norm and see the warning while the save succeeds; end an allocation and see the load drop; filter by ended.
  - **PR C:** create a batch, edit a decision, submit; approve as the same user and see it refused inline; approve as a principal; execute and watch the report.
- **Nightly live lane after PR C merges:** `academics-promotion-journey.spec.ts` passes against the rebuilt route.

## Independent review

- **Reviewer:** plan-reviewer agent, 2026-10-13
- **Verdict:** REVISE. Right approach. Fix before approval: the live promotion CUJ breaks on transition confirm dialogs, and the unrequested submit-time section rule has no bulk path and breaks existing tests.
- **Findings addressed:** all 16 were folded in.
  1. **Live CUJ vs confirm dialogs.** Task 13 now updates the page object (dialog-scoped `confirm()` plus `…AndConfirm()` methods) and the live spec in PR C, and the mocked spec uses the same methods so the PR gate covers the flow.
  2. **Section rule.** Dropped (the user's call). It's replaced by an advisory missing-section notice, and the bulk-assign action is listed in deferred-work.
  3. **Duplicated identity checks.** Now `assert_class_subject_mapping_valid` in `school_organization/services.py`, called by `map_subject_to_class` and the curriculum PATCH path. `assert_curriculum_writable` is used for the lock, and old-message test assertions are named for update.
  4. **`effective_to` semantics.** Decided and tested: end ≤ today and ≥ start, reinstate via `null`, and future-start displacement ends at `max(today, effective_from)` through the shared `_end_date_current_primary(exclude_pk=…)`. A Reinstate action covers `tsa_unique_allocation`.
  5. **Name fields.** Explicit `source=` on every allocation name field, plus create/PATCH name assertions for both resources.
  6. **Sidebar gating.** `MenuItem.permission` plus child filtering in `sidebar-menu.tsx`, `ACADEMICS_SECTIONS` as the single source, and a client landing at `/academics` that goes to the first permitted section, with tests.
  7. **Hand-written types.** `TeacherLoadWarning`/`PromotionExecutionReport` are recorded as a deliberate exception in Alternatives (the user's call).
  8. **Docs.** Bold "(as shipped)" paragraphs inside the existing §20, the entity doc's `decision_basis` and `effective_to`, and the §16 clone line fixed.
  9. **§2.1 compatibility.** The argument is in Alternatives and goes in each PR's §16 notes.
  10. **Enum override.** A required read of the generated diff for over-broad `ENUM_NAME_OVERRIDES` renames, with a fallback.
  11. **Invalidation.** Promotions invalidates only the detail and list keys, never the `jobWatch` key, with a test.
  12. **Mapper placement.** Mappers moved to `curriculum-helper.ts`.
  13. **Placeholders.** Replaced: `todayIsoDate()` in `src/lib/helpers.ts`, the clamp guard named and extracted to `usePageClamp`, and the skill edit limited to the new pattern.
  14. **Cross-tenant and malformed input.** Cross-tenant tests for the new filters and allocation PATCH/DELETE, and a load-summary malformed-id 422 test.
  15. **ADR.** None needed; the reasons are recorded in Alternatives.
  16. **Legacy fallback.** Kept, with its limit documented.
- **Unresolved:** none. The user decided both open questions on 2026-10-13: drop the section rule, and accept the two hand-written wire types.
