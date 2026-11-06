# Carry ADR-0031 (per-role record scope) through the examinations dashboard stack

**Work tier:** 2. It touches Invariant 3 (record scope is server-side enforcement) across four PRs.

## Context

The examinations dashboard is five stacked PRs: #147 (setup) ← #149 (schedule) ← #152 (marks) ← #154 (results) ← #155 (question banks). They branched from `main` at `b82e51c9`. Since then `main` merged #150 (`fix/per-role-record-scope`, ADR-0031, lesson L36). Two parts of that change break the stack:

- **Removed helpers.** `core.rbac.permissions.user_scopes(user)` is gone. It unioned every role's scope, whatever key the role granted. `has_permission_key(user, key)` is gone too: it answered "held anywhere", and callers read that as a row privilege. Their replacements:
  - `scopes_for(user, declared)`: only the roles that grant this key count.
  - `effective_permission_keys(user)`: the held-keys set.
  - `holds_key_for(user, key, row, **ViewSet.scope_kwargs())`: holds the key *for this row*.
- **A required key.** `scope_queryset(..., permission=...)` now requires the key. The viewset mixin scopes a row-acting route (PATCH, DELETE, a colon action) by the read key **and then** by its own key (ADR-0031 decision 3).
- **Changed exam code on main.** #150 also edited `apps/examinations` itself:
  - `assert_marker_may_enter` reads `scopes_for(user, MARKS_CREATE)`.
  - `_entry_students` scopes the posted student ids.
  - `bulk_enter_marks` scopes the posted students per student (its exam-subject is still resolved tenant-wide, by the serializer).
  - `tasks.py`'s import and export jobs carry the route's scope key in the payload and fail closed without it.

#147 already has `main` merged (`efb02650`) and passes its typecheck, because its own code has no old-API calls. #149, #152, #154 and #155 add code that does. Until `main` is carried through, those four PRs cannot merge, and CI on #149 does not run because the PR conflicts.

## Inventory: old-API call sites the stack adds

Taken from `feat/exams-question-banks`, the superset. The "PR" column is where each site first appears.

| Site | PR | Old call | What it decides |
|---|---|---|---|
| `views.scoped_exam(request, pk)` | #149 | `scope_queryset(Exam, user, own_field=None, campus_field=None)` | The exam a colon action addresses by id (`:publish-schedule`, `:issue-admit-cards`, `:process-results`, …) |
| `views.scoped_exam_subject(request, pk)` | #152 | `scope_queryset(ExamSubject, …)` | The exam-subject for `:lock-marks`, the grid, the import |
| `views.scoped_question_bank(request, pk)` | #155 | `scope_queryset(QuestionBank, …)` | A bank addressed by id from the nested question routes |
| `services.may_enter_marks` / `assert_marker_may_enter` / `enterable_section_ids` | #152 | `user_scopes(user)` | Which sections a marker reads or writes in the grid |
| `services.marks_grid_writability` | #152 | `has_permission_key(user, write_permission)` | The grid's `writable` flag |
| `services.marks_entry_progress(user=…)` | #152 | `RecordScope.ALL in user_scopes(user)` | Narrowing the progress rows to the caller's sections |
| `services.assert_creator_teaches_bank_subject` | #155 | `user_scopes(user)` | Whether a bank's subject must be one the creator teaches |
| `views` `check_object_permissions` (field-gated writes) | #154 | `has_permission_key(request.user, key)` | Whether a PATCH may set a field that needs an extra key |
| `MarksImportViewSet.create` → `assert_marker_may_enter_some_section` → `enterable_section_ids`; `import_marks_task` → `import_candidates_by_admission_number(exam_subject=…)` (main changed it to `(…, user, permission)`); `import_marks_row`'s out-of-section message | #152 | `user_scopes`, the old candidate signature | Who may import, which rows a job may write, and what a refused row says |
| `MarksViewSet` keys, `build_report_rows(permission=…)` call sites, the export job's scope key | #152, #154 | main conflict regions | Which key governs the grid, lock and reports |

## Decisions

- **D1 (user, 2026-11-07): `assigned` marks *entry* means allocated sections only.** Writes only: the section write gate, `enterable_section_ids`, `_entry_students` and the import. The grid *read* under `exams.marks.view` keeps the homeroom, matching `Marks.filter_assigned_to_user` and §3's homeroom review role, so a homeroom-only class teacher sees the grid with `writable=false, no_permission`. It is main's rule (`_current_allocations`); the stack's homeroom clause in `may_enter_marks` is dropped. One definition feeds the section gate, the per-student filter, the grid's writable flag and the import, so a grid can never look writable while the submit refuses.
- **D2: no route loses access.** A `scoped_*` lookup reaches the row under the *hosting* view's read declaration (`view.scope_read_declaration()`, the mixin's own rule) and then the route's key, using the *owning model's* scope settings (`ExamViewSet.scope_kwargs()`, …). So `:schedule-conflicts` (hosted on the schedule viewset, read key `exams.schedule.view`) keeps every role that reads schedules today; it is not narrowed to `exams.exam.view` holders.
- **D3: ADR-0031 decision 7 (union).** A key held at several scope types reads their union: `all` passes; otherwise a section is enterable if a `campus` grant covers its campus **or** an `assigned` allocation covers it. No "first type wins" early return (`may_enter_marks`, `assert_creator_teaches_bank_subject`).

## Approach

Main's code is the precedent (`attendance/register.py:88,221`, `attendance/views.py:506-550`, `fees_finance/services.py:1761`, `student_management/views.py:190,342`, examinations `services.py:711-820`, `core/api/viewsets.py:135-185`). **Every scope read names the key it is about.**

1. **Lookups (`scoped_exam`, `scoped_exam_subject`, `scoped_question_bank`)** take the view, and narrow by D2's two keys with the owning viewset's `scope_kwargs()`, in one shared private helper. Keys are spelled only in forms main's `InlinePermissionKeyTests` can read (a literal or module constant, `route_permission(request, view)`, or a parameter passed through, as `attendance/views.py:506-550` does); the implementer reads that test before writing.
2. **Marks write gate, one merged design (supersedes both sides).**
   - `assert_marker_may_enter(*, user, exam_subject, section, permission)` — section-level (the grid needs it), reads `scopes_for(user, permission)` with D3's union and D1's allocations. Main's subject-level callers move to it (per section of the posted rows) or to `assert_marker_may_enter_some_section(*, user, exam_subject, permission)`.
   - `enterable_section_ids(*, user, exam_subject, permission)` is the union in D3 over the class's sections.
   - `_entry_students(*, exam_subject, user, permission, section=None)` returns **enrollments** (the stack's callers `marks_grid`, `bulk_enter_marks`, the import read enrollments), narrowed per student by main's `scope_queryset(Student…, permission=permission, assigned_filter=in_allocated_sections, **STUDENT_SCOPE)` and restricted to `enterable_section_ids`.
   - `may_enter_marks` (grid read) takes the route key (`exams.marks.view`, passed by the view) and reads D3's union over allocations **and homeroom** (read side of D1). The `Marks.filter_assigned_to_user` docstring is corrected to say the read keeps homeroom while entry does not.
   - **Authoritative campus:** the write gate and the flag read the *section's* campus; the per-student filter keeps main's student-campus check. A student whose campus differs from their section's is refused on submit with the unknown-number message. This edge is recorded in `deferred-work.md` rather than resolved here.
3. **`marks_grid_writability`** calls the write gate itself — `assert_marker_may_enter(..., section=section, permission=write_permission)` plus the exam/lock/window gates — and maps its refusal to `no_permission`. It does not use a presence check (L36).
4. **Marks import** (missed in v1):
   - `MarksImportViewSet.create` gates with `route_permission(request, self)` (`exams.marks.import`), and stores the key in the job payload exactly as main's `create_job` does (`SCOPE_PERMISSION`).
   - `import_marks_task` reads `job_scope_permission(job.payload)` and **fails closed** when it is absent (main `tasks.py:318-360`). It passes that key to `enterable_section_ids` and to main's `import_candidates_by_admission_number(..., user, permission)`.
   - A row outside the caller's sections reports the **same message as an unknown admission number** (main's `test_a_campus_a_importer_s_campus_b_row_is_rejected_as_unknown`). The stack's "You may not enter marks for X's section" leaked the student's existence and goes.
5. **`MarksViewSet`:**
   - Keep the stack's read key `exams.marks.view`, as a new `MARKS_VIEW` constant beside `MARKS_CREATE`.
   - **Drop** main's `scope_read_exempt_actions = {"lock", "unlock"}` on the stack. Main needed it only because its read key was `exams.marks.create`, which `school_admin` lacks. On the stack the read key is `exams.marks.view`, and `MARKS_LOCKERS` is a subset of `EXAM_VIEWERS`. So lock and unlock get decision 3's two-key rule and no role loses access; `DefaultRoleReadKeyTests` pins it.
   - The shared lookup helper skips the read step when `scope_read_declaration()` returns None, for any other exempt action.
6. **`marks_entry_progress`, `assert_creator_teaches_bank_subject`:** take the route key as a required parameter (L36) and read `scopes_for` with D3's union.
7. **Field-gated writes (`check_object_permissions`, #154):** each field's key is a module constant, checked with `self.holds_key_for_row(...)` (main `student_management/views.py:190,342`).
8. **Main's other exam edits, kept as written, with the stack's call sites updated:**
   - `build_report_rows(permission=route_permission(...))`, at stack `views.py:1581` and `tasks.py:1081`.
   - The export job's `scope_permission` and its fail-closed check.
   - The per-student scoping of bulk entry. (Main resolves the bulk-entry exam-subject tenant-wide; #152 additionally resolves it through `_reachable`, so an out-of-scope exam-subject is a 404.)
9. **Mechanics.**
   - Carry `main` down the stack branch by branch, merge commits only, no force push: #147 (done) → #149 → #152 → #154 → #155.
   - Each **merge commit is resolution only**: the minimum that makes main's API compile, behaviour left as it was.
   - Each port is its own `fix(examinations): …` commit with a `Root cause:` line, on the branch that introduced the site, pushed together with the merge.
   - `openapi.yaml` and `schema.d.ts` are regenerated after each merge (`apps/api/scripts/generate-openapi.sh`, the api-client generator), never hand-merged.
   - The lesson renumber (exam lessons → L40+) is already on #147 and #149. Downstream branches get it through the merge, plus a renumber pass for their own references.

**Alternatives rejected:**
- *Rebase onto main:* force-pushes five reviewed PRs (ADR-0006).
- *Compatibility shims for `user_scopes` / `has_permission_key`:* reintroduces the escalation ADR-0031 removed.
- *Scope `scoped_*` by the route key alone:* a wide action role reaches a row the view role hides (decision 3).
- *Scope by `ExamViewSet`'s read key for every route:* silently narrows `exams.schedule.view` readers (D2).
- *Keep the stack's homeroom clause:* rejected by the user (D1).

## Tests

Use the L36 mixed-user shape. Each test goes in the PR that introduced the site.

- **#149:**
  - `test_a_colon_action_cannot_reach_an_exam_its_view_role_hides`: the view key is on an `assigned` role whose teacher has no allocation in the exam's subjects (`Exam` has no campus column), and `exams.schedule.update` is at `all`. `:publish-schedule` returns 404.
  - `test_schedule_conflicts_stays_readable_to_schedule_readers`: a role holding `exams.schedule.view` without `exams.exam.view` keeps access (D2).
- **#152:**
  - `:lock-marks` gets the same `assigned`-shaped 404: `exams.marks.view` on an unallocated `assigned` role, `exams.marks.lock` at `all`. This needs the exemption dropped.
  - `test_the_grid_is_unwritable_where_the_submit_would_refuse`: `MARKS_CREATE` on campus A and `MARKS_VIEW` at `all`; a campus-B section shows `writable=false, no_permission`.
  - `test_campus_a_plus_assigned_enters_the_campus_b_section_they_are_allocated` (D3), for both the grid and the submit.
  - `test_a_homeroom_only_class_teacher_cannot_write_the_grid` (D1): the grid reads 200 with `writable=false, no_permission`, and the submit refuses, so flag and submit agree.
  - Port main's `EntryRecordScopeTests` and `ImportRecordScopeTests` so they pass on the merged code, including the unknown-number message and the fail-closed job without a scope key.
  - Progress narrows by the progress key's scope.
- **#154:** a field-gated PATCH is refused when the extra key is held only on another campus.
- **#155:**
  - `scoped_question_bank` returns the `assigned`-shaped 404, because `QuestionBank` has no campus column.
  - `assert_creator_teaches_bank_subject` uses D3's union, with no first-type-wins.
- Main's suites stay green on every branch: `test_per_role_scope.py`, `test_scope_grants.py`, and the endpoint contracts (`InlinePermissionKeyTests`, `DefaultRoleReadKeyTests`).

## Docs

- **`docs/decisions/0031-*.md`, decision 7's last bullet (in #152):** the marks gate is now section-level, reads the union, and treats `assigned` as allocations only.
- **`docs/03-modules/examinations.md`:**
  - the two-key lookup rule;
  - the grid flag mirroring the write gate;
  - D1;
  - the import's key and its fail-closed job.
- **Lessons:** none new; L36 covers it.
- **PR bodies:** each gets a "Carried `main` (ADR-0031)" line.

## Verification

CI only, per ADR-0007. A branch is done when its PR shows MERGEABLE and every check passes: `api.yml` (tests, mypy, OpenAPI staleness), `frontend.yml`, `repo-hygiene` and E2E. No local runs.

## Independent review

- **Reviewer:** plan-reviewer agent, 2026-11-07 (second pass)
- **Verdict:** REVISE — the design covers every round-one finding. Still to fix: limit D1 to writes so the homeroom grid read and its test agree; rebuild the 404 tests on campus-less tables (Exam, ExamSubject, QuestionBank) on `assigned`; and reconcile the `:lock-marks` test with the lock/unlock read exemption.
- **Findings addressed:**
  - Round 1, all twelve:
    - write-gate contradiction: Approach §2
    - decision 7 union: D3
    - homeroom vs allocations: D1, the user's decision
    - import path: Approach §4
    - contract-readable keys: Approach §1 and §7
    - main's exam edits, `MarksViewSet` keys, report/export threading: Approach §5 and §8
    - resolution-only merges with separate `fix` commits: Approach §9
    - schedule-reader narrowing: D2 plus a test
    - route key passed to helpers: Approach §6
    - OpenAPI regeneration: Approach §9
    - ADR-0031 amendment: Docs
    - lesson renumber: Approach §9
  - Round 2:
    - D1 is limited to writes; the grid read keeps homeroom (D1, Approach §2).
    - The 404 tests on `Exam`, `ExamSubject` and `QuestionBank` are rebuilt on `assigned` (Tests).
    - The lock/unlock exemption is dropped on the stack, with the reason recorded and the helper skipping a None read declaration (Approach §5).
    - The stale Context bullet is replaced.
    - The authoritative campus is the section's for the gate and flag, with the edge recorded in `deferred-work.md` (Approach §2).
- **Unresolved:** none.
