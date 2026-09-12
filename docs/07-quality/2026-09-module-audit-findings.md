# Module Quality & Security Audit — September 2026

> **Agent Context**
> **Summary:** Consolidated findings from 14 independent review passes (quality + security, one pair per module) against the 7 built-but-not-yet-restructured backend modules — `staff_management`, `student_management`, `timetable`, `academics`, `attendance`, `examinations`, `fees_finance` — plus one shared platform defect in `core/files`. This is a point-in-time audit record, not a living spec: severities and line numbers are as of commit `8ee16fa` / `main` `bbfb767` (2026-09-11). Status columns are updated as fix PRs land; see the tracking table in each section.
> **Co-load with:** [`testing-strategy.md`](testing-strategy.md) · [`../06-security/security.md`](../06-security/security.md)

## Methodology

Each module went through two independent, fresh-context reviews with no access to each other's output:

- **`lu-quality-reviewer`** — correctness, test-teeth (`would this test actually fail if the code broke?`), N+1s and unbatched writes, and duplication worth a shared helper.
- **`lu-security-reviewer`** — tenancy/RLS, record-scope (campus/own) enforcement, authorization key coverage, cross-tenant access shape (404 vs 403), and secrets.

Both reviewed the module's **whole current code**, not a diff — these are modules that have not yet been touched by the file-per-action refactor applied to `communication`/`school_organization`. Every finding below traces to a concrete `file:line` and a stated failure or exploit scenario; performance-magnitude claims are **structural, not measured** — none of the reviewing agents had Datadog/production access, so a "this is unmeasured" caveat applies to every N+1/latency finding unless a query-count test already pins it.

**Status values:** `Open` (default, nothing fixed yet) · `Fixed` (landed in a merged PR, linked) · `Won't fix` (explicit decision, reason noted).

---

## Executive summary — Critical findings

| # | Area | Summary | Status |
|---|------|---------|--------|
| C1 | `core/files` (platform) | `FileViewSet.get_queryset()` returns every file in the tenant with no record-scope check, gated only on `platform.file.view` — granted to all 17 staff roles. Any staff account can list and download every student document, staff HR document, exam paper (pre-sitting), admit card, and report card. Independently found by 3 separate reviewers (`student_management`-security, `examinations`-security, and as an amplifier of `staff_management`-security's own finding). **Single fix unblocks three modules' criticals.** | Open |
| C2 | `staff_management` (security) | `staff.document.view`/`.create` and `staff.qualification.view`/`.create` are granted to `ALL_STAFF` (17 roles) instead of `hr_staff`-only per the module doc, **and** the `own`-scope hook the doc promises (`filter_owned_by_user`) does not exist on either model — so `RecordScope.OWN` silently resolves to nothing. Every staff account can read (and, on the create side, plant) colleagues' national-ID scans, contracts, and police clearances. | Open |
| C3 | `academics` (security) | Bulk promotion batch creation sweeps every enrolled student in a `Class` tenant-wide with zero campus-scope check (`Class` has no campus column, so one grade spans every campus). A campus-scoped VP's batch silently includes another campus's students; the response doesn't disclose it. Every downstream promotion state transition (`submit`/`approve`/`reject`/`revert`/`execute`) also skips campus scope entirely — reads are scoped, writes aren't. | Open |
| C4 | `academics` (quality) | `next_class_for` uses `level__gt` + `.first()` instead of resolving the exact next grade level, so a deactivated (but not deleted) class is silently skipped — one grade's whole cohort gets promoted two levels up, or mass-"graduated" if the top grade was deactivated. No error, no signal, just a wrong write. | Open |
| C5 | `attendance` (quality) | The lock window (`is_locked`) is only checked against rows that **already exist**. A `(student, date, period)` key with no row yet skips the date gate entirely — any past working day can be freshly marked with `is_locked=False`, bypassing the correction workflow. Compounded by a separate finding that the tenant timezone is never activated, so the lock cutoff itself uses UTC instead of the tenant's local date. | Open |
| C6 | `examinations` (security) | `notify_results_pending_approval` queries `User.objects.filter(is_active=True)` with **no tenant filter** (`User` carries no RLS policy). Every `:process-results` run writes cross-tenant notification rows naming this tenant's exam/student data into every other tenant's approver inbox. Not currently emailed (trigger's `channels=set()`), but the cross-tenant DB write + PII read happens on every run, and enabling email on that trigger is a one-line, unremarkable-looking change. | Open |
| C7 | `fees_finance` (quality) | `ledger-entries:post-journal`'s idempotency protection rests solely on a layer (`Idempotency-Key` replay, keyed on `tenant+key+endpoint`, no body hash) that the module's own code documents as insufficient for this endpoint — and there is no successful HTTP test for either money-moving colon-action (`payments:record`, `refunds:*`) at all, only a 404 cross-tenant check. A duplicate/retried request is not reliably caught. | Open |
| C8 | `student_management` (quality) | All three background jobs (import/export/ID-card generation) call `task.delay()` **inside** the request's open transaction (`ATOMIC_REQUESTS=True`). A fast worker can pick up the message and hit `BackgroundJob.DoesNotExist` before the request commits — no retry, job stuck at `queued` forever, no failure recorded. | Open |

No cross-tenant data leak was found in `timetable` or `attendance` security reviews, and `fees_finance`'s ledger append-only enforcement, RLS coverage, and cross-family portal reads were all verified sound.

---

## Platform: `core/files`

| Sev | Summary | Location | Fix | Status |
|-----|---------|----------|-----|--------|
| Critical | `FileViewSet.get_queryset()` returns `File.objects.alive()` unscoped; `download`/`retrieve` fall back to `platform.file.view` (`ALL_STAFF`); no `has_object_permission` exists anywhere in the codebase. | `core/files/views.py:46-58`, `core/files/permissions.py:44-48` | Narrow by the file's `purpose`, mapped to the owning module's real permission key (`student.document`→`students.document.view`, `exams.exam-paper`/`exams.report-card`/etc.→matching `exams.*` key, `staff.document`/`staff.qualification`→`staff.document.view`/`staff.qualification.view`). Drop `list` entirely — no consumer needs a tenant-wide file index. | Open |

---

## `staff_management`

### Security

| Sev | Summary | Location | Fix | Status |
|-----|---------|----------|-----|--------|
| Critical | `staff.document.*`/`staff.qualification.*` granted to `ALL_STAFF`; no `filter_owned_by_user` on either model so `OWN` scope resolves to `.none()`. Registry claim ("salary-adjacent fields are masked without hr permissions") is also unimplemented — no masking exists in `StaffSerializer`. | `permissions.py:109-144`, `views.py:316-468`, `models.py:326` | Narrow grants to `hr_staff` (+ `principal` for verify) per module doc §4; add real `filter_owned_by_user` hooks. | Open |
| Major | Same root cause, write side: any staff account can plant a fabricated document/qualification on any colleague's record. | `permissions.py:114-139`, `views.py:335,429` | Gate create on ownership or restrict the key. | Open |
| Major | `:exit` hard-deletes `UserRole` rows on a false premise — the comment claims no soft-delete field exists; it does, and the rest of RBAC honors it. Irreversible without a DBA. | `services.py:650-657` | Soft-delete (`deleted_at`), add missing `tenant_id` filter on the `User` update. | Open |
| Major | `:invite` can grant any tenant-visible role including the platform-seeded `school_owner` (every permission, `RecordScope.ALL`), with no check the inviter holds what they're granting. Currently unusable end-to-end (no activation flow exists yet) but becomes live privilege escalation the moment one ships. | `services.py:498-529` | Validate `role_ids` against inviter's own effective keys; exclude `is_restricted_principal` roles; accept `scope`/`scope_ref` on invite. | Open |
| Major | Import endpoint reads the whole upload into memory before checking the 5 MB size cap. | `views.py:517-521` | Check `upload.size` before `.read()`. | Open |
| Minor | Soft-deleted staff's documents/qualifications remain retrievable/downloadable via the top-level routes (nested routes correctly exclude them). | `views.py:452-468`, `:360-382` | Add `staff__deleted_at__isnull=True` to `get_queryset()`. | Open |
| Minor | Bulk export ignores record scope enforced on the equivalent list endpoint; import's campus lookup is tenant-scoped but not campus-scoped. | `services.py:842-881`, `:796` | Apply `scope_queryset` to export; campus-scope the importer. | Open |
| Minor | `assert_national_id_available` accepts an unused `tenant_id` param — false confidence for a future caller. | `services.py:191-200` | Filter by it, or drop the param. | Open |
| Suggestion | Cross-tenant suite doesn't cover file-id smuggling, foreign `role_ids` on invite, or PATCH/DELETE on the two child routes. | `tests/test_cross_tenant.py` | Add the three cases (all currently safe in code). | Open |

### Quality

| Sev | Summary | Location | Fix | Status |
|-----|---------|----------|-----|--------|
| Major | `own`-scoped staff cannot see their own qualifications/documents — no `scope_own_field` declared on any of the 4 child viewsets; falls through to `.none()`. Same root cause as the security Critical above. | `views.py:316-468` | `scope_own_field = "staff__user_id"` on all four, matching `apps/academics/views.py:299`'s precedent. | Open |
| Major | Qualification verification doesn't require attached evidence despite doc §11 saying so; a qualification with no `document_file_id` can be marked `verified`. | `services.py:384-420` | Reject `decision="verified"` when `document_file_id is None`. | Open |
| Major | The `assigned`-scope guard (`filter_assigned_to_user`'s manager-employment-status predicate) has no test that would fail if deleted; no API test drives `ASSIGNED` scope at all. | `models.py:231-235` | Add a model test with a non-`active` manager and an API test at `ASSIGNED` scope. | Open |
| Major | Import error collection is unbounded — one wrong header row can produce a multi-MB `background_jobs.result` payload. | `tasks.py:33-56` | Cap collected errors (~500), report true failed count + `truncated: true`; add a missing-header pre-check. | Open |
| Major | The `__row_number__` drift-prevention logic (keeps error messages pointing at the right physical row after a blank line) has no test that would catch a regression to by-position indexing. | `services.py:706-768` | Add a CSV test with a blank line between two data rows; add an `.xlsx`-path test (currently zero coverage). | Open |
| Minor | N+1 in import: 2 loop-invariant queries per row (campus lookup, tenant-settings lookup). | `services.py:794-826` | Hoist both out of the per-row loop. | Open |
| Minor | `exit_staff` lacks the `select_for_update` its sibling `_verify_record` documents as necessary — a genuine (low-impact) double-exit race. | `services.py:622-658` | Add the lock as the first statement. | Open |
| Minor | Import size check reads the whole file before checking size (dup of security finding — same fix). | `views.py:517-521` | See above. | Open |
| Minor | An empty `.xlsx` import fails with a blank error message (`str(StopIteration())` is `""`). | `services.py:724` | Guard with `next(rows_iter, None)` and raise a named error. | Open |
| Minor | Cross-tenant test coverage gaps on designations, qualifications, documents (only `:verify` tested on the latter two). | `tests/test_cross_tenant.py` | Add the missing route coverage. | Open |
| Suggestion | `_fk()` is duplicated verbatim across 7 apps; the two `:verify` view actions are near-identical; the test base class is copy-pasted 4×; job-dispatch orchestration is copy-pasted 7× across modules. | Various | Promote to `core/api/serializers.py` / a shared test base / a `dispatch_job` helper. | Open |

---

## `student_management`

### Security

| Sev | Summary | Location | Fix | Status |
|-----|---------|----------|-----|--------|
| Critical | Same as platform C1 — every student document/export/ID-card PDF is reachable via `core/files`. | `core/files/*` | See platform fix. | Open |
| Major | `GuardianSerializer` never validates `user_id` belongs to the tenant — the one call site missing the check `StudentSerializer`/`StaffSerializer` both have. A bad or malicious UUID can route a child's notifications to a stranger, possibly cross-tenant (email has no RLS backstop). | `serializers.py:158-188` | Add `validate_user_id` calling `services.resolve_tenant_user_id`, mirroring `StudentSerializer`. | Open |
| Major | `test_cross_tenant.py`'s docstring claims "every endpoint"; only `/students` (1 of 14 route groups) is actually covered. | `tests/test_cross_tenant.py` | Populate the harness with guardian/link/document/transfer fixtures per tenant, loop the 404 assertions. | Open |
| Minor | Student-photo PATCH bypasses `assert_file_usable` (create path enforces it; update doesn't) — lets a restricted document get laundered into a wider-audience photo slot. | `serializers.py:45-155` | Add `validate_photo_file_id` mirroring `GuardianSerializer`. | Open |
| Minor | Import file fully buffered before the size check. | `views.py:834-838` | Check `upload.size` first. | Open |
| Minor | `_fk()` resolves soft-deleted rows across the module (guardian, transfer, campus/house/photo, session/class/section). | `serializers.py:37-42` | Lazy `.alive()`-bound related field. | Open |
| Suggestion | Raw exception text persisted to a client-readable job field. | `tasks.py:70,93,121` | Log full detail, store a generic message. | Open |

### Quality

| Sev | Summary | Location | Fix | Status |
|-----|---------|----------|-----|--------|
| Critical | All 3 background jobs dispatch `.delay()` inside the request transaction; worker can race the commit and get stuck at `queued` with no retry/failure recorded. | `views.py:849,882,914`; `tasks.py:26-28` | Wrap dispatch in `transaction.on_commit(...)`; move the job fetch inside the task's `try`. | Open |
| Major | Withdrawal's enrollment-termination and outgoing-transfer's enrollment update are completely untested — deleting the code fails no test. A withdrawn student keeps an `active` enrollment occupying a capacity seat and a class roster slot indefinitely. | `services.py:709-718`,`891-900` | Assert `enrollment.status`/`end_date` after withdraw; add outgoing-transfer equivalent. | Open |
| Major | The inter-campus section-reallocation test never actually exercises that branch (no enrollment in the fixture) — a completed transfer can move `student.campus` while leaving the enrollment's section pointing at the old campus. | `services.py:876-887`; `tests/test_enrollment_transfers.py:294-321` | Fix the fixture to include an enrollment; assert the section moved. | Open |
| Major | `:id-cards:generate` accepts an unbounded student-id list, rendered fully in-process (base64 QR per student, one PDF page each) — OOM risk on a large batch. | `serializers.py:393`, `services.py:1179-1222` | Add `max_length` to the `ListField`; chunk the render. | Open |
| Major | All three Celery tasks swallow exceptions with zero logging (no `logging` import in the file at all) — the only sibling module without it. | `tasks.py:61-70,92-94,119-121` | Add a module logger, `logger.exception(...)` before `mark_failed`. | Open |
| Major | Withdraw/transfer skip `assert_session_writable`, unlike `change_section` which enforces it — can rewrite a closed session's enrollment data. | `services.py:676-719`,`832-906` | Call the guard in both paths. | Open |
| Major | Module doc §11's "effective date within the active session" rule is never enforced for transfers/withdrawals (the helper already exists and is used elsewhere). | `services.py:676-797` | Call `assert_date_in_session`; consider a backstop CHECK constraint. | Open |
| Major | N+1 on `/students` serialization: one `EXISTS` query per row to compute medical-notes visibility, hitting exactly the class-teacher role the rule targets. | `serializers.py:141-155` | Resolve the assigned-student id set once per request, not per row. | Open |
| Minor | One `background_jobs` write-transaction per imported row (no percent-change gate). | `tasks.py:50` | Only write when the rounded percent changes. | Open |
| Minor | `Idempotency-Key` not scoped to the resource id — a reused key on a `{pk}` route silently skips the second operation. | `views.py:233,280,322,737,764,797` | Include the resource id in the endpoint key. | Open |
| Minor | Import parse failures produce a blank error message (`StopIteration`) or an unhandled `UnicodeDecodeError`/`IndexError` on malformed input. | `services.py:1003-1031` | Guard each case with a named `DomainRuleViolation`. | Open |
| Minor | Enrollment-joined filters (`section_id`, `class_id`, `academic_session_id`) don't narrow by enrollment status/soft-delete — a withdrawn or soft-deleted enrollment still matches. | `filters.py:20-24` | Add status/`deleted_at` conditions to the same `Q`. | Open |
| Suggestion | `request_transfer` never checks `from_campus` against the student's actual campus. | `services.py:766-797` | Add the consistency check. | Open |
| Suggestion | Import size limit hardcoded instead of using the `core/files/purposes.py` registry (same drift the registry exists to prevent). | `views.py:805` | Register the purpose. | Open |

---

## `timetable`

### Security

No cross-tenant leak found — RLS and tenant isolation verified solid. All findings are within-tenant campus/role boundaries enforced on reads and forgotten on writes.

| Sev | Summary | Location | Fix | Status |
|-----|---------|----------|-----|--------|
| Major | Slot-create never re-validates the named section belongs to the caller's campus — a campus-scoped VP can inject a draft into another campus's grid, which gets published there and returns that campus's conflict data in the response. | `serializers.py:147`, `views.py:357` | Resolve `section` through `scope_queryset` in a `validate_section_id`. | Open |
| Major | Same gap on substitution create — a fabricated proposal against a foreign campus's slot sends that campus's teacher a real cover notification and blocks them via the one-per-period constraint. | `serializers.py:203`, `views.py:740` | Scope the slot before `create_substitution`. | Open |
| Major | Substitution list gated on a permission key every staff role holds (`timetable.timetable.view` granted to `ALL_STAFF`) — exposes tenant-wide teacher absence/leave data to librarians, store keepers, etc. | `views.py:697` | Register a dedicated `timetable.substitution.view` key scoped to builders/approvers/own-teacher. | Open |
| Minor | Conflict findings carry counterpart slot ids from outside the caller's campus scope, usable to map another campus's staff/room occupancy. | `conflicts.py:191-194` | Redact counterpart ids outside the caller's scope. | Open |
| Minor | Nullable-campus read-widening on `/periods` also widens PATCH/DELETE (platform-level `core/api/viewsets.py` pattern, low current risk since `timetable.period.*` is `school_admin`-only). | `views.py:249-275` | Apply the NULL-campus branch on read only. | Open |

### Quality

| Sev | Summary | Location | Fix | Status |
|-----|---------|----------|-----|--------|
| Major | Period-overlap validation ignores `Period.weekdays` entirely — cannot build a per-weekday "short Friday" template via the API even though the conflict engine enforces the column as a hard conflict. | `services.py:53-57` | Add a weekday-intersection predicate, null meaning "every working day". | Open |
| Major | Period-overlap check is one-directional — a tenant-wide period is never compared against a campus's own periods (`campus_id=None` renders identically on both sides of the OR). | `services.py:53` | Compare a tenant-wide period against every campus's periods. | Open |
| Major | Substitution free-checks are version-blind (`effective_to__isnull=True`, i.e. "now", instead of the date-scoped `slot_version_window` helper built for exactly this) — causes both false clears and false refusals around a mid-session republish. | `services.py:290-301,342-354` | Use `slot_version_window(on_date)` in both helpers. | Open |
| Major | Substitution approval never re-checks the substitute is still free at decision time — only at proposal time. | `services.py:463-478` | Re-run the free-checks under lock during `:approve`. | Open |
| Major | N+1 in the automatic cover-finder: 2 queries per candidate teacher scanned, unbounded by campus staff count — the one path meant to run unattended. | `services.py:698-715` | Replace the per-candidate scan with two set-building queries. | Open |
| Major | `propose_substitutions_for_absence` has zero test coverage anywhere — deleting the whole function body fails nothing. | `services.py:613-672` | Test through the real Celery entrypoint; raise the "no free substitute" log to warning. | Open |
| Minor | Conflict-scope collection pulls the whole student roll and every section the tenant has ever had, on every slot edit (query count is fixed and tested; row volume isn't). | `conflicts.py:115-142` | Aggregate section sizes in SQL; scope `sections`/`room_capacity` to ids present in the edit. | Open |
| Minor | Consecutive-load run-counter silently breaks a run when two periods share a sequence number (reachable via tenant-wide + campus period coexistence). | `conflicts.py:385-386` | De-duplicate by sequence before walking. | Open |
| Minor | Publish is retroactive to 00:00 of the publish day — an afternoon publish rewrites the morning's already-taught grid. | `services.py:158,180,188` | Stamp `effective_from` at `+1 day` instead of same-day. | Open |
| Minor | A bogus `?academic_session_id=` on `/timetables/my` silently falls back to the current session instead of 422ing. | `views.py:551-553` | Return 422 on an unresolved explicit session id. | Open |

---

## `academics`

> **Locations updated 2026-09-12** after the file-per-action restructure (§20 of `academics.md`) moved this module from a flat `views.py`/`services.py`/`serializers.py`/`filters.py` layout into `curriculum/`, `teacher_allocations/`, `promotions/` packages. Every location below is the new path; nothing here has been fixed yet, only re-addressed so the fix wave doesn't lose track of an open finding.

### Security

The structural fact underlying every finding: **there is no `has_object_permission` anywhere in this codebase** — `scope_queryset` narrowing the list queryset is the *only* record-scope mechanism, and any write that resolves a target outside that queryset has no scope check at all, only tenant scoping. `academics` has four such paths.

| Sev | Summary | Location | Fix | Status |
|-----|---------|----------|-----|--------|
| Critical | Bulk promotion batch creation sweeps every campus's active enrollments in a class (tenant-wide `Class`, no campus column) with zero scope check — the worst instance of the structural gap above. | `promotions/services.py:48-72` (`create_promotion_batch`), `promotions/viewset.py:235` (`create_batch`) | Filter the sweep by the caller's campus scope; refuse rather than silently narrow. | Open |
| Major | Every promotion state transition (`submit`/`approve`/`reject`/`revert`/`execute`) resolves the batch through the tenant-only manager, not the scoped queryset the list/retrieve endpoints use — reads scoped, writes not. | `promotions/viewset.py:254-297` (the five actions), `promotions/services.py:138-149` (`batch_queryset`/`assert_batch_in_status`) | Resolve through `scope_queryset` before calling the service in all five actions. | Open |
| Major | Write payloads (`to_section_id`, allocation `section_id`, curriculum `campus_id`) accept any FK in the tenant regardless of campus — can move a student or allocation cross-campus. | `curriculum/serializers.py:26` (`campus_id`), `teacher_allocations/serializers.py:22` (`section_id`), `promotions/serializers.py:34` (`to_section_id`) | Scope these three fields per-request; add a campus-consistency backstop in `enroll_student`. | Open |
| Minor | FK fields resolve soft-deleted rows (shared `_fk` helper pattern, repo-wide). | `serializers.py:15` (`_fk`, stayed at root, shared by all three packages) | `queryset=model.objects.alive()`, or a lazy `.alive()`-bound field. | Open |
| Minor | `CurriculumViewSet` is the one viewset with no `DenyRestrictedPrincipals` (correct for reads since students/guardians hold the view key; write actions inherit the gap too). | `curriculum/viewset.py:45` | Apply the deny-list per-action via `get_permissions()`. | Open |
| Minor | `Idempotency-Key` not scoped to the actor — a collision silently no-ops the second user's `:execute`. | `core/idempotency/services.py:36-38` (unchanged, platform-level) | Add the actor to the uniqueness dimension (platform-level). | Open |

### Quality

| Sev | Summary | Location | Fix | Status |
|-----|---------|----------|-----|--------|
| Critical | `next_class_for` steps over a deactivated grade level (`level__gt` + `.first()`) instead of resolving the exact next rung, silently promoting a whole cohort two levels or mass-"graduating" them. | `promotions/services.py:33` | Resolve the exact next level; raise if it's inactive; distinguish "no rung" from "inactive rung". | Open |
| Major | The mandatory-override-reason check for a graduated↔promoted flip never fires — it recomputes "what was proposed" from the row's current mutable state rather than a snapshot, so it always equals the new decision. Zero test coverage. | `promotions/services.py:219-241` (`_assert_decisions_complete`/`_proposed_decision`) | Snapshot the proposed decision at batch-creation time; add a test asserting the check fires. | Open |
| Major | PATCH on teacher allocations bypasses every validation the POST path enforces (no `perform_update` override) — no PATCH test exists at all. | `teacher_allocations/viewset.py:35` (`TeacherAllocationViewSet`) | Add `perform_update` re-running the three creation asserts; add PATCH tests. | Open |
| Major | Closed-session curriculum can still be PATCHed/DELETEd — `assert_curriculum_writable` has exactly one caller (`clone_curriculum`), never update/destroy. | `curriculum/services.py:20` (`assert_curriculum_writable`), `curriculum/viewset.py:45` | Call the guard in both `perform_update`/`perform_destroy`. | Open |
| Major | Elective-group guard is off-by-one (`== 0` instead of `< 2`), and a named test pins the wrong behavior as correct. | `curriculum/services.py:25` (`assert_elective_group_has_options`); `curriculum/tests/test_endpoints.py:234` | Fix the comparison; rewrite the test's fixture to need 3 rows, not 2. | Open |
| Major | A reassigned-then-returning teacher can never be re-allocated to the same slot (unique constraint doesn't exclude end-dated rows), and `effective_to` is silently unwritable on PATCH despite a comment claiming otherwise. | `models.py:85-92` (unchanged, `tsa_unique_allocation`), `teacher_allocations/serializers.py:37-44` | Add `effective_to__isnull=True` to the constraint condition; make the field genuinely writable with validation. | Open |
| Minor | Reverting an executed all-graduated batch doesn't actually undo anything — the enrollment-existence check the revert guard uses can't see the graduation case. | `promotions/services.py:324` (`revert_batch`) | Refuse revert on a graduated executed batch, or make revert reopen source enrollments. | Open |
| Minor | A source enrollment that isn't `ACTIVE` at execution time is silently skipped but the promotion row is still marked executed. | `promotions/services.py:504` (`_close_source_enrollment`) | Capture the update count; report a failure/skip entry when zero. | Open |
| Minor | `load_summary` mixes campus-scoped row counts with tenant-wide totals for the same teacher — internally inconsistent for a multi-campus teacher. | `teacher_allocations/viewset.py:144` (`load_summary`) | Make both scoped, or document the choice explicitly. | Open |
| Minor | A test's name claims coverage of `next_class_for` that it never exercises (the batch it posts against has no students, so the function under test never runs). | `promotions/tests/test_promotion.py:144` | Rename and add a real graduation-branch test. | Open |
| Suggestion | `teacher_weekly_load` computes one teacher's load by scanning the whole session's allocations on every allocation create. | `teacher_allocations/services.py:113` | Filter by staff directly instead of discarding most of a full scan. | Open |
| Suggestion | `_execute_one` re-fetches the target `Section` once per student in the promotion-execution loop. | `promotions/services.py:489` | Add `to_section` to the existing `select_related`. | Open |
| Suggestion | Three duplicated patterns worth a shared helper: the swallow-and-log notification wrapper (9 copies across 5 apps), the guarded-update-then-409 pattern (2 copies), and hand-synced `ordering_fields`/`ordering_annotations` triples (3 viewsets). | Various | Promote each to a shared helper. | Open |

---

## `attendance`

### Security

No cross-tenant leak found — RLS and tenant isolation verified solid throughout. Every finding is the same pattern as `timetable`: record scope enforced on reads, omitted on writes.

| Sev | Summary | Location | Fix | Status |
|-----|---------|----------|-----|--------|
| Major | Correction creation applies no record scope to its target row — a campus-scoped teacher/HR user can raise (and, on approval, have applied) a correction against another campus's locked attendance row if they know its id. | `views.py:299-311`, `serializers.py:144` | Resolve the target through `scope_queryset` before calling the service. | Open |
| Major | Staff-attendance marking applies no record scope to the staff member being marked — same shape, feeds payroll and triggers cross-campus cover-substitution fan-out. | `views.py:612-629`, `serializers.py:337` | Scope `staff` through `scope_queryset` in `create`. | Open |
| Major | An `assigned`-scoped class teacher cannot mark their own section at all — `Section` has no `filter_assigned_to_user` hook, so `scope_queryset` falls to `.none()` one line before the control written for this case (`assert_marker_may_mark_section`) would ever run. Hidden today only because every seeded role defaults to `RecordScope.ALL`. | `views.py:244-258` → `core/rbac/permissions.py:229-234` | Add `filter_assigned_to_user` to `Section`; add an end-to-end test at `ASSIGNED` scope. | Open |
| Major | The historical importer skips record scope entirely **and** never calls `assert_session_writable` (imported but used nowhere in this path) — a caller-supplied admission number from another campus or a closed/archived session is written and locked with no check. | `services.py:1495-1521,1567-1588` | Call the session-writable guard; scope the resolved student. | Open |
| Minor | `_fk()` resolves soft-deleted rows across the module (correction target, `staff`, student/leave-type/attachment, academic session). | `serializers.py:39-45` | Lazy `.alive()`-bound field. | Open |
| Minor | `AttendanceCorrection` has no record-scope hook, so the roles that can *create* corrections (including `assigned`-scoped class teachers) can't list/retrieve them — fails closed, but a usability gap. | `views.py:280`, `models.py:226-304` | Add `filter_assigned_to_user`/`filter_owned_by_user`. | Open |
| Minor | Import's declared MIME allowlist never executes on the multipart path; the parser is chosen from a client-controlled filename extension. | `views.py:818-829`, `services.py:1401-1411` | Route through the purpose registry's `assert_upload_allowed`, or enforce it directly. | Open |
| Minor | Import task dispatch is not deferred to commit (same shape as the `student_management` Critical, but `it_admin`-gated so lower severity here). | `views.py:841-845` | `transaction.on_commit(...)`. | Open |

### Quality

| Sev | Summary | Location | Fix | Status |
|-----|---------|----------|-----|--------|
| Critical | Lock window is checked only against existing rows — a `(student, date, period)` with no row yet skips the date gate; combined with the tenant timezone never being activated (`timezone.localdate()` uses the process default, UTC), the lock cutoff itself can be off by a day at the tenant's own boundary. | `services.py:401-411,103` | Gate on the date before the per-row lock check; resolve dates through the bound tenant's timezone. | Open |
| Major | A student returning early from approved leave has no path back to a normal marked day — three individually-correct guards (can't mark over `on_leave`, can't cancel a started leave, can't correct an unlocked row) compose into a dead end until the row locks. | `services.py:424-439,1019-1022,536-543` | Allow cancelling an in-progress leave truncated to future dates, or let `bulk_mark` overwrite a future-or-today `on_leave` row. | Open |
| Major | Locked staff-attendance rows have no correction workflow at all — the model/migration support it, nothing implements it, and the error message points at a workflow that doesn't exist. | `services.py:1227-1228,1316-1317,526-580` | Extend `request_correction`/`_apply_correction` to dispatch on subject type; expose `staff_attendance_id`. | Open |
| Major | The correction workflow can write check-out before check-in — enforced on every other write path and by a DB CHECK on `staff_attendance`, but not on corrections, and `StudentAttendance` has no equivalent CHECK either. | `serializers.py:177-215`, `services.py:643-663` | Add the cross-field comparison to `request_correction`; add the missing CHECK constraint. | Open |
| Major | N+1 in the leave path: 2 queries per calendar day (not batched), doubled since it runs at both submission and approval — the batched helper built for exactly this (`working_day_map`) is used elsewhere in the codebase but not here. | `services.py:763-771,1074-1078` | Replace both comprehensions with one `working_day_map(...)` call. | Open |
| Major | N+1 in both attendance serializers: one `TenantSettings` query per row rendered to compute `is_locked`. | `serializers.py:99,369` | Compute `lock_window_days()` once per serializer instance. | Open |
| Minor | Two pending corrections on the same row: the second's `old_values` snapshot can go stale if the first is approved first. | `services.py:526-580` | Refuse a second pending correction, or re-snapshot inside `_apply_correction`. | Open |
| Minor | Correcting a row *out of* `on_leave` leaves a dangling `leave_request_id` reference. | `services.py:546-555,653-663` | Clear the FK when the new status isn't `on_leave`. | Open |
| Minor | Historical importer does per-row lookups (student, enrollment, settings) that could trivially be batched. | `services.py:1495-1534` | Pre-load lookup dicts before the loop. | Open |
| Minor | `defaulters` report ignores the caller's limit on its source query, defeating the bounded-query optimization used elsewhere in the same view. | `reports.py:157-168` | Push the threshold into a `HAVING` clause, or document the bound explicitly. | Open |
| Suggestion | The effective-lock expression (`row.is_locked or is_locked(row.attendance_date)`) is reimplemented 7 times with one intentional divergence that's invisible by inspection. | Various | Extract `effective_lock(row)`. | Open |

---

## `examinations`

### Security

| Sev | Summary | Location | Fix | Status |
|-----|---------|----------|-----|--------|
| Critical | Same as platform C1 — every exam paper (pre-sitting), admit card, report card, and result export is reachable via `core/files`. | `core/files/*` | See platform fix. | Open |
| Critical | Result-approval notification recipient query has no tenant filter — fans out to every active user on the platform on every `:process-results` run. | `tasks.py:551` | Filter by `tenant_id` + the permission key, matching `apps/academics/services.py:869`'s existing correct pattern. | Open |
| Major | Portal isolation for students/guardians rests entirely on `RecordScope.OWN` being set correctly, with no enforced invariant — the column defaults to `ALL`, and no runtime provisioning path exists yet to test it against, but the seeding template used when one ships (`UserRole(...)` with no `scope=`) produces `ALL`. | `core/rbac/models.py:212` | Add a `CheckConstraint`/`clean()` tying `is_restricted_principal=True` roles to a non-`ALL` scope. | Open |
| Major | The marks-import MIME allowlist is declared but never consulted — the actual upload path checks a client-controlled filename extension instead. | `uploads.py:27-35`, `serializers.py:492`, `views.py:695-731` | Call `assert_upload_allowed` in `validate_file`. | Open |
| Minor | `:withhold` resolves its target through the bare tenant manager instead of the scoped queryset every sibling action uses. | `views.py:905` | `get_object_or_404(self.get_queryset(), pk=pk)`. | Open |
| Minor | `is_restricted_principal` doesn't filter soft-deleted role/role-assignment rows, unlike its two sibling functions in the same file — fails closed (availability bug, not a leak). | `core/rbac/permissions.py:123` | Add the matching `deleted_at__isnull=True` filters. | Open |
| Suggestion | `exams.marks.update` is registered but gates nothing (`bulk_entry`'s update half only checks `.create`). | `permissions.py:191` | Gate the update half on it, or drop the registration. | Open |

### Quality

| Sev | Summary | Location | Fix | Status |
|-----|---------|----------|-----|--------|
| Major | Ranks are competition-ranked (1,2,2,4) though the module doc and 4 docstrings all promise dense ranking (1,2,2,3); the one test named for this property can't distinguish the two because its fixture's tie doesn't extend past the tie. | `processing.py:293-301` | Make ranking dense, or correct the documentation everywhere it claims otherwise; extend the test fixture. | Open |
| Major | Segregation-of-duties (`approver ≠ processor`) silently stops firing after any re-processing run — `created_by` only stamps on row creation, never on update, so a second processor can approve results they themselves reprocessed. | `services.py:1233`, `processing.py:327-339,58-70` | Re-stamp `created_by` (or add a dedicated `processed_by` column) on every processing run. | Open |
| Major | A cancelled practical component leaves a stale `practical_max_marks` that silently deflates every student's percentage in that subject — the denominator addition isn't gated on `has_practical` though the pass-check 16 lines below is. | `processing.py:221`, `tasks.py:810` | Gate the addition on `has_practical`; null the field when the flag clears. | Open |
| Major | Scale completeness is validated once at exam-attach time and never again — deleting a grade band afterward makes an ungraded percentage silently resolve to `PASS`. | `services.py:136-148`, `processing.py:246-253` | Re-validate before processing; surface unresolved bands as a reportable outcome. | Open |
| Major | Regenerating report cards clears every existing card's `file`/status *before* rendering replacements, in one transaction — a fully-failed render still reports job success with `rendered: 0`, and 800 parents lose their download link with no recovery signal. | `services.py:1530-1546`, `tasks.py:738-746,779-790` | Don't clear the old file until the new one renders; call `mark_failed` when nothing rendered. | Open |
| Major | Report-card generation is a per-row upsert (~4 round trips/student) where the sibling `processing.write` in the same module already demonstrates the 2-query batched shape for the identical population — and it's the one heavy path with no query-count guard. | `services.py:1500-1546` | Replace with the batched shape; add a query-count test. | Open |
| Major | Result-approval-pending notification (same call site as the security Critical above) also materializes every active user in the tenant — students and guardians included, not just staff as the comment claims — for a per-user permission lookup. | `tasks.py:549-553` | Narrow in SQL to the permission-holding users directly. | Open |
| Minor | Two pass-rate/percentage helpers use different rounding modes (`ROUND_HALF_EVEN` vs `ROUND_HALF_UP`) despite a docstring claiming they agree — verified to actually diverge on real data. | `reports.py:76` vs `grading.py:44` | Standardize on `ROUND_HALF_UP` everywhere, or share one helper. | Open |
| Minor | `question_bank_usage.total_uses` counts questions-used-at-least-once, not total uses — internally inconsistent with `average_uses`. | `reports.py:259` | `Sum("usage_count")` instead of a filtered `Count`. | Open |
| Minor | `subject_performance`'s pass rate ignores the practical pass mark, disagreeing with `processing.compute` for the same subject. | `reports.py:168` | Include the practical threshold in the report's filter. | Open |
| Minor | `assert_exam_is_issuable` only refuses `draft` status though its docstring requires a published schedule — an exam that skipped schedule-publish but picked up marks is issuable. | `services.py:382-394` | Tighten the check to match the docstring. | Open |
| Suggestion | `bulk_enter_marks` writes per-row where the sibling batched form (`processing.write`) already exists as a template. | `services.py:836-870` | Apply the same batched pattern (bounded impact today — class-size loop on a sync request). | Open |

---

## `fees_finance`

### Security

No critical found — append-only ledger, RLS, cross-tenant isolation, and cross-family portal reads were all specifically probed and verified sound, and there is no payment-gateway webhook or secret in this module.

| Sev | Summary | Location | Fix | Status |
|-----|---------|----------|-----|--------|
| Major | Record scope is enforced on list/retrieve but skipped on the money-moving colon-actions (`payments:record`, `refunds:request`, `vouchers:issue`, `invoices:generate`) — a campus-scoped cashier can post a real payment against another campus's invoice given a known UUID. | `views.py:818,968,1087,523` | Resolve the target through the scoped queryset (`self.filter_queryset(self.get_queryset())`) instead of the bare manager. | Open |
| Major | 100% discounts/scholarships are self-approved with no second-actor gate — every other money-reducing action (refunds, expenses, budgets) requires a distinct approver; a `school_admin` (a role the docs say holds no approval power) can zero out a student's future billing unilaterally. | `views.py:615-628,693-709`, `permissions.py:143-146` | Create grants `pending`; add a dedicated approve key held by the waiver role; refuse `approved_by == created_by`. | Open |
| Major | A generic PATCH on a part-paid invoice can re-point it at a different student — the identity fields (`student`, `academic_session`, etc.) aren't frozen once `status != draft`, only the money fields are. | `serializers.py:349-362` | Freeze identity fields once the invoice leaves `draft`. | Open |
| Minor | `Idempotency-Key` replay is keyed on tenant only, not the caller or the body — a same-key-different-body collision silently serves the wrong response instead of erroring. | `core/idempotency/services.py:37-49` | Include `request.user.pk` and a body hash in the lookup (platform-level). | Open |
| Minor | `PATCH /fines/{id}` can change the billed amount of a fine already invoiced, by a role with no approval authority. | `serializers.py:493-500`, `views.py:732-737` | Refuse an `amount` PATCH once `status != pending`. | Open |

### Quality

| Sev | Summary | Location | Fix | Status |
|-----|---------|----------|-----|--------|
| Critical | The only money endpoint whose idempotency rests solely on the tenant+key+endpoint replay layer, which the module's own docs call insufficient for it — and neither money-moving endpoint has a successful HTTP-level test, only a 404 cross-tenant check. Everything that lives purely in the view (the replay itself, audit recording, receipt/notification task dispatch) is invisible to CI. | `views.py:805-857,963-1042` | Add real success-path HTTP tests for both endpoints; reassess whether the replay layer needs strengthening for this endpoint specifically. | Open |
| Major | 6 tests hardcode a `2027-01-01` cutoff; 4 of them will silently become vacuous (pass for the wrong reason) once the clock crosses it, rather than failing loudly. | `test_reports.py` (multiple), `test_collection.py:274-282`, `test_spend.py:495-525` | Derive test windows from `timezone.localdate()`, or freeze the clock. | Open |
| Major | `income-vs-expense` and `trial-balance` report kinds have no positive-result test anywhere — the one dispatch test that looks like it covers them only asserts `isinstance(rows, list)`, which `[]` satisfies. | `test_reports.py:479-492` | Add a positive-control test asserting non-empty rows under full scope. | Open |
| Major | The partial-refund remainder test only catches its target regression in about 1 run in 4 (detection depends on random UUID sort order) and asserts a balance property the ledger already guarantees rather than the actual per-line split. | `test_collection.py:518-606` | Assert the three per-line amounts explicitly; pin account ordering. | Open |
| Minor | `apply_grants`' rounding logic is never exercised by a test that actually needs rounding (every case divides exactly). | `test_invoicing.py:240-431` | Add a case with a non-exact division. | Open |
| Minor | 3 of 6 `assertNumQueries` tests discard the query result, so they'd pass against a function returning garbage in the right number of queries. | `test_reports.py:159,400`, `test_ledger.py:453` | Assert on the returned rows too. | Open |

---

## Notes for the fix wave

- **No self-mocking found in `fees_finance`'s or `academics`' test suites** — worth calling out as a positive baseline, since self-mocking is this platform's most common testing failure mode per prior incidents.
- Several "no test would catch this" findings (`academics` C4's `next_class_for`, `attendance` C5's backdated-marking gap, `examinations`' segregation-of-duties gap, `staff_management`'s `own`-scope hook) share a shape: the *unit* is tested directly and the *call site* that would exercise the bug through the real endpoint is not. The fix wave should specifically add API-level tests for these, not just unit tests for the corrected logic.
- The `core/files` platform fix (C1) should land before any per-module fix work that touches file-serving permissions, since 3 modules' criticals resolve from the one change.
