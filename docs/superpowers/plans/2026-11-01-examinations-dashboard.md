# Examinations Dashboard: Implementation Plan

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

**Goal:** Give `examinations` its dashboard, covering the whole §7.1 lifecycle:
- grading scales;
- exams with their subjects;
- the schedule with its clash list, and admit cards;
- marks entry, its progress dashboard, lock and import;
- result processing, approval and publishing, report cards and §13's reports;
- question banks with paper assembly.

The backend gaps those screens hit close in the same PRs. PR D also adds the live lane's process → approve → publish journey, the module's one recorded test gap.

**Architecture:** five sequential full-stack PRs, following the attendance and timetable pattern:

| PR | Branch | Ships |
| --- | --- | --- |
| A | `feat/exams-setup` | Names on exams and exam-subjects; session-aware `assigned` scope for `Exam` and `ExamSubject`; reference-data scope for grading scales; page-number pagination on exams and grading scales; the e2e tenant's examinations flag and the `exam_staff` and `teacher` identities. The Examinations shell, `/exams/grading-scales`, `/exams` and `/exams/{examId}` (the detail page with its Subjects tab) |
| B | `feat/exams-schedule` | Names and `exam_id` on sittings and admit cards; a read-only clash list; a typed `Conflict` and `:publish-schedule`; `section_id` on admit cards; subject teachers in the sitting scope; a scoped admit-card `:download`. The Schedule and Admit cards tabs |
| C | `feat/exams-marks` | `exams.marks.view`; one campus- and allocation-aware marks predicate; the grid read; `section_id` on bulk entry; per-section progress; typed bodies; the import's marker check, MIME allowlist and `ImportJobResult` shape. The Marks tab |
| D | `feat/exams-results` | `results.processed_by` stamped every run; names on results and report cards; typed action bodies; remarks split by key; a scoped report-card `:download`; report rows typed by `kind`. The Results and Report cards tabs, `/exams/reports`, and the live journey |
| E | `feat/exams-question-banks` | Names on banks and questions; page-number banks. `/exams/question-banks` and `/exams/question-banks/{bankId}` with paper assembly |

**Tech stack:** Django 6.1 + DRF 3.18 + drf-spectacular; Next.js 16 / React 19, TanStack Table 8 and Query 5, react-hook-form + zod, next-intl; Jest + RTL; Playwright (mocked `dashboard` project and the nightly `live` lane).

**Spec:**
- `docs/03-modules/examinations.md` (§3–§16 and §20, especially "Decisions worth carrying forward" and "Deliberately not built").
- `docs/05-database/entities/examinations.md`.
- `docs/02-architecture/api-architecture.md` §2.4.
- ADR-0021 (resource-scoped downloads), ADR-0022 (discriminated rows), ADR-0027 (`AnyOf`).
- `docs/project-status.md` (Tier 3 row) and `docs/deferred-work.md` (the "no examinations screens" entry).

**Plan file in the repo:** PR A's first commit carries this plan, with its review block (`docs: examinations dashboard plan`).

**Branching:**
- PR A branches from an up-to-date `main`.
- Each later PR branches from `main` once the previous one has merged.
- If it hasn't merged yet, stack with `gh pr create --base <previous branch>` and retarget to `main` after the merge.

## Context

The backend has been complete since PR E (`examinations.md` §20). The dashboard has nothing for it:
- no service modules, feature folder, `Paths` entries, menu entry or `nav.examinations` message;
- no mocks or page objects;
- no live spec.

Generated types exist for every model. The module's permission prefix, and so its menu gate (`canAccessModule`), is `exams`, not `examinations`.

Backend gaps the UI hits (an audit and an independent review, 2026-11-01; references are `apps/api/apps/examinations/` unless stated):

**Scope**
- An `assigned`-scoped teacher sees no exams. `Exam`, `ExamSubject`, `GradingScale` and `GradeBand` have no `filter_assigned_to_user`, so `scope_queryset` returns `.none()` (`core/rbac/permissions.py:279`).
- The same is true of `Section`, `Class` and `AcademicSession`. A production teacher therefore cannot pick a section or a session from the shared pickers; attendance hit this and solved it with `my-registers`.
- `marks-progress` takes no user and counts per class.

**Marks**
- Leadership cannot read marks. `GET /marks`, `/marks/{id}` and `/exams/{id}/marks-progress` are keyed `exams.marks.create` (teacher and exam_staff only).
- Writes and reads disagree. `assert_marker_may_enter` (`services.py:681`) allows any section of an allocated class, and returns early for any `all`/`campus` caller, so it has no campus line. `Marks.filter_assigned_to_user` (`models.py:796`) allows only allocated (section, subject) pairs and the homeroom.
- `:bulk-entry` carries no section.
- The marks import (`services.py:1047-1140`, `tasks.py:312-369`) checks no marker at all, and its upload MIME allowlist is never consulted (open audit Major, `docs/07-quality/2026-09-module-audit-findings.md`).
- No grid read exists: `_entry_students` takes no section, returns no roll data, and is not routed.

**Segregation**
- `results.created_by` is set by the first processing run and never re-stamped (`processing.py` `RESULT_COMPUTED_FIELDS`).
- So after `:send-results-back`, a second user who re-processes can approve their own run.
- `Result` exposes no processor at all.

**Downloads**
- Admit cards and report cards expose only `file_id`.
- The generic `/files/{id}:download` is the path ADR-0021 rules out for a new UI surface (audit C1).

**Contract**
- Names are ids only on every serializer except grading scales. `ExamSchedule` has no `exam_id` at all.
- Typing:
  - `:publish-schedule` is typed as a paginated list; its real body is `{status, conflicts}`;
  - `meta.conflicts` has no schema;
  - `:bulk-entry` returns `data: null`;
  - `marks-progress` and the lock, unlock, approve, send-back, publish and publish-report-cards actions are untyped. Their bodies exist in the services (`{approved}`, `{reopened, reason}`, `{published, withheld, published_ids}`, `{locked_rows, already_locked}`);
  - report rows are untyped.
- There is no clash list on load.
- `section_id` is missing on `/marks`, `/admit-cards` and `/report-cards`.
- Everything pages by cursor.
- Report-card PATCH needs `exams.report-card.create`, so a principal cannot write `principal_remarks` and a class teacher can.
- The import job returns `{rows, succeeded, errors}`, not `ImportJobResult`.

**Lifecycle**
- `ExamStatus` has eight values. Nothing sets `ongoing` or `archived`, and no archive action exists.
- Yet the delete refusal tells the user to "archive it instead" (`services.py`).

**Live lane**
- `module.examinations` is never enabled and there is no exams identity.
- The seeded class teacher is `all`-scoped with no Staff row and no homeroom.
- The seeded section has no roster by design, and the admission spec enrols into the baseline session every run, so an exam on it has an unbounded expected roll.

**User decisions (2026-11-01):**
- Five PRs, split as above.
- Reading marks gets its own key, `exams.marks.view`: `teacher`, `class_teacher`, `exam_staff`, `school_admin`, `principal`, `vice_principal`. Writing stays on `exams.marks.create`. This adds a §4 row.
- **One marks predicate for reads and writes.** An allocated (section, subject) in the exam's session, or the homeroom. Campus callers keep their campus line, and `all` callers are unaffected.
- **The processor is stamped on every run** (`results.processed_by`, PR D), and segregation compares against it.
- **The assembled paper downloads through the existing job-file flow** (as attendance's report exports do), recorded under audit C1. Admit cards and report cards get resource-scoped `:download` routes.
- **The marks-import MIME allowlist fix rides in PR C.**
- **The live lane gets a real `assigned` teacher**, `e2e-teacher`, allocated per run, so the production teacher path is proven end to end.

## Screen design

- **Navigation.** One Examinations group:

  | Section | Route | Key | PR |
  | --- | --- | --- | --- |
  | Exams | `/exams` | `exams.exam.view` | A |
  | Grading scales | `/exams/grading-scales` | `exams.grading-scale.view` | A |
  | Reports | `/exams/reports` | `exams.result.view` | D |
  | Question banks | `/exams/question-banks` | `exams.question-bank.view` | E |

- **The exam page, `/exams/{examId}`.**
  - A header carries the exam's name, session and term, dates, a status stepper over `ExamStatus`, and the actions the status allows.
  - In the stepper, `ongoing` renders as skippable (nothing sets it) and `archived` as terminal (nothing reaches it).
  - Below the header are tabs: Subjects (A), Schedule and Admit cards (B), Marks (C), Results and Report cards (D).
  - Each tab is gated on its key and kept in `?tab=`.
  - This mirrors `/academics/promotions/{batchId}`.
- **Status drives the actions, and the server is the judge.** A 409 or 422 reloads the exam and shows the server's message (`keep-server-message`, hoisted in PR A).
- **A teacher reaches marks from Marks progress**, which lists the caller's own (exam-subject, section) rows with names. No section or session picker is needed. The exams list works unfiltered, with `academic_session_name` on each row, for a caller whose `/academic-sessions` is empty.

## Alternatives considered (why not)

- **Flat top-level sections** (Schedule, Marks, Results each with an exam picker). Rejected. All of them are per exam, so five pickers would ask one question five times. The promotions review page set the per-object pattern.
- **Merge the marks roster on the client.** Rejected:
  - `/students` ignores enrolment status;
  - its assigned scope covers only the homeroom;
  - `/marks` returns only existing rows.

  The grid read reuses `_entry_students`, like `/student-attendance/register`.
- **A separate "my marking" endpoint for teachers.** Rejected in favour of making `marks-progress` per (exam-subject, section) for everyone, narrowed by the predicate. One shape serves chasing (exam staff) and finding your grid (teacher), and fixes the class-wide counts too.
- **Give `Section`, `Class` and `AcademicSession` assigned hooks now.** Deferred. It is a school-organization change with its own consumers (attendance's pickers too). The exams screens avoid needing them, and `deferred-work.md` records the gap.
- **Read marks through `AnyOf(...)` of unrelated keys** (user). Rejected.
- **Widen marks reads to every section** (user). Rejected.
- **Compute clashes on the client.** Rejected. The rules are the server's (`conflicts.py`), and a `GET` over `collect_scope` reuses them exactly.
- **Re-stamp `results.created_by` on re-process.** Rejected. `created_by` is the row's audit column. A dedicated `processed_by`, stamped each run, says what it means.
- **Download cards through `/files/{id}:download`.** Rejected (ADR-0021, audit C1). Each card gets a record-scoped `:download`.
- **Persist assembled papers.** Deferred (§15: papers have no table).
- **Reshape action bodies into one `{exam_status, moved}` form.** Rejected (review). It drops `withheld`, which the publish UI needs, and breaks existing tests. The existing bodies are typed instead, with `extend_schema(responses=...)`.
- **A `principal_remarks` permission key.** Rejected. `exams.report-card.publish` guards the principal's field and `.create` guards the class teacher's. A field the caller may not write is a 403 naming it, not a silently dropped read-only field (DRF ignores read-only input). This is recorded as an ADR-0027 amendment.
- **A generic reports form.** Rejected (repo-structure.md §5). Only the job panel and export buttons are hoisted; each module keeps its own form.
- **Page-number `/exam-subjects`.** Rejected. An exam can exceed the 100-row page (12 classes × 9 subjects), and pickers need the whole set. It stays a cursor, read through `collectPages`.

## Global Constraints

- **Verification:** CI only (`api`, `frontend`, `repo-hygiene`). Dispatch `e2e-live` after each PR.
- **Commits:** Conventional Commits, no AI attribution, `Root cause:` on `fix` commits, and nothing committed or pushed without the user's go-ahead.
- **Generated contract:** the serializer or view change and the regenerated `openapi.yaml` and `schema.d.ts` go in one commit. Wire types are `ApiSchemas[...]` aliases (ADR-0005/0017). A reused choices enum gets its `ENUM_NAME_OVERRIDES` entry.
- **Dashboard** (skills `schoolhub-dashboard-screen`, `schoolhub-api-services`):
  - six-file service modules registered in `Services`, with `services/__tests__/index.test.ts` updated (L7). The modules are `exams`, `grading-scales`, `exam-subjects`, `exam-schedules`, `admit-cards`, `marks`, `exam-results`, `report-cards`, `exam-reports` and `question-banks`;
  - query-key module and resource constants;
  - `useDataGridUrlState` for lists, `useUrlParams` for the tab and the grid's subject and section;
  - `FormDialogLayout` + `useFormDialogSubmit`, `useConfirmAction` + `ResponsiveAlertDialog`, conditionally mounted dialogs;
  - dates as `<Input type="date">`, times as `<Input type="time">`;
  - theme tokens only, with a status shown by token plus icon plus label;
  - i18n in `en` and `ur` in one `exams` namespace (plus `nav.label` and `nav.examinations`), reusing `common.*`;
  - fewer than 400 lines per file; named constants;
  - existing pickers reused: `useClassSubjectOptions`, `useTeachingStaffOptions`, `features/timetable/use-active-rooms.ts`, `use-reference-data`;
  - card downloads through their own `:download`; job files through `useJobFileDownload`.
- **Hoists happen in the task that first consumes them**, moving their `__tests__` too (ADR-0012), recorded in `apps/dashboard/AGENTS.md`:
  - `keep-server-message` → `src/lib/` (Task 3);
  - `use-cursor-list` / `use-cursor-stack` → `src/hooks/` (Task 6);
  - `cursor-data-grid-card` → `src/components/` (Task 7);
  - `rowIssuesFromError` → `src/services/shared/` (Task 9);
  - the report job panel and export buttons → `src/components/reports/` (Task 13).
- **Pagination:**
  - page number for `/exams`, `/grading-scales` (A) and `/question-banks` (E), added to §2.4's named list with its count updated;
  - grade bands unpaginated, ordered by `sort_order`;
  - every other list stays a cursor, and a whole set is read with `collectPages`.
- **Backend:**
  - an explicit `required_permission_map` entry for every new action;
  - a cross-tenant 404 test per new endpoint;
  - `select_related` with an `assertNumQueries` test per list and per new endpoint;
  - user names through `UserNamesModelSerializer`, hoisted from `apps/attendance/serializers.py:99` to `core/api/` in Task 1 (ADR-0013: a second app's use), with its single-object tests (L24);
  - staff names through `Staff.full_name`;
  - one teaching helper, `models._assigned_teaching(user) -> AssignedTeaching` (current allocations as `(section_id, class_id, subject_id, session_id)` plus homeroom section ids), used by every examinations assigned hook and by `services.may_enter_marks`.
- **Permissions:**

  | Section / action | Key |
  | --- | --- |
  | Exams section and exam page | `exams.exam.view` |
  | Create, edit, delete an exam (draft only) | `exams.exam.create` / `.update` / `.delete` |
  | Exam-subject writes | `exams.exam.update` |
  | Grading scales; create; edit, delete, set default | `exams.grading-scale.view`; `.create`; `.update` |
  | Schedule tab; add; edit, cancel, publish | `exams.schedule.view`; `.create`; `.update` |
  | Admit cards tab and download; issue, revoke | `exams.admit-card.view`; `exams.admit-card.issue` |
  | Marks tab (progress, grid read) | `exams.marks.view` (new) |
  | Enter marks | `exams.marks.create`, inside `may_enter_marks` |
  | Lock, unlock; import | `exams.marks.lock`; `exams.marks.import` |
  | Results tab; process; approve, send back; publish, withhold | `exams.result.view`; `.create`; `.approve` (never the processor); `.publish` |
  | Report cards tab and download; generate, class-teacher remarks; principal remarks, publish | `exams.report-card.view`; `.create`; `.publish` |
  | Reports section; export | `exams.result.view`; `exams.result.export` |
  | Question banks; write; approve a question; assemble | `exams.question-bank.view`; `.create` / `.update` / `.delete`; `exams.question.approve`; `exams.question-bank.update` |

  A `student`/`guardian` holds `exams.result.view` but `ExamReportView` is staff-only, so they would see a Reports tab that 403s. This is recorded in `deferred-work.md` like the attendance Leave-tab case (the dashboard is a staff tool; parent-portal owns their surface).
- **Docs ship in each PR:**
  - `examinations.md` §4, §11, §16 and §20 as touched;
  - `api-architecture.md` §2.4 (A, E);
  - ADR-0027's amendment (D);
  - `project-status.md`;
  - `deferred-work.md`;
  - `agent-lessons.md` for any catch;
  - `apps/dashboard/AGENTS.md` for each hoist.

  PR A corrects the stale rows in `project-status.md`: attendance and timetable are merged; communication PR B merged (#64) and PR C is open (#145). Verify each with `gh pr view` before editing.

## Review Focus

1. **A production `assigned` teacher**, end to end.
   - They see the exams of their allocations in the exam's session or their homeroom.
   - Progress lists their own (exam-subject, section) rows.
   - The grid opens from there.
   - Another section is a 404 on the grid read and a 422 on `section_id` for bulk entry and import.
   - Tests: Task 1 (exam list, session match), Task 8 (HTTP, assigned-only and campus-scoped), Task 14 (live, `e2e-teacher`).
2. **Segregation at approval.**
   - The processor of the latest run sees Approve disabled, with the reason.
   - A forced request gets the server's 422.
   - After send-back and a re-process by someone else, the original processor may approve and the new one may not.
   - Tests: Task 11 (backend), Task 12 (UI), Task 14 (live: a school owner who holds both keys processes, then is refused).
3. **A refused grid.**
   - A 422 with `meta.rows` marks those cells and keeps every other entry.
   - Each `unwritable_reason` renders read-only with the server's message.
   - The idempotency key regenerates on every edit and after each success.
   - Tests: Task 9, with the exact `meta.rows` shape (L5).
4. **Publishing a schedule with clashes.**
   - Hard clashes show on a fresh load and disable Publish.
   - A forced publish shows `error.meta.conflicts`.
   - Soft clashes warn.
   - A cancelled sitting leaves the list.
   - Tests: Task 5, Task 6.
5. **Re-running a batch.**
   - Re-issuing after a revoke reports the server's counts and keeps the revoked card revoked.
   - Re-processing keeps a withheld result withheld.
   - Tests: Task 7, Task 12.

---

# PR A: Setup (grading scales, exams, subjects)

### Task 1: Backend: setup contract, scope, pagination, e2e seed

**Files:**
- Modify: `apps/api/apps/examinations/{models,serializers,views,filters,services}.py`; `apps/api/apps/attendance/serializers.py` (import the hoisted mixin); create `apps/api/core/api/serializers_names.py` (or the module `core/api` already uses for serializer helpers) with `UserNamesModelSerializer` and its tests.
- Modify: `apps/api/core/rbac/management/commands/seed_e2e_data.py`, `apps/api/core/rbac/tests/test_seed_e2e_data.py`.
- Test: `apps/api/apps/examinations/tests/test_setup_scope.py` (new); extend `test_cross_tenant.py`.
- Regenerate the contract.

**Interfaces:**
- Produces:
  - `_assigned_teaching(user) -> AssignedTeaching` (a frozen dataclass: `allocations: tuple[(section_id, class_id, subject_id, session_id), ...]`, `homeroom_section_ids: frozenset`). `Marks.filter_assigned_to_user` switches onto it with no behaviour change;
  - `Exam.filter_assigned_to_user`: an exam with an exam-subject whose (class, subject) matches a current allocation **in the exam's session**, or whose class contains a homeroom section;
  - `ExamSubject.filter_assigned_to_user`: those same rows;
  - `GradingScale`/`GradeBand.filter_assigned_to_user` return the queryset. Their docstrings cite the `scope_campus_field=None` reasoning: tenant reference data needed to render any grade;
  - on `Exam`: `academic_session_name`, `term_name`, `grading_scale_name`, `subject_count`;
  - on `ExamSubject`: `exam_name`, `class_name`, `subject_name`, with `ordering` gaining `class__name` and `subject__name` (default class then subject);
  - `PageNumberPagination` on exams and grading scales; bands `pagination_class = None`, ordered by `sort_order`;
  - the delete refusal's message no longer says "archive it instead" (no archive exists). It says only a draft exam can be deleted.
- Seed:
  - enable `module.examinations` for both e2e tenants;
  - `e2e-exam-staff@schoolhub.test`: role `exam_staff`, `all` scope, the registry's `exam_staff` keys plus the reads its pickers use (`school.class.view`, `school.section.view`, `school.subject.view`, `school.room.view`, `academics.curriculum.view`, `staff.staff.view`, `school.academic-session.view`), `platform.job.view`, `platform.file.view` (L27);
  - `e2e-teacher@schoolhub.test`: role `teacher`, **`assigned`** scope, exactly the registry's `teacher` keys within `exams.*`, plus a `Staff` row linked to the user (no allocation; the live lib allocates per run);
  - one complete default grading scale, `E2E Percentage`.

Steps:
- [ ] **Test first:** `test_assigned_only_teacher_lists_the_exams_they_teach`. It fails on `main` with an empty list; record CI's result in the PR.
- [ ] Hooks, names, pagination, the message, the hoist and the seed as above.
- [ ] Tests:
  - the assigned-only case;
  - an allocation in another session does not show the exam;
  - a homeroom teacher sees their class's exams;
  - an `all` caller sees everything;
  - an assigned teacher reads every grading scale;
  - `Marks` scope unchanged on the helper (a test asserting the old and new paths agree on a fixture);
  - names and `subject_count`;
  - page-number meta;
  - bands in order;
  - flat query counts;
  - cross-tenant unchanged;
  - seed: the flag, both identities' keys and scopes, the teacher's Staff row, the scale, each idempotent;
  - `UserNamesModelSerializer` single-object and list cases.

### Task 2: Dashboard: Examinations shell and grading scales

**Files:**
- Create: `features/exams/exams-sections.ts`, `app/(app)/exams/{layout,page}.tsx`, `app/(app)/exams/grading-scales/page.tsx`, `features/exams/grading-scales/{grading-scales-table,grading-scale-columns,grading-scale-form-dialog,grade-bands-editor}.tsx` and `__tests__/`, `services/modules/grading-scales/*`.
- Modify: `config/paths.ts`, `config/menu-config.ts` (an Examinations group after Attendance, `module: "exams"`), `services/index.ts`, `services/endpoints.ts`, `messages/{en,ur}.json`.

**Interfaces:**
- Produces:
  - `EXAMS_SECTIONS` in the final order Exams, Grading scales, Reports, Question banks; each PR appends its own;
  - `Services.gradingScales.{fetchScalesPage, fetchScale, createScale, updateScale, deleteScale, setDefault, fetchBands, createBand, updateBand, deleteBand}`.

Steps:
- [ ] A page-number list (name, type, default badge, band count) with create, edit, delete and **Make default** (through `:set-default`).
- [ ] The band editor:
  - lists bands in order, with add, edit and remove;
  - shows an advisory coverage check (gaps, overlaps, not 0–100) computed from the rows;
  - the server's refusal lands under its field.
- [ ] Tests:
  - the landing sends a viewer to the first permitted section;
  - write controls hidden without `.create`/`.update`;
  - Make default calls `setDefault`;
  - the advisory flags a gap and an overlap;
  - a 422 lands under its field;
  - the aggregate `Services` test.

### Task 3: Dashboard: exams list and the exam page with Subjects

**Files:**
- Create: `services/modules/{exams,exam-subjects}/*`, `features/exams/list/{exams-table,exam-columns,exams-filters,exam-form-dialog}.tsx`, `features/exams/detail/{exam-page,exam-header,exam-status-stepper,exam-tabs}.tsx`, `features/exams/subjects/{exam-subjects-table,exam-subject-form-dialog}.tsx` and `__tests__/`, `app/(app)/exams/[examId]/page.tsx`.
- Hoist: `features/attendance/keep-server-message.ts` → `src/lib/`.

**Interfaces:**
- Produces:
  - `Services.exams.{fetchExamsPage, fetchExam, createExam, updateExam, deleteExam}`;
  - `Services.examSubjects.{fetchExamSubjects(examId) (collected), createExamSubject, updateExamSubject, deleteExamSubject}`;
  - `EXAM_STATUS_ORDER: Record<ExamStatus, number>` over all eight values;
  - `EXAM_TABS` (`subjects | schedule | admit-cards | marks | results | report-cards`, each with its key); B–D add theirs.

Steps:
- [ ] Exams list:
  - URL filters for session, term, status and type, plus search. Session is optional and unfiltered by default; the picker shows only when `/academic-sessions` returns rows;
  - columns name, session and term, type, dates, status, subjects;
  - create and edit (name, session, term, type, weightage, grading scale, dates, entry window);
  - delete on `draft` only.
- [ ] Exam page:
  - the header and stepper (`ongoing` skippable, `archived` terminal);
  - edit disabled past `scheduled`;
  - tabs from `EXAM_TABS` by key, in `?tab=`.
- [ ] Subjects tab:
  - the exam's subjects grouped by class (class, subject, max/pass marks, practical split, weightage, entry window, locked);
  - add and edit (class, subject from `useClassSubjectOptions`, marks, practical maximum when `has_practical`), and remove;
  - read-only past `scheduled`.
- [ ] Tests:
  - filters round-trip;
  - the list renders without a session read;
  - delete only on draft;
  - edit disabled past `scheduled`;
  - tabs hidden without their key;
  - the stepper covers every `ExamStatus`;
  - the practical field;
  - the duplicate 422 under `subject_id`.

### Task 4: E2E, docs, PR A

**Files:**
- Create: `e2e/src/mocks/domains/exams-setup.ts`, `e2e/src/pages/dashboard/exams/{grading-scales,exams,exam}.page.ts` (registered in `pages/index.ts` and `fixtures/index.ts`), `e2e/tests/dashboard/exams-setup.spec.ts`, `e2e/tests/live/api/exams-setup.spec.ts`, `e2e/src/lib/live-exams.ts`.
- Modify: `e2e/src/lib/seed-constants.ts` (`E2E_EXAM_STAFF_EMAIL`, `E2E_TEACHER_EMAIL`, `E2E_GRADING_SCALE_NAME`), `e2e/src/data/factories.ts` (exams permission sets).
- Docs:
  - `examinations.md` §16 and §20 (scope, names, pagination, the message);
  - `api-architecture.md` §2.4 (two lists, count);
  - `project-status.md` (the exams row, plus the stale rows, verified);
  - `deferred-work.md` (the screens entry narrowed; `Section`/`Class`/`AcademicSession` assigned hooks; the archive action and the unused `ongoing`; §6/§8 "clone an exam" not built; the Reports tab for portal roles).

**Interfaces:**
- Produces: `live-exams.ts`, reused by PRs B–D:
  - `seedExamScaffold(client, {band}) -> {sessionId, classId, sectionId, subjectId, studentIds}`: a run-unique session, class, section, curriculum row and a small active roster. It follows `seedTimetableScaffold` / `seedAttendanceRegister`, banded per worker, so no spec shares a roll;
  - `createExamWithSubject(client, scaffold) -> {examId, examSubjectId}`;
  - `allocateTeacher(client, scaffold, staffId)` → the `e2e-teacher`'s allocation to the scaffold's section and subject.

Steps:
- [ ] The mock enforces the server's rules (L5): delete past draft refused, writes past `scheduled` refused, the duplicate 422.
- [ ] Mocked spec: an exam author creates an exam and a subject and opens the page; a teacher sees the list read-only.
- [ ] Live API spec:
  - the exam staff creates an exam on a scaffold, adds its subject, reads it back with names, then deletes it as a draft;
  - `e2e-teacher`, once allocated, lists that exam and not another scaffold's.
- [ ] `change-reviewer` → fix pass → the user's go-ahead → open the PR → watch CI → dispatch `e2e-live`.

---

# PR B: Schedule and admit cards

### Task 5: Backend: sittings, clash list, admit cards

**Files:**
- Modify: `apps/api/apps/examinations/{models,serializers,views,filters,urls}.py`.
- Test: `tests/test_schedules.py` and `tests/test_admit_cards.py` (extend), `test_cross_tenant.py`.
- Regenerate the contract.

**Interfaces:**
- Produces:
  - on `ExamSchedule`: `exam_id`, `exam_name`, `subject_name`, `class_name`, `section_name`, `room_name`, `invigilator_name`;
  - `ConflictSerializer`, the `ExamConflict` schema (`type` and `severity` enums, `schedule_ids`, `message`);
  - `GET /exams/{id}/schedule-conflicts` → `{data: ExamConflict[]}` over `conflicts.collect_scope`, keyed `exams.schedule.view`, staff only;
  - sitting writes keep `meta.conflicts` (described);
  - `:publish-schedule` typed with its real body `{status, conflicts}`, and its list parameters removed;
  - on `AdmitCard`: `student_name`, `admission_number`, `section_id`, `section_name` (the student's active enrolment in the exam's session, one `Prefetch`), plus a `section_id` filter;
  - `POST /admit-cards/{id}:download` → `{download_url}`, keyed `exams.admit-card.view`, record-scoped (`get_object()` first), delegating to `core/files` signing (ADR-0021). It returns 404 while `file_id` is null and for a revoked card;
  - `ExamSchedule.filter_assigned_to_user` gains the allocated subject teacher, through `_assigned_teaching`.

Steps:
- [ ] Tests:
  - conflicts on a fresh read, hard and soft, with cancelled sittings excluded;
  - publish with a hard clash refused, with `error.meta.conflicts`;
  - names;
  - the admit-card section filter;
  - a subject teacher sees their sittings;
  - `:download` for an own-scope student (their card) and the 404 for another's, for a revoked card and for no file;
  - flat query counts;
  - cross-tenant 404 on both new routes.

### Task 6: Dashboard: Schedule tab

**Files:**
- Create: `services/modules/exam-schedules/*`, `features/exams/schedule/{schedule-tab,schedule-table,sitting-form-dialog,conflict-panel,publish-schedule-button}.tsx` and `__tests__/`.
- Hoist: `use-cursor-list` / `use-cursor-stack` → `src/hooks/`.

**Interfaces:**
- Produces: `Services.examSchedules.{fetchSittings(examId) (collected), createSitting, updateSitting, cancelSitting, deleteSitting, fetchConflicts(examId), publishSchedule(examId)}`, with writes returning `{sitting, conflicts}`.

Steps:
- [ ] Sittings grouped by date, then start time, with a clash marker on any sitting a conflict names.
- [ ] The dialog:
  - exam-subject (the collected list);
  - section of that subject's class;
  - date, start and end;
  - room (`use-active-rooms`), invigilator (`useTeachingStaffOptions`).

  On save, the panel refreshes from the write's `meta.conflicts`.
- [ ] The conflict panel loads from `schedule-conflicts`, hard findings first. **Publish schedule** is disabled while any hard finding exists.
- [ ] Cancel (a status) and delete (draft exams only).
- [ ] Tests: Review Focus 4; the section picker follows the subject's class; writes hidden without the keys.

### Task 7: Dashboard: Admit cards tab, E2E, docs, PR B

**Files:**
- Create: `services/modules/admit-cards/*`, `features/exams/admit-cards/{admit-cards-tab,admit-card-columns,issue-admit-cards-button,revoke-admit-card-dialog}.tsx` and `__tests__/`.
- Create: `e2e/src/mocks/domains/exams-schedule.ts`, `e2e/src/pages/dashboard/exams/{schedule,admit-cards}.page.ts`, `e2e/tests/dashboard/exams-schedule.spec.ts`, `e2e/tests/live/api/exams-schedule.spec.ts`.
- Hoist: `cursor-data-grid-card` → `src/components/`.
- Docs: `examinations.md` §16 and §20; `project-status.md`; `deferred-work.md`; `apps/dashboard/AGENTS.md`.

Steps:
- [ ] Admit cards:
  - a cursor list by section and status (number, student, admission number, section, status), with **Download** through `:download` once `file_id` exists;
  - **Issue admit cards** (Idempotency-Key, polled job) reports the server's counts;
  - **Revoke** needs a reason;
  - a revoked card shows the reason and offers no download.
- [ ] Tests: Review Focus 5 (re-issue after a revoke); download hidden without a file; issue hidden until the schedule is published.
- [ ] Mocked spec: two clashing sittings, the hard clash, one moved, publish, issue, revoke one.
- [ ] Live API spec, on a scaffold:
  - sittings, the clash list, publish;
  - issue (await the job);
  - a card listed with its section and a `file_id`;
  - `:download` returns a URL;
  - revoke.
- [ ] `change-reviewer` → fix pass → the user's go-ahead → open the PR → watch CI → dispatch `e2e-live`.

---

# PR C: Marks

### Task 8: Backend: marks view key, one predicate, the grid, the import

**Files:**
- Modify: `apps/api/apps/examinations/{permissions,services,models,serializers,views,filters,urls,tasks,uploads}.py`, `docs/03-modules/examinations.md` §4 and §11.
- Test: `tests/test_marks_grid.py` (new), `tests/test_marks.py` (extend, including the import cases at `:540-680`), `test_cross_tenant.py`.
- Regenerate the contract.

**Interfaces:**
- Produces:
  - **The key.** `exams.marks.view` registered for `teacher`, `class_teacher`, `exam_staff`, `school_admin`, `principal`, `vice_principal`, with its §4 row. `list`, `retrieve`, `progress` and `grid` are mapped to it.
  - **The predicate.** `services.may_enter_marks(*, user, exam_subject, section) -> bool`:
    - `all` scope → true;
    - `campus` scope → `section.campus_id` is in the caller's campus refs;
    - otherwise an allocation `(section, exam_subject.subject, exam.session)` exists, or the section is a homeroom.

    `assert_marker_may_enter(user, exam_subject, section)` raises 422 on `section_id` around it.
  - **`_entry_students(exam_subject, *, section=None)`** returns students with their roll number from the active enrolment, in roll order. The grid, bulk entry and import all use it.
  - **The grid read.** `GET /marks/grid?exam_subject_id=&section_id=` → `{data: MarksGridEntry[], meta}`:
    - an entry is `{student_id, student_name, admission_number, roll_number, marks: Marks | null}`;
    - `meta` is `{exam_subject: {max_marks, pass_marks, has_practical, practical_max_marks}, writable, unwritable_reason, unwritable_message}`;
    - `writable` is computed by running the same `assert_*` gates `bulk_enter_marks` runs, plus `has_permission_key(user, "exams.marks.create")`;
    - reasons: `exam_status`, `window_not_open`, `window_closed`, `locked`, `no_permission`. The message is the gate's own sentence;
    - a caller failing `may_enter_marks` gets 404.
  - **Bulk entry.** `BulkMarksEntrySerializer` gains a required `section_id`, gated once (422 on `section_id`). Every entry's student must be on that section's roll, or it is a `meta.rows` issue. The 200 is typed with the service's existing counts.
  - **Progress.** `marks-progress` returns per (exam-subject, section) rows `{exam_subject_id, subject_name, class_name, section_id, section_name, expected, entered, submitted, is_locked}`, filtered by `may_enter_marks` for a non-`all` caller, and typed.
  - **Lock and unlock** are typed with their existing bodies.
  - **`section_id` on `/marks`.**
  - **The import:**
    - the view requires that the caller may enter the exam-subject in at least one section;
    - the task resolves the user from `payload["requested_by"]` and checks each row's student's section with `may_enter_marks`, a per-row error otherwise;
    - the upload is checked against `uploads.MARKS_IMPORT`'s MIME allowlist;
    - the job result becomes `{total, succeeded, failed, errors[{row, field, issue}]}`.

Steps:
- [ ] **Test first:** `test_assigned_teacher_cannot_write_an_unallocated_section_of_their_class` (HTTP). It fails on `main` (the write succeeds); record CI's result.
- [ ] Tests:
  - the grid roll (active only, roll order, marks merged);
  - each `unwritable_reason`, including `window_not_open` and `no_permission` for a principal;
  - an assigned teacher's 404 on another section's grid and 422 on its bulk entry;
  - a campus-scoped principal's 404 on another campus's grid;
  - a homeroom teacher enters and reads every subject of their homeroom;
  - a student not on the section's roll as a `meta.rows` issue;
  - principal and `school_admin` read `/marks` and progress;
  - progress rows per section, narrowed for an assigned caller;
  - an import row for an unallocated section refused per row;
  - a disallowed MIME type refused;
  - the import result shape;
  - `may_enter_marks` and `Marks.filter_assigned_to_user` agree on a fixture;
  - flat query counts;
  - cross-tenant 404 for `grid`.

### Task 9: Dashboard: Marks tab

**Files:**
- Create: `services/modules/marks/*`, `features/exams/marks/{marks-tab,marks-progress-table,marks-grid-screen,marks-grid-table,marks-grid-row,use-marks-grid-form,lock-marks-button,import-marks-button}.tsx` and `__tests__/`.
- Hoist: `rowIssuesFromError` from `student-attendance-helper.ts:138` → `src/services/shared/`; attendance imports it.

**Interfaces:**
- Produces: `Services.marks.{fetchGrid({examSubjectId, sectionId}), bulkEntry(input, idempotencyKey), fetchProgress(examId), lockMarks(id), unlockMarks(id), importMarks(examSubjectId, file)}`.

Steps:
- [ ] Progress:
  - per (subject, section) rows with **Enter marks**, which opens `?subject=&section=`;
  - Lock and Unlock with `marks.lock`; unlock confirms and says it is audited;
  - after a send-back (exam back in `marks_entry` with subjects still locked), the tab tells the user to unlock before editing (L4).
- [ ] The grid:
  - roll, name, admission number, then theory, practical (with `has_practical`), absent, exempt, remarks;
  - absent and exempt clear and disable the marks;
  - an out-of-range hint against `max_marks`;
  - **Save draft** sends the non-blank rows plus the rows with a saved record (so a cleared row is cleared) as `draft`; **Submit** needs every row filled (a mark, absent or exempt) and sends every row as `submitted`; both with `section_id`. A blank row is never sent: it would count as "entered" in progress;
  - read-only with the server's message when `writable` is false.
- [ ] `use-marks-grid-form` regenerates the idempotency key on every edit and after each success.
- [ ] Import through `BulkImportDialog`, per exam-subject.
- [ ] Tests: Review Focus 3; absent disables marks; Submit sends `submitted`; progress → grid; the send-back hint; lock hidden without the key.

### Task 10: E2E, docs, PR C

**Files:**
- Create: `e2e/src/mocks/domains/exams-marks.ts`, `e2e/src/pages/dashboard/exams/marks.page.ts`, `e2e/tests/dashboard/exams-marks.spec.ts`, `e2e/tests/live/api/exams-marks.spec.ts`.
- Docs:
  - `examinations.md` §4 (Task 8), §11 (the narrowed rule), §16 (`grid`, `section_id`, progress) and §20;
  - `project-status.md`;
  - `deferred-work.md` (the audit's MIME item closed);
  - `agent-lessons.md`: a registered key no view reads, and a read predicate diverging from a write predicate.

Steps:
- [ ] The mock enforces whole-grid refusal with `meta.rows`, absent/exempt exclusivity, the section gate, and read-only when locked (L5).
- [ ] Mocked spec:
  - a teacher opens the grid from progress, enters marks with one absentee, and submits;
  - one out-of-range cell refused inline;
  - the exam author locks and the grid turns read-only.
- [ ] Live API spec (`e2e-teacher`, allocated to a scaffold):
  - progress lists exactly their row;
  - the grid shows the roster;
  - submit;
  - another scaffold's section is a 404;
  - the exam staff sees entered = expected and locks;
  - a re-submission is refused.
- [ ] `change-reviewer` → fix pass → the user's go-ahead → open the PR → watch CI → dispatch `e2e-live`.

---

# PR D: Results, report cards, reports

### Task 11: Backend: processor stamp, results and report-card contract, typed reports

**Files:**
- Modify: `apps/api/apps/examinations/{models,processing,services,serializers,views,filters,reports}.py`; a migration adding `results.processed_by` (FK user, nullable, backfilled from `created_by`); `docs/05-database/entities/examinations.md`; `docs/decisions/0027-any-of-permission-keys.md` (the per-field amendment); `seed_e2e_data.py`.
- Test: `tests/test_processing.py`, `tests/test_report_cards.py` and `tests/test_reports.py` (extend), `test_cross_tenant.py`.
- Regenerate the contract.

**Interfaces:**
- Produces:
  - **The processor stamp.** `processed_by` is stamped by every processing run (added to `RESULT_COMPUTED_FIELDS` and set on create). `approve_exam_results` compares the approver against `processed_by`.
  - **On `Result`:** `processed_by` (id) and `processed_by_name`, `approved_by` (id) and `approved_by_name`, plus `student_name`, `admission_number`, `section_name`.
  - **Typed action bodies.** `:approve-results`, `:send-results-back`, `:publish-results` and `:publish-report-cards` keep their existing bodies, now typed with explicit serializers.
  - **On `ReportCard`:** `student_name`, `admission_number`, `section_name`, `percentage`, `grade`, plus a `section_id` filter.
  - **Remarks.** The report-card PATCH is `AnyOf(exams.report-card.create, exams.report-card.publish)`. `class_teacher_remarks` needs `.create` and `principal_remarks` needs `.publish`; a field the caller lacks is a 403 naming it.
  - **Report-card download.** `POST /report-cards/{id}:download` → `{download_url}`, keyed `exams.report-card.view`, record-scoped, published-only for a restricted principal (ADR-0021).
  - **Report rows.** One serializer per `kind`, combined with `PolymorphicProxySerializer(resource_type_field_name="kind")` (ADR-0022).
- Seed:
  - `e2e-principal` gains `exams.exam.view`, `exams.marks.view`, `exams.result.{view,approve,publish}`, `exams.report-card.{view,publish}`;
  - `e2e-teacher` already holds what the journey needs.

Steps:
- [ ] Tests:
  - the processor stamp across a send-back: A processes, B re-processes, B's approve is refused and A's succeeds;
  - names and ids;
  - the typed bodies equal what the services return;
  - the remarks split, both ways;
  - `:download` scope (and 404 for an unpublished card to a student);
  - each `kind` validates against its schema;
  - the migration backfill;
  - flat query counts;
  - cross-tenant 404 on the new route.

### Task 12: Dashboard: Results and Report cards tabs

**Files:**
- Create: `services/modules/{exam-results,report-cards}/*`, `features/exams/results/{results-tab,result-columns,result-lifecycle-bar,result-detail-sheet,withhold-result-dialog}.tsx`, `features/exams/report-cards/{report-cards-tab,report-card-columns,remarks-dialog}.tsx` and `__tests__/`.

Steps:
- [ ] Results:
  - **Process results** (`result.create`, Idempotency-Key, polled job), with the outstanding-marks refusal linking to the Marks tab;
  - a cursor table (rank, student, section, percentage, grade, GPA, outcome, status) by section, outcome and status;
  - the lifecycle bar offers Approve and Send back (`.approve`) and Publish (`.publish`) by status;
  - Approve is disabled when the current user's id equals `processed_by`, with the reason;
  - publish reports the server's published and withheld counts;
  - Withhold confirms;
  - the detail sheet lists the student's subject marks from `GET /marks?exam_id=&student_id=`.
- [ ] Report cards:
  - **Generate** (job), a list by section and status, and **Download** through `:download` once a file exists;
  - **Remarks** shows only the fields the viewer may write;
  - **Publish report cards**.
- [ ] Tests:
  - Review Focus 2 and 5;
  - the outstanding-marks refusal;
  - actions by status;
  - the remarks dialog per key;
  - the withheld count.

### Task 13: Dashboard: Reports section

**Files:**
- Create: `services/modules/exam-reports/*`, `features/exams/reports/{exam-reports-screen,exam-report-form,exam-report-columns}.tsx` and `__tests__/`, `app/(app)/exams/reports/page.tsx`.
- Hoist: attendance's report job panel and export buttons → `src/components/reports/`; attendance keeps its own form.

Steps:
- [ ] A kind picker (six kinds); an exam picker (hidden for `question-bank-usage`); columns per kind from the typed rows.
- [ ] Inline under 1,000 rows, a 202 to the job panel, and export CSV/XLSX/PDF with `result.export`.
- [ ] Tests: each kind's columns; the 202 path; export hidden without the key; attendance's reports tests unchanged on the hoisted pieces.

### Task 14: E2E, the live journey, docs, PR D

**Files:**
- Create: `e2e/src/mocks/domains/exams-results.ts`, `e2e/src/pages/dashboard/exams/{results,report-cards,reports}.page.ts`, `e2e/tests/dashboard/exams-results.spec.ts`, `e2e/tests/live/api/exams-results.spec.ts`, `e2e/tests/live/exams-results-journey.spec.ts`.
- Modify: `e2e/src/lib/live-exams.ts` (`buildProcessedExam(...)`, used by both live specs).
- Docs:
  - `examinations.md` §16 and §20 (the processor stamp, remarks split, downloads; the E2E gap closed);
  - the entity doc;
  - ADR-0027 (Task 11);
  - `project-status.md`;
  - `deferred-work.md`;
  - `agent-lessons.md` as caught.

Steps:
- [ ] The mock enforces approver ≠ processor, approve-before-publish, and withheld surviving a re-process (L5).
- [ ] Mocked spec: an exam author processes; the principal approves and publishes; the processor's Approve is disabled.
- [ ] Live API journey (`exams-results.spec.ts`), on its own scaffold:
  1. the exam staff builds the exam and publishes the schedule;
  2. `e2e-teacher` (allocated) enters and submits marks;
  3. the exam staff locks and processes (await the job);
  4. `e2e-admin` (the school owner, holding both keys) re-processes after a send-back by the principal, then tries to approve, and gets a 422;
  5. the principal approves and publishes;
  6. the exam staff generates report cards; a card gets a `file_id` and `:download` returns a URL.

  Logins: one per identity per worker (the `guardianSession` pattern, e2e/AGENTS.md throttle).
- [ ] The student's view of published results stays in Django tests (`views.py` restricted-principal narrowing, already covered). Enrolling the seeded student into run-unique sections across parallel workers would race on its single active enrolment. The PR says so.
- [ ] Live browser CUJ: the principal signs in, opens Examinations, then the exam, then Results, and approves and publishes an exam that **this spec** builds to `processing` through `buildProcessedExam`. Check the login budget; size waits from the real path (L6).
- [ ] `change-reviewer` → fix pass → the user's go-ahead → open the PR → watch CI → dispatch `e2e-live`.

---

# PR E: Question banks

### Task 15: Backend: banks and questions contract

**Files:**
- Modify: `apps/api/apps/examinations/{serializers,views}.py`.
- Test: `tests/test_question_banks.py` (extend).
- Regenerate the contract.

**Interfaces:**
- Produces:
  - `subject_name` and `class_name` on `QuestionBank`;
  - `approved_by_name` on `Question`;
  - `PageNumberPagination` on `/question-banks`;
  - the `:assemble-paper` job result `{result_file_id, questions, total_marks}` documented in §16.

Steps:
- [ ] Tests: names, page-number meta, flat query counts.

### Task 16: Dashboard: question banks and paper assembly, E2E, docs, PR E

**Files:**
- Create:
  - `services/modules/question-banks/*`;
  - `features/exams/question-banks/{question-banks-table,question-bank-form-dialog,bank-page,questions-table,question-form-dialog,assemble-paper-dialog}.tsx` and `__tests__/`;
  - `app/(app)/exams/question-banks/{page,[bankId]/page}.tsx`.
- Create: `e2e/src/mocks/domains/exams-question-banks.ts`, `e2e/src/pages/dashboard/exams/question-banks.page.ts`, `e2e/tests/dashboard/exams-question-banks.spec.ts`, `e2e/tests/live/api/exams-question-banks.spec.ts`.
- Docs:
  - `examinations.md` §16 and §20;
  - `api-architecture.md` §2.4;
  - `project-status.md` (examinations full-stack complete);
  - `deferred-work.md`: persisted papers and a past-papers list; the paper download through the job-file flow, under audit C1; `:generate-questions` waiting on `core/ai`.

Steps:
- [ ] Banks: a page-number list (name, subject, class or "every level", questions, status), with create, edit and delete.
- [ ] Bank page:
  - questions filtered by topic, difficulty, type, source and approved;
  - add and edit with the type's own fields;
  - an unapproved `ai_generated` question shows **Approve** (`question.approve`) and the AI label.
- [ ] **Assemble paper:**
  - a blueprint of sections (topic, difficulty, type, count, marks) and a title;
  - on 202 a polled job, then a download of `result_file_id` through `useJobFileDownload`;
  - every shortfall the server names is listed;
  - the dialog says to download now, since papers are not kept in a list.
- [ ] Tests:
  - Approve only on unapproved AI questions with the key;
  - the shortfall list;
  - the download after the job;
  - a teacher sees only their subjects' banks (the mock follows the server's scope).
- [ ] Live API spec: create a bank, add questions, assemble a two-section paper (await the job, download URL returned), and an over-asking blueprint refused with every shortfall.
- [ ] `change-reviewer` → fix pass → the user's go-ahead → open the PR → watch CI → dispatch `e2e-live`.

## Verification

- **CI per PR:** `api`, `frontend` (lint, typecheck, Jest at the 85% floor, build, mocked Playwright) and `repo-hygiene`, via `gh pr checks <n> --watch` and `gh run view <id> --log-failed`. No local runs (ADR-0007).
- **Red tests:** the test-first cases (Task 1, Task 8) must fail on the first CI run, with the result recorded in the PR before the fix lands.
- **Nightly `e2e-live`:** dispatched after each PR. PR D's run is the module's first live result journey.

## Independent review

- **Reviewer:** plan-reviewer agent, 2026-11-01
- **Verdict:** REVISE. The split, the exam page and the user's rulings are sound, but five High holes need fixing first:
  - a production `assigned` teacher has no source for a section;
  - a campus leak in the grid;
  - a live segregation step that would 403 rather than 422, plus a processor stamp that a re-process never updates;
  - live fixtures resting on false premises;
  - card downloads through the generic files endpoint that ADR-0021 rules out.
- **Findings addressed:**
  1. **No section source for an assigned teacher.** Progress is now per (exam-subject, section), narrowed by the predicate, and opens the grid. The exams list works without a session read. The `Section`/`Class`/`AcademicSession` gap is recorded.
  2. **Campus leak.** `may_enter_marks` has a campus line; there is a campus-scoped 404 test.
  3. **Segregation.**
     - (a) the live refusal uses `e2e-admin` (both keys);
     - (b) `processed_by` is exposed as an id;
     - (c) `results.processed_by` is stamped every run (user ruling).
  4. **Fixtures.** Run-unique `seedExamScaffold` per worker band. A real `assigned` `e2e-teacher` with a Staff row, allocated per run (user ruling). The class teacher is untouched. The student's view stays in Django tests (single-enrolment race). The browser CUJ builds its own exam.
  5. **Downloads.** `:download` on admit cards and report cards. The paper uses the job-file flow, recorded under C1 (user ruling).
  6. **Bulk entry has no section.** A required `section_id`; `_entry_students(section=)` with roll data.
  7. **Import.** A view-level and per-row marker check from `requested_by`; the MIME allowlist (user ruling).
  8. **`unwritable_reason`.** Computed from the same gates, with `window_not_open` and `no_permission` added.
  9. **Stepper.** All eight states; the "archive it instead" copy fixed; archive recorded.
  10. **Action bodies.** The existing bodies are typed, not reshaped.
  11. **Progress counts.** Per section.
  12. **Paging exam-subjects.** `/exam-subjects` stays a cursor, collected.
  13. **Reuse.** `UserNamesModelSerializer` hoisted to `core/api`, `rowIssuesFromError` hoisted, existing pickers named.
  14. **Session match.** The exam scope matches the allocation's session; an agreement test.
  15. **Reference data.** The docstring cites `scope_campus_field=None`; the reference-data gap is recorded.
  16. **Reports tab for portal roles.** Recorded (Leave-tab precedent).
  17. **File names.** Corrected.
  18. **#145.** Recorded as open, verified before editing.
  19. **Hoists.** Moved to their first consumer; `decision-dialog` and `date-range-inputs` dropped; only the report job panel and export buttons.
  20. **Clone and send-back.** Clone-an-exam deferred; the send-back unlock hint added.
  21. **Per-field 403.** An ADR-0027 amendment; the §2.4 count updated.
  22. **Permissions and seed keys.** The table fixed; `exams.marks.view` for the principal; picker reads for the exam staff.
- **Unresolved:** none. The reviewer's four open questions (the processor stamp, the paper download, the MIME fix, the live teacher) were decided by the user on 2026-11-01.
- **Amendments after approval:**
  - 2026-11-02 (Task 9, Stop rule 3): the grid's Save draft sends the non-blank rows plus the rows with a saved record, and Submit needs every row filled and sends every row as `submitted`, instead of both sending every row. Sending a blank row would create a marks row with no mark, which progress counts as "entered".
  - 2026-11-02: `MARKS_IMPORT` also accepts `application/vnd.ms-excel`, because Windows browsers send `.csv` with it. Without it, enforcing the list in this PR would newly refuse uploads that work today. The parser dispatches on the file name, the `fees.settlement-file` precedent applies, and it is tested.
