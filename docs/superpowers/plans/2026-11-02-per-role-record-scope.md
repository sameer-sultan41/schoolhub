# Per-Role Record Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every subagent brief carries this repo's overrides (agent-lessons L11): no local tests, lint or typecheck; no AI attribution; never `--no-verify`; CI is the source of truth.

**Work tier:** 2

**Goal:** A record scope narrows only the permissions of the role assignment it is attached to. Today a user with a campus-scoped role and *any* unrelated `all`-scoped role reads tenant-wide on every scoped endpoint, enters marks for any subject, and escalates leave anywhere.

**Architecture:**
- **One cached resolver.** `scope_grants(user)` maps each permission key the user holds to the scopes of the live role assignments that grant it. `effective_permission_keys` becomes its key set, so keys and scopes come from one query and one cache entry.
- **Reading one route's scope.** `scopes_for(user, declared)` reads the map for one route's declaration (a key or an `AnyOf`).
- **Every scoped read names its key.** `scope_queryset` takes the declaration as a required argument. The central viewset mixin passes the route's own declaration. Every direct caller names its governing key.
- **Writes that resolve a target.** A write that first looks up its target is narrowed by *both* the target's view key and the action's key.
- **No way back.** The key-blind `user_scopes` and `user_scopes_for_key` are deleted.
- **PR B (stacked)** unions one key's mixed scope types (`campus` + `assigned`). That closes the two attendance mixed-scope gaps that `docs/deferred-work.md` says must be designed with this.

**Tech Stack:** Django 6.1 + DRF, Celery, PostgreSQL 18 (RLS), Django cache (Redis in production, locmem in tests).

**Spec:**
- `docs/02-architecture/auth-and-rbac.md` §2.2–2.3: "a scope is an optional constraint attached to a `user_role`"; "effective permissions = union of all roles".
- `docs/00-overview/users-and-roles.md` §6 rule 3.
- `docs/03-modules/attendance.md` §16: "the scope `GET /student-attendance` applies" to a correction target.
- `docs/deferred-work.md`:
  - the high-priority "scope_queryset unions record scopes across all of a user's roles" entry;
  - the Role soft-delete entry;
  - the attendance entries "Marking takes the union of a mixed user's scopes; Records does not" and "A campus-staff guardian cannot see the leave they submitted for a child on another campus".

**Lands as:** two stacked PRs.
- **PR A** is `fix/per-role-record-scope` (tasks 1–4), off `feat/communication-threads-and-broadcast` (#145). It builds on #145's `user_scopes_for_key` and `live_restricted_role_assignments`. Retarget it to `main` when #145 merges.
- **PR B** is `fix/record-scope-type-union` (task 5), stacked on PR A.

This file lands in PR A's first commit, together with its `## Independent review` block.

---

## Context

**`core/rbac/permissions.py` today:**
- `effective_permission_keys` unions keys over live assignments and is cached as `perm-keys:{pk}`.
- `user_scopes` unions `(scope, scope_ref)` with no regard to which role grants which key, cached as `scopes:{pk}`.
- `user_scopes_for_key` is #145's broadcast-only fix and is uncached.
- `scope_queryset` reads `user_scopes`. It returns at the first of `all` > `campus` > `own` > `assigned`.

**Routes and callers:**
- `HasPermissionKey._required_key(request, view)` resolves a route's declaration: `required_permission_map[action]`, else `required_permission`. The result is a `str` or an `AnyOf`.
- `TenantScopedViewSetMixin.get_queryset` (`core/api/viewsets.py:118`) is the central caller for about 90 viewsets.
- 18 production call sites call `scope_queryset` directly.
- 8 production call sites call `user_scopes` directly, plus `broadcasts/services/scope.py:37`.

**Cache invalidation today:**
- `core/rbac/signals.py::_evict` runs inside the request transaction (`ATOMIC_REQUESTS`).
- Nothing evicts on a `Role` save, so a soft delete through `save()` is never evicted.
- Production writes only `all`-scoped assignments today (`staff/services/invite.py:76`). Seeds, fixtures and future role management write the others, so this fix must land before role management does.

## Alternatives considered (why not)

| Decision | Chosen | Rejected, and why |
| -------- | ------ | ----------------- |
| Where the key comes from | An explicit, required `permission` keyword on `scope_queryset`. The mixin passes the route's resolved declaration. | **A context variable set by `HasPermissionKey`:** absent in Celery and services, and a missing value would fall back to the bug. **An optional argument that defaults to the old union:** leaves the hole open for any forgotten caller. |
| Resolver and cache shape | One map, `scope_grants(user) -> {key: {scope: refs}}`, from one query, cached as `scope-grants:{pk}`. `effective_permission_keys = frozenset(scope_grants(user))`. | **A cache entry per (user, key):** `_evict` can't enumerate keys. **Uncached:** `_can_see_medical_notes` runs per row. **Keeping `perm-keys` separate:** two caches that can disagree for a TTL. |
| `AnyOf` routes | The union of the scopes of the roles granting any declared key. | **The first key that matched:** order-dependent. |
| Writes that resolve a target (corrections, a staff thread's student, timetable publish, substitution candidates, nested parent lookups) | The target's **view** key's scope **and** the action's scope: two chained `scope_queryset` calls. (User decision, 2026-11-02.) | **The action key alone:** acts on rows the user can't read, contradicting attendance.md §16 and the nested mixin's "cannot see a nested resource under a student they could not otherwise see". **The view key alone:** brings the exploit back through an unrelated view role. |
| How an export job learns its key | The enqueuing request's `required_declaration(...)` is stored in the job payload as `scope_permission: list[str]`. The task reads it. A legacy job with no `scope_permission` is marked failed, telling the user to request the export again. | **Deriving it from the job type:** a GET over the inline ceiling queues the same job under the *view* key, so a view-only user would get an empty file, and a wider export role would widen the file beyond the inline report. |
| Old API | Delete `user_scopes` and `user_scopes_for_key`. | **Deprecate them:** the next caller reaches for the shorter name. |
| Role soft-delete | `role__deleted_at__isnull=True` in the grants query (and so in keys) and in `live_restricted_role_assignments`, plus a `post_save` eviction on `Role`. | **A separate PR:** the same functions are rewritten here. |
| Eviction timing | `_evict` deletes now **and** in `transaction.on_commit` (Django's documented invalidation pattern). | **Now only:** a concurrent read between eviction and commit re-caches the old grants for the full TTL. |
| Medical-notes shortcut | It honours the `students.student.update` key's scope for that row. (User decision, 2026-11-02.) | **Defer:** the same bug class, on medical PII, in a function this PR rewrites. |
| Mixed scope types for one key (PR B) | Union each scope type's record set. `all`, and any type that passes the queryset through (`campus_field=None`), short-circuit. Two or more types are combined with an OR of `pk__in` subqueries. One type uses today's exact filter. | **First-wins:** this is the documented attendance gap. **`qs_a \| qs_b` / `union()`:** joins duplicate rows, and `union()` can't be filtered further. |

## Global Constraints

- **Invariant #3 / auth-and-rbac §2.3.** A scope constrains only the keys its role grants. Effective keys stay the union across roles (§2.2).
- **Fail closed.** No live assignment granting the declared key means `.none()`, `False` or 404, never tenant-wide.
- **Pinned names:**
  - `scope_grants`, `scopes_for`, `required_declaration`;
  - `rbac_cache_keys(user_id) -> tuple[str, ...]` and `evict_rbac_caches(user_ids)` in `core/rbac/cache.py`, the one place the prefixes live;
  - the cache key `scope-grants:{pk}`;
  - `scope_queryset`'s keyword `permission`;
  - the job payload field `scope_permission`.
- **Key constants.** Use an existing constant anywhere in the owning module (for example `STUDENT_LEAVE_APPROVE` in `attendance/services.py`). Otherwise pass the exact literal the route's viewset declares. Never invent a second spelling.
- **Repo rules.**
  - No local tests, lint or typecheck.
  - `fix` commits carry `Root cause:`.
  - Docs change in the same PR.
  - No `noqa` or `type: ignore`.
  - mypy is strict.

## Review Focus

1. **The exploit through the mixin.** A user holds campus-A `students.student.view` and an `all` role granting only `exams.exam.view`. `GET /students` lists only campus A. (`test_unrelated_all_role_does_not_widen_campus_scope`, Task 2.)
2. **The exploit through a direct caller.** An `assigned` teacher with an unrelated `all` role can't bulk-enter marks for an unallocated subject. (`test_unrelated_all_role_does_not_skip_allocation_check`, Task 3.)
3. **A split role on a nested route.** A user holds `students.guardian.view`@all and `students.student.view`@campus-A. `GET /students/{campus-B}/guardians` returns 404. (`test_nested_route_needs_the_parents_view_scope`, Task 2.)
4. **A role changes inside the cache window.** A role soft-deleted through `save()`, a permission added to a role, or an assignment removed is visible on the next request, even with the cache warmed first. (`test_role_soft_delete_evicts_warm_cache`, `test_eviction_also_runs_on_commit`, Task 1.)
5. **An export queued by an over-ceiling GET.** It reads exactly what the inline GET would have, by the view key. A legacy job with no key fails closed. (`test_get_overflow_export_uses_the_view_scope`, `test_legacy_export_job_without_key_fails_closed`, Task 2.)

---

# PR A — `fix/per-role-record-scope`

### Task 1: Per-key resolver, one cache, eviction and role soft-delete

**Files:**
- Create:
  - `apps/api/core/rbac/cache.py`
  - `apps/api/core/rbac/tests/test_scope_grants.py` (absorbs `test_scopes_for_key.py`, which is deleted)
- Modify:
  - `apps/api/core/rbac/permissions.py`
  - `apps/api/core/rbac/signals.py`
  - `apps/api/core/rbac/seeding.py:42,111` (evict after `bulk_create`)
  - `apps/api/apps/school_organization/tests/factories.py` (`grant` calls `evict_rbac_caches`, and its docstring is updated)

**Interfaces (produces):**
- `scope_grants(user) -> Mapping[str, Mapping[str, tuple[uuid.UUID | None, ...]]]`.
  - One query: `user.user_roles.filter(deleted_at__isnull=True, role__deleted_at__isnull=True).values_list("role__permissions__key", "scope", "scope_ref")`, excluding a null key.
  - Cached under `scope-grants:{pk}` for `_CACHE_TTL`.
  - Returns `{}` for an anonymous user.
- `effective_permission_keys(user) -> frozenset[str]` returns `frozenset(scope_grants(user))`.
- `scopes_for(user, declared: str | AnyOf) -> dict[str, list[uuid.UUID | None]]` returns the union over `declared_keys(declared)`.
- `required_declaration(request, view) -> str | AnyOf | None` is today's `HasPermissionKey._required_key`, made public, with unchanged behaviour. `HasPermissionKey` calls it.
- `live_restricted_role_assignments()` adds `role__deleted_at__isnull=True`.
- In `core/rbac/cache.py`:
  - `rbac_cache_keys(user_id)` returns `("scope-grants:{id}", "scopes:{id}")` until Task 3, then only the first. The `perm-keys` prefix is retired.
  - `evict_rbac_caches(user_ids)` runs `cache.delete_many` now and again in `transaction.on_commit`.
- `signals.py` uses `evict_rbac_caches`, and gains a `post_save` receiver on `Role` that evicts its holders.

- [ ] **Step 1: Failing tests** in `test_scope_grants.py`:
  - `test_only_roles_that_grant_the_key_count`
  - `test_two_roles_with_the_key_both_count`
  - `test_any_of_unions_the_roles_of_each_key`
  - `test_removed_assignment_does_not_count`
  - `test_role_soft_delete_evicts_warm_cache`: warm the cache, soft-delete the role through `save()`, then assert that keys, scopes and `is_restricted_principal` all drop.
  - `test_role_permission_change_evicts_scope_grants`
  - `test_eviction_also_runs_on_commit`: use `captureOnCommitCallbacks`.
  - `test_scope_grants_is_one_query_then_cached`: `assertNumQueries` 1, then 0.
  - `test_effective_permission_keys_is_the_grants_key_set`
- [ ] **Step 2: Implement.** Keep `user_scopes` and `user_scopes_for_key`, both evicted, until Task 3.
- [ ] **Step 3: Commit:** `fix(rbac): resolve record scopes per permission key`.
  - `Root cause:` `user_scopes` unioned every role's scope regardless of which role grants the key being checked (auth-and-rbac §2.3).

### Task 2: `scope_queryset` takes the route's declaration

**Files:**
- Modify:
  - `core/rbac/permissions.py` (`scope_queryset`)
  - `core/api/viewsets.py:118`
  - every call site in the table
  - the export views and tasks named in the table
  - `tests/test_scope_queryset_config.py:51,67` (pass `permission=`)
- Create: `apps/api/tests/test_per_role_scope.py`

**Interfaces:** `scope_queryset(queryset, user, *, permission: str | AnyOf, own_field=…, campus_field=…, campus_allows_null=…, assigned_filter=…)`.
- `permission` is keyword-only and required.
- The function reads `scopes_for(user, permission)`.
- Precedence is unchanged until PR B.

**Call sites:**

| Call site | `permission` |
| --- | --- |
| `core/api/viewsets.py:118` mixin, `fees_finance/views.py:240` `LedgerEntryViewSet` | `required_declaration(self.request, self)`. `None` returns `.none()`. |
| `student_management/views.py:480` `get_student`, `staff_management/views.py:68` `get_staff` | Chained: first `students.student.view` / `staff.staff.view` (the parent's view key), then `required_declaration(self.request, self)`. |
| `attendance/views.py:507,520` `_correctable_rows` / `_correctable_staff_rows` | Chained: first `attendance.student-attendance.view` / `attendance.staff-attendance.view`, then the route's declaration. |
| `communication/threads/services/create.py:112` `_scoped_student` | Chained: first `students.student.view`, then `communication.thread.create`, the literal the viewset uses at `threads/viewset.py:145`. |
| `timetable/slots/viewset.py:95` `_scoped_section`, `timetable/substitutions/viewset.py:226` `candidates` | Chained: first the target's view key (`school.section.view`, and for `candidates` the staff view key `staff.staff.view`), then `required_declaration(request, view)`. The view is passed in from each action. |
| `attendance/register.py:293` `staff_register` | A new `permission` parameter, passed by `StaffAttendanceViewSet.register` from `required_declaration`. |
| `attendance/tasks.py:286,294,303`, `fees_finance/services.py:1760,1802-1854`, `examinations/services.py:1798,1802,1810` (`build_report_rows` and helpers) | A new `permission: str \| AnyOf` parameter. A GET passes its own `required_declaration`. Every `_queue_export` stores it as `scope_permission`. The task rebuilds the declaration from it. `StudentLedgerView` passes its own declaration. |

- [ ] **Step 1: Failing tests** in `tests/test_per_role_scope.py`. Each builds a mixed user from `grant(...)` calls.
  - `test_unrelated_all_role_does_not_widen_campus_scope` (Review Focus 1)
  - `test_nested_route_needs_the_parents_view_scope` (Review Focus 3)
  - `test_unrelated_all_role_does_not_widen_attendance_records`
  - `test_correction_target_needs_the_attendance_view_scope`
  - `test_unrelated_all_role_does_not_widen_finance_report`
  - `test_unrelated_all_role_does_not_widen_exam_report`
  - `test_get_overflow_export_uses_the_view_scope` (Review Focus 5)
  - `test_legacy_export_job_without_key_fails_closed`
  - `test_export_job_after_role_removed_reads_nothing`. The user keeps an unrelated `all` role, so the test fails on today's code.
  - `test_any_of_scopes_map_is_the_union`. This asserts `scopes_for` only. The list-level union is PR B's test.
  - `test_all_scoped_holder_of_the_key_still_reads_tenant_wide`
- [ ] **Step 2: Implement.**
  - Update the docstrings and comments the change falsifies: `attendance/views.py:473-477, 499`, `fees_finance/services.py:1749-1752`, `threads/services/create.py:111`.
  - Existing scope tests stay green.
- [ ] **Step 3: Commit:** `fix(rbac): scope every queryset by the roles that grant its route's key`.
  - `Root cause:` `scope_queryset` read the key-blind union.

### Task 3: The direct scope readers, then delete the union

**Files:**
- Modify the readers in the table below.
- Modify `core/rbac/permissions.py`: delete `user_scopes` and `user_scopes_for_key`.
- Modify `core/rbac/cache.py`: drop the `scopes` prefix.

| Reader | Key |
| --- | --- |
| `register.may_mark_register` / `my_registers`, `views._section_for_marking` | `attendance.student-attendance.mark` |
| `services._assert_escalation_reaches_wider` | `step.required_permission` (the step's own key, §2.4) |
| `fees_finance._ledger_report_queryset` | The `permission` received from Task 2 |
| `examinations.assert_marker_may_enter` | `exams.marks.create` |
| `serializers._can_see_medical_notes` | The `students.student.update` shortcut applies only to rows inside that key's scope. The `assigned` branch reads `students.student.view`. There is no per-row query: compute the in-scope ids once per serializer instance (for example in `context` from the view). |
| `PeriodViewSet` | Remove the hand-written null-campus OR and set `scope_campus_allows_null = True`. **Keep** a thin `get_queryset` returning `self._with_campus_name(super().get_queryset())`. |
| `broadcasts.scope.sender_campus_ids` | `scopes_for(user, BROADCAST_SEND)` |
| `academics/promotions/services.py:629-634` (approver lookup) | Add `role__deleted_at__isnull=True` so it matches its own docstring. |

- [ ] **Step 1: Failing tests:**
  - `examinations/tests/test_marks.py::test_unrelated_all_role_does_not_skip_allocation_check` (Review Focus 2)
  - `attendance/tests/test_leave.py::test_unrelated_all_role_cannot_escalate_leave`
  - `attendance/tests/test_marking.py::test_unrelated_all_role_does_not_grant_register`
  - `student_management/tests/test_record_scope.py::test_medical_notes_follow_the_update_roles_scope`
  - `student_management/tests/test_record_scope.py::test_medical_notes_query_count_is_constant` (3 rows versus 30)
  - `timetable/periods/tests/test_endpoints.py::test_campus_scoped_reader_sees_campus_and_shared_periods`
  - `timetable/periods/tests/test_endpoints.py::test_ordering_by_campus_name`
- [ ] **Step 2: Implement.** Afterwards, `git grep -n "user_scopes" apps/api` must show no code.
- [ ] **Step 3: Commit:** `fix(rbac): read each scope check through the key it guards, and remove the key-blind union`, with a `Root cause:` line.

### Task 4: Docs, ADR and PR A

- **`docs/02-architecture/auth-and-rbac.md` §2.3:** add these rules:
  - Scope is evaluated per role assignment.
  - A check reads only the assignments whose role grants the route's key.
  - An `AnyOf` route unions those assignments.
  - A write that resolves a target needs both the target's view scope and the action's scope.
- **`docs/decisions/0031-record-scope-per-role-assignment.md`** and the README index: the Alternatives table, the cache and eviction design, and the export-job key rule.
- **`docs/deferred-work.md`:**
  - Remove the high-priority entry and the Role soft-delete entry.
  - Keep the two attendance mixed-type entries, pointing at PR B.
- **`docs/project-status.md`** item 11: update the RBAC line.
- **`docs/03-modules/communication.md:278`:** `user_scopes_for_key` becomes `scopes_for`.
- **`docs/07-quality/agent-lessons.md`:** add "A permission helper that ignores which key it guards is a privilege-escalation path; take the key as a required argument."

- [ ] **Step 1:** Write the docs and commit `docs(rbac): per-assignment record scope, ADR-0031`.
- [ ] **Step 2:** Run `change-reviewer` with this plan and fix its findings.
- [ ] **Step 3:** Push, then `gh pr create --base feat/communication-threads-and-broadcast --assignee @me --label "needs review"` with an ELI5, then `gh pr checks <n> --watch`.
- [ ] **Step 4:** Dispatch `e2e-live` once as a regression run. The seeded users each hold one role, so the run must stay green unchanged.

# PR B — `fix/record-scope-type-union` (stacked on PR A)

### Task 5: Union one key's mixed scope types

**Files:**
- Modify:
  - `core/rbac/permissions.py` (`scope_queryset`)
  - `tests/test_per_role_scope.py`
  - the attendance tests named below
  - `docs/deferred-work.md`
  - ADR-0031 (append the decision)

**Semantics:**
- Return the queryset unchanged if `all` is present, or if any present type would pass the queryset through (`campus` with `campus_field=None`).
- Otherwise build one narrowed queryset per present type, using today's branch logic, with these exceptions:
  - a `campus` with no non-null refs yields `.none()`;
  - an `own` or `assigned` with no hook or field yields `.none()`;
  - nothing falls through to another type.
- Drop `.none()` members before combining. If none remain, return `.none()`. If one remains, return it exactly as today. If two or more remain, return `queryset.filter(Q(pk__in=a.values("pk")) | …)`.

- [ ] **Step 1: Failing tests:**
  - `test_any_of_route_unions_scopes_of_matching_roles`. The data includes the user's own campus-B correction request, so the test fails under PR A.
  - `test_campus_a_plus_assigned_reads_the_section_they_class_teach_on_campus_b`
  - `test_campus_staff_guardian_reads_leave_for_child_on_another_campus`
  - `test_empty_member_does_not_raise_in_report_cte` (L22)
  - `test_single_scope_type_sql_is_unchanged`: compare the SQL with `CaptureQueriesContext` against the PR A output.
- [ ] **Step 2: Implement.**
  - Attach `EXPLAIN` output for the mixed path on `student_attendance` to ADR-0031.
  - Remove both attendance entries from `docs/deferred-work.md`.
- [ ] **Step 3: Ship.**
  - Commit `fix(rbac): union a key's mixed scope types on reads`, with a `Root cause:` line.
  - Run `change-reviewer`, then push.
  - Open the PR: `gh pr create --base fix/per-role-record-scope`, with an ELI5, assignee and label.

---

## Verification

- CI only:
  - `api.yml`: ruff, mypy strict, and the Postgres tests, including `test_endpoint_contracts` and every module's scope tests.
  - `repo-hygiene`.
- No API contract change, so nothing is regenerated.
- `e2e-live` runs once on PR A, as a regression check.

## Self-Review

- **Spec coverage:**
  - §2.3: Tasks 1–3.
  - The deferred high-priority entry: Tasks 2–3.
  - Role soft-delete: Task 1.
  - attendance.md §16 target rule: Task 2.
  - The attendance mixed-type entries: Task 5.
  - The ADR-0029 recipient-side carve-out is unchanged, by decision.
- **Type consistency:** `scope_grants`, `scopes_for`, `required_declaration`, `evict_rbac_caches`, `rbac_cache_keys`, `permission=` and `scope_permission` are defined in Tasks 1–2 and used by name afterwards.
- **Proportion:** there are no code bodies. Every call site maps to one declared key or one chained pair.

## Independent review

- **Reviewer:** plan-reviewer agent, 2026-11-02.
- **Verdict:** REVISE. The approach is right and the cause proven. But the draft's Review Focus 3 could not pass under PR A's unchanged precedence, and it left the export-job key open, with "derive from job type" mis-scoping GET-overflow jobs. Its nested-parent and correction-target keys contradicted documented invariants. Its cache rewrite missed Role soft-delete eviction, on-commit eviction and the `PeriodViewSet` annotation.
- **Findings addressed:**
  - **Export jobs** store the enqueuing request's declaration as `scope_permission`. A legacy job with none fails closed. There is a GET-overflow test.
  - **The `AnyOf` list-union test** moved to PR B, with data that fails under PR A. PR A tests the scopes map only.
  - **Writes that resolve a target** are narrowed by the target's view key and then by the action key: nested parents, corrections, `_scoped_student`, `_scoped_section` and `candidates`. This was the user's decision.
  - **Role cache:** a `post_save` eviction on `Role`, and on-commit double eviction. A warm-cache test covers both.
  - **`PeriodViewSet`** keeps a thin `get_queryset` for `campus_name`, and there is an ordering test.
  - **Medical notes:** the shortcut honours the update key's scope, with no per-row query. This was the user's decision.
  - **The export test** keeps an unrelated `all` role, so it fails on today's code.
  - **Escalation** reads `step.required_permission`.
  - **Key rules:** the constant rule is widened, and `thread.create` is the viewset's literal.
  - **Caches:** `effective_permission_keys` is derived from `scope_grants`, giving one cache. Prefixes live once in `core/rbac/cache.py`, used by `grant()`. `scopes` stays evicted until Task 3.
  - **Stale docs and comments** are listed in Tasks 2–4, including the promotions approver lookup.
  - **PR B** spells out the empty-set and short-circuit rules per type, with an L22 `.none()` test, a SQL-equality test and EXPLAIN in the ADR.
  - **Seeding `bulk_create`** now evicts.
- **Unresolved:** none. The user settled both open questions on 2026-11-02:
  - writes need both the view scope and the action scope;
  - the medical-notes shortcut is fixed in PR A.

## Execution rulings

Recorded during subagent-driven execution (stop rule 3: the plan is amended, not silently deviated from).

1. **Task 5 runs on its own branch** `fix/record-scope-type-union`, cut from PR A's head once PR A is pushed.
2. **Test names in this plan use `any_of`.** The cspell hook rejected the run-together spelling.
3. **Task 2 moved the fees `_ledger_report_queryset` onto `scopes_for`.** That was Task 3's row, but leaving it would have kept a gap beside the new code. A test pins it.
4. **Substitution `candidates` is scoped in two parts.** The slot is scoped by the substitution key alone. The candidate staff list is scoped by `staff.staff.view`, because the read's target is the staff list and no slot data is disclosed. If the response ever carries slot fields, intersect `timetable.slot.view` too.
5. **Task 3b: the key-blind presence checks get the same fix.** Four sites check a key held anywhere as though it were held for this row:
   - `StudentViewSet` `enroll` and `change_section`, whose capacity override reads `students.student.update`;
   - `withdraw`, which reads `students.withdrawal.approve`;
   - substitution `cancel`, which reads `timetable.substitution.approve`.

   Each now asks `holds_key_for(user, permission, instance, ...)`, which is `scope_queryset` over that one row. They ship in PR A, because they break the same invariant.
