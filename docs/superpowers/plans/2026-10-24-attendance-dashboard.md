# Attendance Dashboard: Implementation Plan

> **For agentic workers:**
> - REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
> - One implementer pass per task, then one final `change-reviewer` pass and one fix pass per PR.
> - **This repo never runs tests, lint or typecheck locally.** CI is the verifier, so a "test" step means push and read `gh pr checks <n> --watch`.
> - Generators are not checks and must be run: `apps/api/scripts/generate-openapi.sh` and `pnpm --filter @schoolhub/api-client generate`.
> - Lesson L11 overrides for every subagent brief:
>   - never run tests, lint or typecheck locally;
>   - never commit or push (the session does, on the user's go-ahead);
>   - stage only your own files, by explicit path;
>   - never create or edit a `.env*` file;
>   - no AI attribution in commits or PRs;
>   - never `--no-verify`;
>   - write the report early and update it as you go (a read-only agent returns it in its reply).

**Work tier:** 2

**Goal:** Give `attendance` its dashboard:
- a daily **and** period-wise register a teacher fills in under two minutes;
- browsable records, with a correction requested from a locked row;
- the correction and student-leave approval queues;
- the staff register with check-out;
- §13's six reports with export;
- the onboarding import and the tenant's attendance settings.

The backend gaps those screens hit close in the same PRs.

**Architecture:** three sequential full-stack PRs, mirroring timetable's A/B/C split:

| PR | Branch | Ships |
| --- | --- | --- |
| A | `feat/attendance-register` | The attendance-settings endpoint and tab; period mode (markers, leave, lateness, alerts, derived daily reporting); the register and "my registers" endpoints; names on attendance rows; the assigned-scope fix. The Attendance shell, `/attendance/register`, `/attendance/records` (including raise a correction), `/attendance/settings` |
| B | `feat/attendance-approvals` | The corrections queue's keys, scopes and names; names on leave requests. `/attendance/corrections` and `/attendance/leave` (approve, reject; leave detail with its approval chain and attachment) |
| C | `feat/attendance-staff-reports` | The staff register endpoint, staff-row corrections, typed report rows, export parameters carried through the job. `/attendance/staff`, `/attendance/reports`, and the historical import on Records |

**Tech stack:** Django 6.1 + DRF 3.18 + drf-spectacular; Next.js 16 / React 19, TanStack Table 8 and Query 5, react-hook-form + zod, next-intl; Jest + RTL; Playwright (mocked `dashboard` project and the nightly `live` lane).

**Spec:**
- `docs/03-modules/attendance.md`: §3–§13, §16, §18, §19, §20.
- `docs/05-database/entities/attendance.md`.
- `docs/03-modules/timetable.md` §4 and §7.2 (who teaches a slot, confirmed cover).
- `docs/03-modules/examinations.md` (report cards read the attendance summary).
- `docs/project-status.md` (Tier 2 row, item 12).

**Plan file in the repo:** PR A's first commit carries this plan, with its review block (`docs: attendance dashboard plan`).

**Branching:**
- PR A branches from an up-to-date `main`.
- PR B and PR C each branch from `main` once the previous PR has merged.
- If it hasn't merged yet, stack with `gh pr create --base <previous branch>` and retarget to `main` after the merge.

## Context

`project-status.md` names the attendance dashboard as the next pickup now that the timetable dashboard is merged (#120, #123). The backend has been complete since September. No dashboard code exists: no service modules, no `attendance` i18n namespace (only `nav.attendance`), no menu entry, no mocks or page objects. Generated types already exist (`StudentAttendance`, `StaffAttendance`, `LeaveRequest`, `LeaveType`, `AttendanceCorrection`, the enums).

Backend gaps the UI hits (file references are `apps/api/apps/attendance/` unless stated):
- **No roster.** `services.section_roster` (`services.py:170`) is not routed. `GET /students?section_id=` matches enrollments of any status and carries no roll number, while `:bulk-mark` accepts ACTIVE only.
- **No "my sections".** `/sections` has no class-teacher filter and `/auth/me` has no `staff_id`.
- **An `assigned`-scoped class teacher cannot mark.** `_scoped_section` (`views.py:244-258`) resolves the section through `scope_queryset`, which returns `.none()` for `assigned` scope when the model has no `filter_assigned_to_user` hook (`core/rbac/permissions.py:268-273`), and `Section` has none. Every existing test uses an `all`-scoped class teacher (`tests/test_marking.py:416-425` calls the service only; `seed_e2e_data.py:309-313`). Scopes belong to the user's role assignments, not to keys (`user_scopes`, `core/rbac/permissions.py:37-61`).
- **Names are ids only** on every attendance serializer.
- **Typing:** the `:bulk-mark` 200 is typed as a paginated list, but its meta is `marked/updated/alerts_queued`. The report rows and the import response are untyped.
- **Corrections:** the list and retrieve are keyed `correction.create` only (`views.py:283-289`), which the approver roles don't hold. The list resolves to `.none()` for an `assigned` teacher. A staff row cannot be corrected, though a locked staff row tells the user to "use a correction".
- **Leave:** no names; the attachment is an id.
- **Reports:** `threshold` is validated and never passed on (`views.py:734-744`); the export job payload and its rebuild drop it too (`views.py:752-760`, `tasks.py:208-214`).
- **Period mode has no switch** (§20, "Deliberately not built"). `period_id` is accepted on any submission. Only the class teacher may mark. Reports ignore `period_id`. `late_minutes` is measured from the day's start. Approved leave writes daily rows only (`services.py:1043-1044`), and the on-leave guard matches the **same** period (`services.py:402`, `:425-440`), so a period register could mark an on-leave student absent and alert the guardian.

**User decisions (2026-10-24):**
- PR split: Register → Approvals → Staff and reports.
- Leave is **review-only** in the dashboard. Submission stays with the student or guardian (§4, §11) and arrives with parent-portal.
- **Daily and period mode both ship**, behind a tenant setting.
- **Period markers:** the teacher who holds the slot that day; a confirmed substitute **replaces** the absent teacher for that date. Plus the class teacher, and `all`/`campus`-scoped users. This amends §11.
- **Reporting in period mode is a derived daily value,** so percentages, defaulters and report cards stay in days and history stays comparable across a switch.
- Staff-row corrections ship in PR C.

## Period-mode design

- **Switch:** `tenant_settings.academic.attendance_mode`, `daily` (the default, §19) or `period`. One reader, `services.attendance_mode()`, falls back to `daily` for a missing or unknown value, like `lock_window_days()`. Switching to `period` is refused (422) while `module.timetable` is off for the tenant: without a timetable every period register is refused.
- **One mode at a time, gated in the service.** `bulk_mark_student_attendance` refuses a `period_id` in daily mode and requires one in period mode (422 on `period_id`). The import and approved-leave auto-marking stay mode-agnostic and keep writing daily rows. Rows written under the other mode stay readable.
- **The timetable that day, version-aware.** Every period-mode rule reads `timetable.slots.services.effective_slots_for(session, section_ids, on_date)`, which picks the slot version in force on that date and applies confirmed cover. Never `status=published, effective_to IS NULL`, which is only today's grid and is wrong for any past date inside the lock window, and wrong for a correction's recompute. The teacher projection `MyTimetableViewSet._teacher_timetable` (`timetable/slots/viewset.py:413-454`) moves into `timetable/slots/services.py` as `teacher_slots_for(staff_ids, on_date)`. Both `/timetables/my` and attendance's `my-registers` call it; attendance never imports a timetable viewset (ADR-0013).
- **Who marks a period register:**
  1. `all` scope: anyone holding `.mark`. `campus` scope: anyone holding `.mark`, on their own campus only;
  2. the effective teacher of that section's slot for that period on that date. With confirmed cover that is the substitute, and the absent teacher may not mark;
  3. the section's class teacher.

  A break period, or a period with no effective slot for the section that date, is refused (422 on `period_id`).
- **Leave in period mode.** A student with a daily `on_leave` row for the date is refused in any period register, as a `meta.rows` issue ("on approved leave"), so the server, not the UI, stops the absence alert. A half-day leave (`first_half`/`second_half`) still writes a daily row and so blocks every period that day. Mapping halves to periods by start time is recorded in `deferred-work.md`.
- **Lateness:** a period row's `late_minutes` is measured from that period's `start_time`, with the tenant's grace minutes (`calendar.late_minutes_from`). Correction approval recomputes it the same way.
- **Alerts:** dedupe per (student, date, event). An absence transition alerts only if no other row that date (any period, or a daily row written before a switch) is already `absent`. A late transition alerts only if none is already `late`. Late in P1 then absent in P3 sends one late alert and one absence alert.
- **Derived daily value (reports and report cards).** In `reports.py`, one function turns a student's rows for a date into a day:
  - a daily row for that date (leave, import, or marked before a switch) is the day, unchanged;
  - otherwise, from that date's period rows: every marked period `absent` → `absent`; any `absent` → `half_day`; the earliest marked period `late` → `late`, with that row's `late_minutes`; every marked period `excused` → `excused`; otherwise `present`.

  `student_summary`, `defaulters`, `student_late_arrivals` and `daily_register` all read derived days in period mode, so `examinations.attendance_summary_for` (`examinations/services.py:1444-1478`), which calls `reports.student_summary` directly, gets the same numbers. `daily_register` takes an optional `period_id` to list one period's raw rows instead.

## Alternatives considered (why not)

- **Merge the roster on the client** from `GET /students?section_id=` and `GET /student-attendance`. Rejected. That list matches any enrollment status, has no roll number, and needs `students.student.view`, which the marker may not hold. The server already has `section_roster`, the set the validator accepts.
- **Edit `/school-settings` for the mode.** Rejected. Its PATCH replaces the whole `academic` JSON (`school_settings/view.py:63-65`), so a client read-modify-write loses a concurrent change, and the JSON is untyped. A typed `/attendance-settings` writes only its own keys under a row lock, as `holiday_calendar/view.py:64-98` does for its slice, and keeps `school.settings.view`/`.update` as its keys.
- **Both modes side by side** (daily and period rows on the same date). Rejected. Two registers disagree about whether a student was present, every report must pick one anyway, and §19 calls it a mode.
- **Class teacher only marks periods.** Rejected (user, 2026-10-24). A secondary-school class teacher teaches perhaps one period a day.
- **Teacher-subject allocations as the marking scope.** Rejected. An allocation says a teacher teaches the subject this session, not that they hold this period today.
- **Today's published grid for the marker check.** Rejected (review). A republish end-dates the old cells, so a past date in the lock window would authorise the wrong teacher. `effective_slots_for` already answers "who taught it that day".
- **Count periods in reports.** Rejected (user, 2026-10-24). Report cards would change unit, and a month of daily history before a switch would not compare with what follows. A derived daily value is how SIS products report period attendance (PowerSchool's attendance conversion).
- **Materialise derived days into a table.** Rejected. It is a second copy that a correction or late leave approval would have to keep in step. The derivation runs once per report, inside the grouped query.
- **An alert per absent period,** or one alert for late and absent together. Rejected. The first floods a guardian; the second hides a skipped lesson behind a morning's lateness, and §12 lists them as two events.
- **One `attendance` service module.** Rejected. Separate resources and keys give separate modules (`student-attendance`, `attendance-corrections`, `leave-requests`, `staff-attendance`, `attendance-reports`, `attendance-settings`), per the `teacher-substitutions` precedent.
- **Staff can submit leave on a student's behalf.** Rejected (user, 2026-10-24); it is a §4/§11 change. Recorded in `deferred-work.md`.
- **Split the flat `attendance` app first.** Deferred; a refactor with no behaviour change. ADR-0010 says follow the app's shape, so new views and serializers go in `views.py`/`serializers.py`, and only service logic gets new files (`register.py`).
- **Report rows as a plain `oneOf`.** Rejected (review; ADR-0022). The summary and defaulters rows are identical, so a discriminator-less `oneOf` can't be narrowed. Each row carries `kind`, and that is the discriminator.
- **A home-screen "today's attendance" widget.** Out of scope; the home page is still Metronic's demo layout. Recorded in `deferred-work.md`.
- **ADR.** One is needed: PR A adds `docs/decisions/0028-one-attendance-mode-per-tenant.md`, covering one mode per tenant, the §11 marker widening, and the derived daily unit, plus its row in `docs/decisions/README.md`.

## Global Constraints

- **Verification:** CI only (`api`, `frontend`, `repo-hygiene`); dispatch `e2e-live` after each PR.
- **Commits:** Conventional Commits, no AI attribution, `Root cause:` on `fix` commits, and nothing committed or pushed without the user's go-ahead.
- **Generated contract:** the serializer or view change and the regenerated `openapi.yaml` and `schema.d.ts` go in one commit. Wire types are `ApiSchemas[...]` aliases (ADR-0005/0017). A reused choices enum gets its `ENUM_NAME_OVERRIDES` entry so `--fail-on-warn` stays green.
- **Dashboard** (skills `schoolhub-dashboard-screen` and `schoolhub-api-services`):
  - six-file service modules (`index.ts` + the five), registered in `Services`, with the aggregate `services/__tests__/index.test.ts` updated (L7);
  - query-key module and resource **constants**, never literals;
  - `useDataGridUrlState` for lists, `useUrlParams` for the register's date, section and period;
  - `FormDialogLayout` + `useFormDialogSubmit`, `useConfirmAction` + `ResponsiveAlertDialog`, conditionally mounted dialogs;
  - dates as `<Input type="date">`, "today" from `todayIsoDate()`;
  - theme tokens only (no arbitrary-value colours), with a status shown by token **plus** icon **plus** label;
  - i18n in `en` and `ur`, one `attendance` namespace (with the `nav.label` key `ModuleSectionNav` needs), reusing `common.*`;
  - fewer than 400 lines per file; named constants for magic values.
- **Cursor lists:** every attendance list is cursor-paginated (`collectPages`/`fetchPage` from `@schoolhub/api-client`). The register and staff-register endpoints are unpaginated by design: one section's roster, or one tenant's active staff.
- **Backend:**
  - an explicit `required_permission_map` entry for every new action, `AnyOf(...)` where two kinds of caller share a route (ADR-0027);
  - a cross-tenant 404 test per new endpoint;
  - `select_related` with an `assertNumQueries` test for each list and each new endpoint;
  - staff names through `Staff.full_name`, user names through `User.get_full_name`, never a new copy of the formatting;
  - one predicate, `register.may_mark_register(user, section, on_date, period)`, used by the register read, `my-registers` and `:bulk-mark`;
  - one derivation, `reports.derived_days(...)`, used by every student report and by examinations through `student_summary`.
- **Permissions:**

  | Section / action | Key |
  | --- | --- |
  | Register tab; submit | `attendance.student-attendance.mark` |
  | Records tab | `attendance.student-attendance.view` |
  | Request a correction (Records, Register, Staff) | `attendance.correction.create`, on a locked row only |
  | Corrections tab | any of `attendance.correction.create`, `attendance.correction.approve` |
  | Approve or reject a correction | `attendance.correction.approve`, never on the caller's own request |
  | Leave tab | `attendance.leave-request.view` |
  | Approve or reject leave | `attendance.leave-request.approve`, not the submitter, and not someone who decided an earlier level |
  | Staff tab; mark and check out | `attendance.staff-attendance.view`; `attendance.staff-attendance.mark` |
  | Reports tab; export | `attendance.report.view`; `attendance.report.export` |
  | Import (on Records) | `attendance.student-attendance.import` |
  | Settings tab | `school.settings.update` (reading uses `school.settings.view`) |

- **Docs ship in each PR:** `attendance.md` §4, §11, §16, §18, §19 and §20 as touched; `project-status.md`; `deferred-work.md`; `agent-lessons.md` for any catch; `apps/dashboard/AGENTS.md` if a shared piece is hoisted.

## Review Focus

1. **A teacher with `assigned` scope only can load and submit their register, and a campus-scoped one cannot reach another campus.** Every existing test uses an `all`-scoped teacher. Tests: Task 1 (daily, campus 404 on both endpoints); Task 2 (period: slot teacher, substitute, class teacher, the absent covered teacher refused, a stranger refused). The live lane does not prove the assigned path (its class teacher is `all`-scoped); the Django tests are the proof, and the PR says so.
2. **A past date after a republish.** A slot republished yesterday with a new teacher: the register for the day before authorises the old teacher, not the new one. Tests: Task 2.
3. **Leave in period mode.** An on-leave student is refused in every period register and alerts no one, whatever the UI sends. Tests: Task 2.
4. **Mode switch with rows already written.** A month of daily rows, then period mode: the register opens empty for today; old rows stay in Records; the summary, defaulters and an examinations report card count both months as days; imported rows still count. Tests: Task 2 (reports and examinations), Task 5 (the register follows `meta.attendance_mode`).
5. **A refused or replayed submission.** A 422 with `error.meta.rows` marks those rows inline with the server's `issue` and keeps every other choice. A 409 for locked rows (which names no students) reloads the register. Any edit after a submit regenerates the idempotency key, so a retry is never answered with an older submission's replay. Tests: Task 5, with the exact `meta.rows` shape (`services.py:371-400`, L5).

---

# PR A: Register (settings, period mode, register, records)

### Task 1: Backend: register contract and the assigned-scope fix

**Files:**
- Create: `apps/api/apps/attendance/register.py` (`may_mark_register`, `register_for`, `my_registers`).
- Modify: `apps/api/apps/attendance/{views,serializers,urls,models}.py`; `apps/api/apps/timetable/slots/{services,viewset}.py` (`teacher_slots_for` hoisted, `/timetables/my` switched onto it).
- Test: `apps/api/apps/attendance/tests/test_register_api.py`; `apps/api/apps/timetable/slots/tests/` (`/timetables/my` unchanged).
- Regenerate the contract.

**Interfaces:**
- Consumes: `timetable.slots.services.effective_slots_for(session, section_ids, on_date)`.
- Produces:
  - `may_mark_register(*, user, section: Section, on_date: date, period: Period | None) -> bool`. `services.assert_marker_may_mark_section` becomes a thin raise around it, so `:bulk-mark` keeps its 422 on `section_id`;
  - `teacher_slots_for(staff_ids: Collection[UUID], on_date: date) -> list[EffectiveSlot]`;
  - `GET /student-attendance/register?section_id=&date=[&period_id=]` → `{data: RegisterEntry[], meta: {attendance_mode, is_locked, markable, unmarkable_reason}}`, where `RegisterEntry = {student_id, student_name, admission_number, roll_number, record: StudentAttendance | null, on_leave: bool}`, in `section_roster` order;
  - `GET /student-attendance/my-registers?date=` → `{data: MyRegister[]}`, where `MyRegister = {section_id, section_name, class_name, campus_id, period_id | null, period_name | null, start_time | null, end_time | null, marked_count, roster_count}`;
  - read-only `student_name`, `admission_number`, `section_name`, `period_name` on `StudentAttendance`.

Steps:
- [ ] **Test first.** `test_assigned_only_class_teacher_can_bulk_mark_over_http`: a user whose role assignments are all `assigned`-scoped, the section's class teacher, POSTs `:bulk-mark` for today and expects 200. It fails with a 404 for the cause in Context; record CI's result in the PR description.
- [ ] Fix `_scoped_section`: `all`/`campus` callers keep `scope_queryset` (it is what holds the campus line). An `assigned`-only caller resolves the section through the tenant's alive manager and must pass `may_mark_register`; otherwise it is a 404 for `register` and the existing 422 on `section_id` for `:bulk-mark`.
- [ ] `StudentAttendance.filter_assigned_to_user` widens to class-teacher sections **or** rows the user marked (`marked_by`), so a slot teacher or substitute sees and can correct what they marked (L4).
- [ ] Routes go **before** the router (`academics/teacher_allocations/urls.py:22-30`), both mapped to `attendance.student-attendance.mark` with `DenyRestrictedPrincipals`.
- [ ] `register`: `meta.markable` is false with `unmarkable_reason` (`future`, `holiday` with its name, `non_working_day`, `locked`) where `assert_markable_date` or the lock window refuses, so the UI renders read-only rather than fails. `on_leave` is true for a student with a daily `on_leave` row for the date.
- [ ] `my-registers` resolves from the caller's own Staff rows **whatever their scope**. In daily mode: the sections they class-teach. In period mode: `teacher_slots_for` (their effective slots, cover included), plus every effectively timetabled period of sections they class-teach. Ordered by start time, then section name.
- [ ] Type the `:bulk-mark` 200 as `StudentAttendance` many (data only; meta stays described, per timetable PR B's envelope rule).
- [ ] Tests:
  - the assigned-only HTTP case;
  - a campus-scoped marker gets 404 on another campus's section, on both `register` and `:bulk-mark`;
  - a non-class-teacher with `assigned` scope gets 422 on bulk-mark and 404 on `register`;
  - register order (roll, then name, unnumbered last); `on_leave` set; existing record merged; a soft-deleted student and an inactive enrollment absent;
  - `meta.markable`/`unmarkable_reason` for future, holiday, weekend and locked dates;
  - `my-registers` for an `all`-scoped class teacher (not empty);
  - a teacher sees and can read a row they marked in a section they don't class-teach;
  - names on `GET /student-attendance`;
  - flat query counts and cross-tenant 404s for both routes; `/timetables/my` unchanged after the hoist.

### Task 2: Backend: attendance mode and period-mode rules

**Files:**
- Modify: `apps/api/apps/attendance/{services,register,reports,notifications,tasks,views,serializers,urls}.py`; `apps/api/apps/school_organization/calendar.py` (`late_minutes_from(start: time, check_in: time, *, campus_id)` beside `late_minutes`).
- Test: `apps/api/apps/attendance/tests/test_attendance_mode.py`; `apps/api/apps/examinations/tests/` (a report card in period mode); update `tests/test_marking.py:165-168` (`test_a_daily_and_a_period_register_do_not_overwrite_each_other` becomes "daily rows, switch, then period rows: neither overwrites the other").
- Create: `docs/decisions/0028-one-attendance-mode-per-tenant.md` and its `README.md` row.

**Interfaces:**
- Produces:
  - `services.attendance_mode() -> Literal["daily", "period"]`;
  - `GET/PATCH /attendance-settings` → `{attendance_mode, lock_window_days (0–7), leave_escalation_threshold_days (≥1)}`, view in `views.py`, serializer in `serializers.py`, keys `school.settings.view`/`.update`, feature `module.attendance`. PATCH reads the row with `get_settings_row`, merges only those keys into `tenant_settings.academic` (merging the nested `student_leave_approval` dict, not replacing it) under `select_for_update`, and is audited;
  - `reports.derived_days(queryset, *, start_date, end_date)` and its use in every student kind;
  - `daily-register` accepts `period_id` and returns `period_name`.

Steps:
- [ ] Settings: PATCH to `period` returns 422 on `attendance_mode` while `module.timetable` is off.
- [ ] Mode gate in `bulk_mark_student_attendance`, plus the break and no-effective-slot refusals, through `effective_slots_for`.
- [ ] `may_mark_register` period rules as designed (slot teacher; substitute replaces; class teacher; campus line).
- [ ] The daily `on_leave` refusal in period registers (a `meta.rows` issue).
- [ ] `late_minutes_from` for period rows, in marking and in correction approval.
- [ ] Alert dedupe per (student, date, event), reading daily and period rows.
- [ ] `derived_days` in `reports.py` per the design, computed in grouped queries (no per-student query).
- [ ] ADR-0028.
- [ ] Tests:
  - mode default and unknown value; the PATCH round trip; sibling `academic` keys and the nested dict's other keys survive; bounds; the timetable-off 422; key and cross-tenant checks;
  - wrong-shape submissions in each mode; break periods and periods with no lesson refused;
  - each marker accepted; the absent teacher refused when cover is confirmed; a stranger refused;
  - a slot republished yesterday: the day before authorises the old teacher;
  - an on-leave student refused in a period register, with no alert;
  - period lateness from the period start, with grace;
  - alerts: absent P1 then P2 → one absence alert; present P1 then absent P3 → one; late P1 then absent P3 → one late and one absence; a re-submission alerts no one;
  - `derived_days`: each rule in the design, a daily row winning over period rows, imported rows counted;
  - summary and defaulters across a switch count both halves in days; an examinations report card in period mode matches the summary;
  - `daily-register` with and without `period_id`.

### Task 3: Dashboard: Attendance shell and settings tab

**Files:**
- Create: `features/attendance/attendance-sections.ts`, `app/(app)/attendance/{layout,page}.tsx`, `app/(app)/attendance/settings/page.tsx`, `features/attendance/settings/{attendance-settings-form.tsx,__tests__/attendance-settings-form.test.tsx}`, `services/modules/attendance-settings/*`.
- Modify: `config/paths.ts`, `config/menu-config.ts` (an Attendance group after Timetable, `module: "attendance"`, `sectionMenuItems(ATTENDANCE_SECTIONS)`), `services/index.ts`, `services/endpoints.ts`, `messages/{en,ur}.json` (the `attendance` namespace).

**Interfaces:**
- Produces: `ATTENDANCE_SECTIONS` (final order Register, Records, Corrections, Leave, Staff, Reports, Settings, keys from the Permissions table; PR A adds Register, Records and Settings, and B and C append theirs); `Services.attendanceSettings.{fetchSettings, updateSettings}`.

Steps:
- [ ] Settings form: a mode radio group, lock window (0–7), escalation threshold. Help text says three things. Switching mode doesn't change rows already marked. Period mode needs a published timetable, and if registers are refused, switch back. Raising the lock window doesn't reopen rows already locked. A 422 lands under its field.
- [ ] Tests: the landing sends a viewer to the first permitted section; a `.view`-only user sees Records and no Register tab; the form round trip and field errors (including the timetable-off 422); the aggregate `Services` test lists the new domains.

### Task 4: Dashboard: student-attendance service module

**Files:**
- Create: `services/modules/student-attendance/{index,student-attendance-type,student-attendance-constant,student-attendance-helper,student-attendance.schema,student-attendance-service}.ts` and `__tests__/`.
- Create: `services/modules/attendance-corrections/*` with `requestCorrection` only (PR B adds the rest).

**Interfaces:**
- Produces:
  - `fetchRegister({sectionId, date, periodId?}) → {entries: RegisterEntry[], meta: RegisterMeta}`;
  - `fetchMyRegisters(date) → MyRegister[]`;
  - `bulkMark(input: BulkMarkInput, idempotencyKey: string) → StudentAttendanceRecord[]`;
  - `fetchAttendancePage(query: AttendancePageQuery)` (cursor);
  - `rowIssuesFromError(error: unknown) → Map<studentId, issue>`, reading `error.meta.rows`;
  - `requestCorrection({studentAttendanceId, newValues, reason})`;
  - constants `STUDENT_ATTENDANCE_QUERY_MODULE`, `REGISTER_RESOURCE`, `MY_REGISTERS_RESOURCE`, `MARKABLE_STATUSES` (every `AttendanceStatusEnum` value except `on_leave`, checked against the generated enum through a `Record<Status, boolean>`).
- [ ] Tests: query mapping (`dateFrom → date__gte`); `rowIssuesFromError` against the exact server shape; `on_leave` not in `MARKABLE_STATUSES`.

### Task 5: Dashboard: the register screen

**Files:**
- Create: `features/attendance/register/{register-screen.tsx,register-pickers.tsx,my-registers-list.tsx,register-table.tsx,register-row.tsx,use-register-form.ts,register-summary.tsx}` and `__tests__/`.
- Create: `app/(app)/attendance/register/page.tsx`.

Steps:
- [ ] URL state: `date` (default today), `section`, `period`. With no section chosen, **My registers** for the date: cards with a marked/roster count, opening the register. A viewer whose user carries `all`/`campus` scope also gets class, section and (in period mode) period pickers from `useClasses`, `useSections` and periods `for_campus`.
- [ ] The register: one row per student (roll, name, admission number), a status control from `MARKABLE_STATUSES`, check-in time for `late`, check-out time for `half_day`, and remarks. **Mark all present** fills every unmarked, non-leave row. `on_leave` rows show the status, are read-only, and are left out of the submission.
- [ ] A sticky summary (present, absent, late, other, unmarked) and **Submit**, disabled until every non-leave row has a status. Success toasts `marked`/`updated`/`alerts_queued` and invalidates the module constant.
- [ ] `use-register-form.ts` holds the idempotency key: `crypto.randomUUID()` on load, regenerated on **every** change to the grid and after each success.
- [ ] `meta.markable=false` renders read-only with the reason. When the reason is `locked` and the user holds `correction.create`, each marked row offers **Request correction** (Task 6's dialog).
- [ ] Errors: a 422 with `meta.rows` marks those rows with the server's `issue` and keeps every other choice; a 422 on `attendance_date`/`section_id`/`period_id` shows inline; a 409 reloads the register with a "some rows are locked" message.
- [ ] Tests: Review Focus 5; Mark all present skips leave rows; Submit gating; the key changes after an edit and after a success; the period picker only in period mode; My registers to register navigation.

### Task 6: Dashboard: records and request correction

**Files:**
- Create: `features/attendance/records/{records-table.tsx,record-columns.tsx,records-filters.tsx}`, `features/attendance/request-correction-dialog.tsx` (shared with Register and, in PR C, Staff), and `__tests__/`.
- Create: `app/(app)/attendance/records/page.tsx`.

Steps:
- [ ] `DataGrid` over `GET /student-attendance` with URL filters: date range (default the last 7 days), class then section, status, and locked. Columns: date, student, section, period (blank for a daily row), status badge, late minutes, source, locked icon. Sort by date.
- [ ] Request correction (locked rows, `correction.create`): new status (no `on_leave`), times, remarks, mandatory reason. Submit is disabled until a value differs from the current one, mirroring the server. Server errors land under their field.
- [ ] Tests: filters round-trip through the URL; the action only on locked rows with the key; the unchanged-values guard; a 422 under its field.

### Task 7: E2E, docs, PR A

**Files:**
- Create: `e2e/src/mocks/domains/attendance-register.ts`, `e2e/src/pages/dashboard/attendance/{register,records,settings}.page.ts` (registered in `pages/index.ts` and `fixtures/index.ts`), `e2e/tests/dashboard/attendance-register.spec.ts`, `e2e/tests/live/attendance-register-journey.spec.ts`.
- Modify: `e2e/src/pages/dashboard/dashboard.page.ts` (`sectionTab`'s module union gains `"Attendance"`), `e2e/src/data/factories` (attendance permission sets for the mocked lane), `e2e/tests/live/api/attendance-marking.spec.ts` (register and my-registers), `e2e/src/lib/live-attendance-register.ts` (`today()` from the server's UTC date, L20), `apps/api/core/rbac/management/commands/seed_e2e_data.py` (`school.class.view` for the class-teacher identity, which `useClasses` needs).
- Docs: `attendance.md` §4 and §11 (period markers), §16 (new routes, `period_id` on reports), §18 (timetable inbound), §19 (mode decided), §20; `project-status.md`; `deferred-work.md` (staff-on-behalf leave submission; half-day leave mapped to periods; the home widget; the flat-app split; the substitute's period submission as a candidate signal for `SubstitutionStatus.completed`).

Steps:
- [ ] The mock enforces the server's rules: whole-submission refusal with `meta.rows`, the on-leave refusal, the wrong-shape `period_id` 422, and read-only past the lock window (L5).
- [ ] Mocked spec: a teacher marks from My registers (Mark all present, one absent, one late with a time, submit); a refused row shown inline; a locked date read-only, with Request correction; a view-only user sees Records and no Register tab.
- [ ] Live CUJ: the seeded class teacher signs in, opens Attendance then Register, picks today's seeded section, marks, submits, and sees the rows in Records. Check the login-throttle budget in `e2e/AGENTS.md` before adding a signing-in spec (one cold navigation per login). Size waits from the real path (L6). The PR says this journey uses an `all`-scoped teacher and that the assigned path is proven in Django tests.
- [ ] `change-reviewer` → fix pass → the user's go-ahead → open the PR → watch CI → dispatch `e2e-live`.

---

# PR B: Approvals (corrections, leave)

### Task 8: Backend: corrections and leave contract

**Files:** `apps/api/apps/attendance/{models,serializers,views,filters}.py`; `tests/test_approvals_api.py`; regenerate.

Steps:
- [ ] Map corrections list and retrieve to `AnyOf("attendance.correction.create", "attendance.correction.approve")` (ADR-0027); `create` keeps `.create`. Scope comes from the user's role assignments (`user_scopes`), not from whichever key matched.
- [ ] `AttendanceCorrection.filter_owned_by_user` and `filter_assigned_to_user` return the caller's own requests (`requested_by`). Read-only `student_id`, `student_name`, `attendance_date`, `period_name`, `requested_by_name`, `reviewed_by_name`. A boolean `mine` filter.
- [ ] The correction target resolves through the caller's scoped `StudentAttendance` queryset (widened in Task 1), so a row outside their scope is a 404 and their own marked rows are reachable.
- [ ] `LeaveRequest`: read-only `student_name`, `admission_number`, `section_name` (the ACTIVE enrollment in the current session, one annotated subquery), `leave_type_name`, `submitted_by_name`, and `approver_name` on each `approvals[]` item.
- [ ] Tests: a principal lists the queue; a user with neither key gets 403; an assigned teacher sees only their own; an out-of-scope target is a 404; a slot teacher corrects their own locked period row end to end; names; flat query counts; cross-tenant 404s.

### Task 9: Dashboard: corrections queue

**Files:** `services/modules/attendance-corrections/*` (extended with `fetchCorrectionPage`, `decideCorrection(id, action, reviewNote?)`); `features/attendance/corrections/{corrections-table,correction-columns,corrections-filters,correction-decision-dialog,correction-diff}.tsx` and tests; `app/(app)/attendance/corrections/page.tsx`.

Steps:
- [ ] Filters: status (default pending), Mine. Columns: student, date, period, a before → after diff from `old_values`/`new_values` (one line per changed field), reason, requester, status.
- [ ] Approve and Reject (optional note) only on `pending` rows, with `correction.approve`, never on the viewer's own request. A 409 reloads the row.
- [ ] Tests: the self-review guard; the diff shows only changed fields; the 409 path.

### Task 10: Dashboard: leave queue

**Files:** `services/modules/leave-requests/*` (`fetchLeavePage`, `fetchLeaveTypes`, `decideLeave(id, action, note?)`); `features/attendance/leave/{leave-table,leave-columns,leave-filters,leave-detail-sheet,leave-decision-dialog}.tsx` and tests; `app/(app)/attendance/leave/page.tsx`.

Steps:
- [ ] Filters: status (default pending), leave type, date range. Columns: student, section, type, dates, day part, days, status, level (`current_approval_level` of the chain's length).
- [ ] Detail sheet: reason, the approval chain (level, required key, approver, decision, note), and the attachment through `Services.jobs.fetchFileDownloadUrl`. **Verify** the approver roles hold the file read key; if not, record the gap rather than widening it.
- [ ] Approve and Reject only on `pending`, with `leave-request.approve`, when the viewer is not the submitter and decided no earlier level. A level-2 refusal for a non-campus approver shows the server's message. Success toasts `auto_marked_days` when present.
- [ ] Tests: each gating rule; the chain rendering; the 422 message path.

### Task 11: E2E, docs, PR B

**Files:** `e2e/src/mocks/domains/attendance-approvals.ts`; `e2e/src/pages/dashboard/attendance/{corrections,leave}.page.ts`; `e2e/tests/dashboard/attendance-approvals.spec.ts`; docs.

Steps:
- [ ] Mocked spec: a principal approves a correction and cannot approve their own; a class teacher approves a short leave and sees an escalated one at level 2; a teacher sees only their own corrections.
- [ ] Docs: `attendance.md` §16 and §20; `project-status.md`; `deferred-work.md` (leave submission waits for parent-portal; guardians cannot upload an attachment because `platform.file.create` is staff-only).
- [ ] `change-reviewer` → fix → go-ahead → PR → CI → dispatch `e2e-live`.

---

# PR C: Staff attendance, reports, import

### Task 12: Backend: staff register, staff corrections, typed reports

**Files:** `apps/api/apps/attendance/{register,serializers,views,services,reports,tasks,models,urls}.py`; `tests/test_staff_register_api.py`, `tests/test_staff_corrections.py`, `tests/test_reports.py`; regenerate.

Steps:
- [ ] `GET /staff-attendance/register?date=[&department_id=]` → `[{staff_id, staff_name, employee_number, department_name, record: StaffAttendance | null, on_leave: bool}]`, active staff in name order, key `attendance.staff-attendance.mark`, scoped as staff attendance is.
- [ ] Read-only `staff_name`, `employee_number` on `StaffAttendance`.
- [ ] Corrections accept `staff_attendance_id` (exactly one target; `subject_type` derived). New values are status, check-in and check-out; approval recomputes late and early-departure minutes. The target resolves through the scoped staff-attendance queryset. `AttendanceCorrection.filter_by_campus` covers both targets (staff through `staff__campus_id`).
- [ ] Reports (a `fix` commit with its `Root cause:`): `threshold`, `period_id` and the mode at request time travel in the export job payload and its rebuild (`views.py:752-760`, `tasks.py:208-214`), as well as the inline path.
- [ ] Each report row carries `kind`. One serializer per kind, declared as the GET 200 through `PolymorphicProxySerializer` with `kind` as the discriminator (ADR-0022), plus the enum overrides.
- [ ] Tests: register order and the leave flag; a staff correction end to end (raise on a locked row, approve, minutes recomputed); an unlocked staff row refused; a campus approver sees a staff correction on their campus; a threshold of 90 includes an 80% student and 70 excludes them, inline **and** exported; the schema names each row type; query counts and 404s.

### Task 13: Dashboard: staff attendance

**Files:** `services/modules/staff-attendance/*`; `features/attendance/staff/{staff-register,staff-register-row,staff-records-table,staff-record-columns,check-out-dialog}.tsx` and tests; `app/(app)/attendance/staff/page.tsx`; `features/attendance/request-correction-dialog.tsx` (takes either target).

Steps:
- [ ] With `staff-attendance.mark`: a date-driven register (status, check-in, remarks per row, saved per row), Check out on a checked-in, unlocked row, Request correction on a locked row. Without it: the viewer's own history (`own` scope).
- [ ] Tests: the per-row save; check-out gating; the own-history view; the correction dialog with a staff target.

### Task 14: Dashboard: reports and import

**Files:** `services/modules/attendance-reports/*` (`runReport(query)` returning `{kind, rows} | {jobId}`, `exportReport(query, format)`); `features/attendance/reports/{reports-screen,report-form,report-table,report-columns}.tsx` and tests; `app/(app)/attendance/reports/page.tsx`; `features/attendance/records/import-attendance-button.tsx`.

Steps:
- [ ] The form: kind, date range (`daily-register` takes one date), section where the kind uses it, period (period mode, `daily-register` only, to list one period's raw rows), threshold for `defaulters` (default 75). All in the URL.
- [ ] Inline rows render in a per-kind table, narrowed on `kind`. A 202 polls the job (`useJobPolling`), then offers the file. Export CSV/XLSX/PDF (`report.export`) through `useJobFileDownload`.
- [ ] Import (Records toolbar, `student-attendance.import`): `BulkImportDialog` with the exact template headers (`admission_number, attendance_date, status` required; `check_in_time, check_out_time, remarks` optional) and the Records session closed over in `start`.
- [ ] Tests: per-kind columns; inline versus 202; export; the import button's gating.

### Task 15: E2E, docs, PR C

**Files:** `e2e/src/mocks/domains/attendance-staff-reports.ts`; `e2e/src/pages/dashboard/attendance/{staff,reports}.page.ts`; `e2e/tests/dashboard/attendance-staff-reports.spec.ts`; extend `e2e/tests/live/api/attendance-staff-reports.spec.ts` (staff register, staff correction, a threshold export); docs.

Steps:
- [ ] Mocked spec: HR marks two staff and checks one out; a defaulters report with threshold 90; an export job to download; an it_admin import.
- [ ] Docs: `attendance.md` §16 and §20 (dashboard complete); `project-status.md` (attendance full-stack complete; the next pickup is `communication` PR C or parent-portal); `deferred-work.md` (close the staff-correction and threshold gaps).
- [ ] `change-reviewer` → fix → go-ahead → PR → CI → dispatch `e2e-live`.

## Verification

- **Per PR:** `api`, `frontend` (lint, typecheck, Jest with an 85% floor, build, mocked Playwright) and `repo-hygiene` are green on `gh pr checks <n> --watch`. On failure, read `gh run view <id> --log-failed` and re-run once for an environment flake.
- **Manual (local stack, `seed_e2e_data`):**
  - **PR A:** an `assigned`-only class teacher marks today. Switch to period mode; the slot teacher marks P1, a confirmed substitute marks P2 and the absent teacher is refused; a student absent in both gets one alert; an on-leave student is refused; the summary still counts days.
  - **PR B:** approve a correction and a two-level leave.
  - **PR C:** an HR register with check-out, a staff correction, a defaulters report at 90%, and an XLSX export with the same rows.
- **Nightly `e2e-live`:** after each PR.
- **After code changes:** `graphify update .`.

## Independent review

- **Reviewer:** plan-reviewer agent, 2026-10-24
- **Verdict:** REVISE — the split and the approvals scope are sound, but period mode has five High holes: the campus-scope regression in the `_scoped_section` fix, a slot lookup that ignores timetable versions (reuse `effective_slots_for`), approved leave not enforced in period mode, report cards bypassing the report filter, and slot teachers unable to read or correct their own rows.
- **Findings addressed:** all 20 were folded in.
  1. **Campus regression.** `all`/`campus` callers keep `scope_queryset`; only assigned-only callers bypass it. Campus 404 tests on both endpoints (Task 1).
  2. **Version-blind slot lookup, duplicated projection.** `effective_slots_for` everywhere; `teacher_slots_for` hoisted into timetable's services; a republish test (design, Tasks 1–2).
  3. **Leave in period mode.**
     - The daily `on_leave` row is refused server-side in period registers.
     - Imports and leave stay daily and count through `derived_days`.
     - Half-day mapping deferred (design, Task 2, Task 7 docs).
  4. **Report cards bypass the filter.** The derivation lives in `reports.py`, so `student_summary` carries it to examinations. Examinations test added. Derived daily value chosen by the user (design, Task 2).
  5. **Slot teacher can't read or correct.** `filter_assigned_to_user` widened to rows the user marked; Task 8 resolves targets through it; an end-to-end test (Tasks 1, 8).
  6. **Alert dedupe merges events.** Per (student, date, event), daily rows included; the late-then-absent test (Task 2).
  7. **Timetable dependency.** Switching to `period` returns 422 while `module.timetable` is off; settings copy; §18 inbound (Tasks 2, 3, 7).
  8. **Threshold fix incomplete.** `threshold`, `period_id` and the mode travel through the job; an export-path test (Task 12).
  9. **Staff corrections hidden from campus approvers.** `filter_by_campus` covers both targets; test (Task 12).
  10. **Live-lane premises.**
      - `school.class.view` added in the seed command.
      - `today()` fixed per L20.
      - The assigned path is stated as proven in Django tests only.
      - The throttle budget is checked (Task 7).
  11. **My registers for wider scopes.** Resolved from the caller's Staff rows whatever their scope, with pickers as well (Tasks 1, 5).
  12. **Stale idempotency replay.** The key is regenerated on every grid change and after success; Jest test (Task 5).
  13. **Report schema vs ADR-0022.** `kind` on each row as the discriminator; enum overrides (Task 12).
  14. **Gate location and breaking tests.** The gate is in the service; import and leave stay mode-agnostic; `test_marking.py:165-168` rewritten (Task 2).
  15. **`settings.py` half-split.** The view goes in `views.py`, the serializer in `serializers.py`; nested merge; a sibling-keys test (Task 2).
  16. **Lock window doesn't unlock swept rows.** Settings help text and §20 (Tasks 3, 7).
  17. **L11 list.** "Never run tests, lint or typecheck" added to the header list.
  18. **ADR-0028 scope.** It covers the marker widening and the derived unit, plus its README row (Task 2).
  19. **Absent teacher marking covered periods.** The user decided the substitute replaces them; refusal test (Task 2).
  20. **Root cause provable from code.** Cited in Context; the test-first step is kept (Task 1).
- **Unresolved:** none.
  - User decisions (2026-10-24): the §11 marker widening with cover replacing the absent teacher, and the derived daily reporting unit, both resolving the reviewer's open questions 1–3.
