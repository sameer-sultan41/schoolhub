# Project Status — SchoolHub

Living hand-off note: what exists and where the next session should start — across the
backend, both frontends, and infra. What is deliberately missing, and why, is in
[`deferred-work.md`](deferred-work.md).
**Update this file in the same PR as the work it describes.**

Specification (source of truth): [`./`](./) — this directory
Read [`../AGENTS.md`](../AGENTS.md) first — especially the context-map rule.

---

## Where we are in the plan

[`01-phases/phase-plan.md`](01-phases/phase-plan.md) → we are in **Phase 2 (Core
Build)**, per [`01-phases/phase-2-core-build.md`](01-phases/phase-2-core-build.md).

| Tier | Modules | Status |
| ---- | ------- | ------ |
| 0 — Foundation | tenancy, auth/RBAC, [`school-organization`](03-modules/school-organization.md) | Done in substance — tenancy/RBAC/audit/API plumbing in `apps/api/core/`, `school_organization` Django app shipped and merged |
| 1 — People | [`student-management`](03-modules/student-management.md), [`staff-management`](03-modules/staff-management.md) | `staff-management` is full-stack complete (API + dashboard, rebuilt post-shell-reset). `student-management`'s API is complete (PRs 1-4), and its dashboard — rebuilt in phases after the shell reset: directory/create/edit/withdraw; guardians/emergency contacts/documents; enrollment/class-section allocation/transfers; bulk import/export/ID cards — is too. **Phase 4 shipped** — student-management full-stack complete; Tier 1 done. See the per-module matrix below |
| 2 — Daily ops | [`academics`](03-modules/academics.md), [`timetable`](03-modules/timetable.md), [`attendance`](03-modules/attendance.md) | **Backend complete.** `academics` and `timetable` shipped; `attendance` shipped as three stacked PRs (marking → leave → staff/reports). The `academics` and `timetable` dashboard screens were each built once, then removed along with every other business route by the `apps/dashboard` shell reset (see `docs/metronic-dashboard-shell.md`); `attendance`'s were never built until now: they were built as three PRs (register → approvals → staff and reports; plan `docs/superpowers/plans/2026-10-24-attendance-dashboard.md`), and attendance is **full-stack complete**: **PR A — the register, Records, Settings and the tenant's attendance mode (#134) — PR B — the corrections and leave queues (#137) — and PR C — staff attendance, reports and the historical import (#141) — have all merged**. `academics`' were rebuilt as three PRs and are **full-stack complete**: **PR A, the curriculum screen, PR B, teacher allocation and load, and PR C, promotions, have shipped**. `timetable`'s were rebuilt as three stacked PRs (setup → week grid → cover; plan `docs/superpowers/plans/2026-10-19-timetable-dashboard.md`) and are **full-stack complete**: **PR A, the setup screens (`/timetable/periods`, `/timetable/rooms`, #119), PR B, the week grid (`/timetable/grid`, #120), and PR C, cover (`/timetable/substitutions`, `/timetable/my`, #123), have merged**. Build order is `academics → timetable → attendance`, not the order the phase doc lists them: timetable needs academics' `teacher_subject_allocations` as its scheduling input, and attendance's period mode needs timetable |
| 3 — High-stakes | [`examinations`](03-modules/examinations.md), [`fees-finance`](03-modules/fees-finance.md) | **`examinations` backend complete** — all five stacked PRs landed (setup → scheduling/admit cards → marks → results/report cards → reports/question banks), all 11 §15 tables, all §4 keys, all six §12 notifications. **Its dashboard is built across five stacked PRs, all open: A #147, B #149, C #152, D #154, E #155; full-stack once they merge** (setup → schedule and admit cards → marks → results, report cards and reports → question banks and paper assembly; plan `docs/superpowers/plans/2026-11-01-examinations-dashboard.md`). `fees-finance` is **backend complete** — all four stacked PRs landed (ledger + fee config → invoicing → collection → spend/reports), 18 of its 22 tables, all of §4's permission keys, §13's eight reports. Payroll's four tables are deliberately deferred to ship with `hr-leave`, since `payslips.lop_days` comes from that module. **Tier 3's backends are done**; examinations' dashboard waits on its stack. **The earlier "blocked on its own spec" note was stale** — `03-modules/fees-finance.md` (§1-§19) and `05-database/entities/finance.md` (all 22 tables, column level) were both already complete. Payroll's four tables are deliberately deferred to ship with `hr-leave`, since `payslips.lop_days` comes from that module |
| 4 — Outward | [`communication`](03-modules/communication.md), [`parent-portal`](03-modules/parent-portal.md) | **`communication` backend complete** (the `GET /notifications` inbox landed with the parent portal), **with its threads, oversight and broadcast dashboard done**; its other staff screens (announcements, notices, template overrides, notification preferences, delivery logs) are not built (`docs/deferred-work.md`). PR A merged (#62) — tenant-editable per-channel notification templates and per-user channel preferences, both wired into `core/notifications` (which already owns `notifications`/`delivery_logs`/`notify()` — see item 11 below) via two self-registering hooks so `core/` never imports a Tier-4 app. PR B merged (#64): announcements and formal notices with a publish-approval gate. PR C (#145): message threads with read receipts and audited oversight, and the digest-confirmed emergency broadcast (ADR-0029, ADR-0030). PR D: the threads, oversight and broadcast dashboard — the Messages inbox, read-only thread oversight and the emergency broadcast wizard. Plan: `docs/superpowers/plans/2026-10-31-communication-threads-and-broadcast.md`. **`parent-portal` in review as two stacked PRs** (plan `docs/superpowers/plans/2026-11-04-parent-portal.md`): PR 1 (`feat/parent-portal-api`) is the backend, `GET /parent-portal/dashboard`, the `GET /notifications` inbox, guardian notice browsing, `/timetables/my?student_id=` and `/auth/me`'s `is_restricted_principal`; PR 2 (`feat/parent-portal-dashboard`) is the dashboard's `(portal)` route group and completes the portal UI ([ADR-0032](decisions/0032-parent-portal-in-dashboard-route-group.md)). **PR B (`feat/portal-leave-vouchers`, stacked on PR 2)** adds guardian uploads, leave requests, fee vouchers, change password and message attachments to the portal (backend ownership checks, then the dashboard; module doc §20). **PR C (`feat/portal-admit-cards`, stacked on PR B and the examinations schedule stack)** adds a child's current admit cards, with download, to the portal's Results page. **Only seeded guardians and students can log in until account onboarding ships** (`docs/deferred-work.md`) |
| Phase 3 — AI (started early) | the AI gateway (`core/ai`) and AI-FEE-02 | **In review** on `feat/ai-gateway` (plan `docs/superpowers/plans/2026-11-07-ai-gateway.md`, ADR-0035). Backend only; no school can turn it on before the `ai-evals` baseline is committed and the governance §10 checklist is signed. The baseline comes from this PR: add the `ai-evals` environment's `ANTHROPIC_API_KEY` secret, add the label `ai-evals:write-baseline`, commit the uploaded `baseline.json`, remove the label and push, and the comparison passes. The dashboard panel, streaming and the other AI features are in `deferred-work.md` |
| 5–7 | website-cms, platform-admin, admissions, hr-leave, library, transport, inventory-assets, certificates-documents, reporting-analytics | Not started |

## Per-module implementation matrix

| Module | API | Dashboard screens | E2E | Spec doc |
| ------ | --- | ------------------ | --- | -------- |
| school-organization | done (+ the `/holiday-calendar` calendar §16 declared and nothing had built — `attendance` marks against it) | — (platform-admin/setup UI not built) | live-lane API journeys only (no dashboard UI to drive) — CRUD + tenant isolation for all 9 resources, plus the academic-session `:activate`/`:close`/`:clone` lifecycle | done |
| student-management | done (CRUD, guardians/documents/files, enrollment lifecycle/transfers, import/export/ID cards); **in progress** — `emergency_contacts`/`guardians`/`student_guardians`/`transfers` split into their own resource packages (matching the file-per-action-layout convention already applied to staff-management/timetable/academics/school-organization/communication), but the old flat files (`serializers.py`, `filters.py`, etc.) and `apps.py`/`urls.py` wiring haven't been updated to point at them yet — the new packages exist unused alongside the old ones (Phase 3 added `student_id`/`StudentFilterSet` changes to the real, wired files only, same drift); `transfers/tests/` also has no test file of its own yet, unlike its three sibling packages (the old `student_management/tests/test_enrollment_transfers.py` still covers the still-wired code path) | **Phase 1 shipped** (directory — `DataGrid`, search + status/campus/house filters; create/edit then via `StudentFormDialog` (now superseded, see below), including the address fields; a flat read-only `StudentDetailSheet` — Personal, Academic and Medical sections plus the read-only admission number, with no address section yet; single/bulk withdraw via `WithdrawStudentDialog`, offered only for `active` students) — replaces the "Coming soon" placeholder the `apps/dashboard` shell reset left behind. **Phase 2 shipped** (tabbed `StudentDetailSheet`: Profile, Guardians, Emergency Contacts, Documents, each tab's data fetched only once opened; Guardians tab with search/create/link/promote/edit guardian fields; Emergency Contacts tab with add-only ordered list; Documents tab with upload/verify/reject/delete/download controls). **Phase 3 shipped** (a fifth "History" tab: current-enrollment card + Enroll/Change-Section, the transfers list with Request/Approve/Reject/Complete, and the full timeline, all gated per-action by their own permission key; the directory's `academic_session_id`/`class_id`/`section_id` filters are now live). **Creation stepper shipped, and absorbed edit too** — "Add Student" and the directory/detail-sheet's Edit actions all now open `StudentCreateStepper`, a guided Profile → Guardians → Emergency Contacts → Documents → Enrollment wizard; `StudentFormDialog` (the old single-page create/edit dialog) is deleted. Edit mode opens on an already-real student with every step reachable immediately, landed on whichever tab the detail sheet was showing; Back and each step's own tab reach any already-visited step, Profile included. Reuses Phases 2-3's own tab components unmodified for steps 2-5 — see `docs/03-modules/student-management.md` §20 for the full as-shipped detail of all phases and the stepper. **Phase 4 shipped** — student-management full-stack complete; Tier 1 done. The toolbar gains Export CSV and Import CSV (gated by `students.student.export`/`.import`; import through the shared `BulkImportDialog`, a drawer on mobile, and export through the shared `useJobFileDownload` hook), the directory gains a batch "Generate ID cards" action over the page's selection (`students.id-card.generate`), and `/staff` moved onto the same components; the backend half is the shared `core/imports/` parser (ADR-0023), per-row import validation and formula-safe exports — see `docs/03-modules/student-management.md` §20 | mocked `dashboard`-project coverage — `tests/dashboard/students.spec.ts` for the Phase 1 directory (add/withdraw/permissions), `tests/dashboard/students-relations.spec.ts` for the Phase 2 relations tabs (guardians/emergency contacts/documents), `tests/dashboard/student-enrollment.spec.ts`/`student-transfers.spec.ts` for Phase 3, `tests/dashboard/student-create-stepper.spec.ts` for the creation stepper, and `tests/dashboard/students-bulk.spec.ts` for Phase 4's export/import/ID cards; plus the live-lane admission→enrollment journey (`e2e` row below), which drives the creation stepper against the real API | done |
| staff-management | done (CRUD, designations, qualifications/documents with verification, invite/exit, import/export) | was done (list/detail/create/edit + Qualifications/Documents tabs, import wizard) — **removed** by the `apps/dashboard` shell reset, rebuilt in a later chunk (`docs/metronic-dashboard-shell.md`) | — | done |
| academics | done (curriculum CRUD + `:clone`, teacher allocation + load summary, the promotion batch state machine with segregation of duties and idempotent execution) | built once and removed by the `apps/dashboard` shell reset, rebuilt as three PRs, **all shipped**. **PR A shipped:** the Academics sidebar group, tab bar and `/academics` redirect, and `/academics/curriculum` (session-scoped list with search, filters, sort and paging in the URL; add, edit, remove and clone; read-only for a closed session). **PR B shipped:** `/academics/allocations` (the same session-scoped list for teacher allocations, with a teacher-load panel above it against the norm; allocate, edit, end, reinstate and remove, an over-norm warning toast from `meta.warnings`) and the backend rules it needed (`PATCH` runs the §11 rules `create` runs, `effective_to` writable on `PATCH` only, the new `class_id`, `campus_id`, `current` and `search` filters, a typed `load-summary` with `norm`) — see `docs/03-modules/academics.md` §16 and §20. **PR C shipped:** `/academics/promotions` (every batch in a URL-state list, newest first, with a New batch dialog) and `/academics/promotions/{batchId}` (the review page: status × permission actions each behind a confirm dialog, execute as a polled job with a by-name report, the paged and searchable decision table with its edit dialog, a missing-section advisory) and the backend contract behind it (an override reason when the decision or the target class differs from the proposal recorded at creation, typed responses with name fields and `PromotionStatusEnum`) — see `docs/03-modules/academics.md` §11, §16 and §20 | live-lane API journeys + one promotion browser CUJ; mocked `dashboard`-project coverage in `tests/dashboard/academics-curriculum.spec.ts` (PR A), `tests/dashboard/academics-allocations.spec.ts` (PR B) and `tests/dashboard/academics-promotions.spec.ts` and `academics-promotion-review.spec.ts` (PR C, which drive the same confirm-dialog page-object methods as the nightly promotion journey) | done |
| timetable | done (rooms/periods CRUD with `campus_name` and a `for_campus` period filter, draft slot grid with `meta.conflicts` on every edit, `:validate` / `:publish` with supersede-by-end-dating, `GET /timetables/my` for teacher/student/guardian, substitutions + `:approve`/`:reject`/`:cancel`, a free-teacher `candidates` lookup, named substitution rows, and one open cover per slot per date) | was done, then **removed** by the `apps/dashboard` shell reset; rebuilt as three PRs, **all merged** (#119, #120, #123). **PR A (#119):** the Timetable sidebar group, tab bar and `/timetable` landing, on a `components/module-sections/` kit Academics now shares, plus `/timetable/periods` and `/timetable/rooms` (URL-state lists with add, edit and remove) — see `docs/03-modules/timetable.md` §20. **PR B (#120):** `/timetable/grid`, the section week grid (cell editor, drag-and-drop for drafts, conflict panel, check and publish), on a backend that now names every cell, filters `current` rows, orders by period and locks slot writes in a closed session. **PR C (#123):** `/timetable/substitutions`, the cover queue (propose from free teachers, approve, decline, cancel), and `/timetable/my`, every role's own week with a date's cover; the backend gains `:cancel`, a `candidates` lookup that excludes teachers on leave or marked absent, named substitution rows, and a one-open-cover-per-slot-per-date constraint so declined or cancelled cover can be proposed again | live-lane API journeys + the build-and-publish browser CUJ (repointed at `/timetable/grid` by PR B); mocked `dashboard`-project coverage in `tests/dashboard/timetable-setup.spec.ts`, `timetable-grid.spec.ts` and `timetable-cover.spec.ts` | done |
| fees-finance | **done** (PR A: the per-tenant chart of accounts, the append-only double-entry ledger with its single posting path and reversal-only corrections, and fee heads/structures/installment schedules with a draft→active→archived lifecycle. PR B: bulk invoice generation as a 202 + job with gapless numbering and a duplicate guard that makes a re-run skip rather than double-bill, proration on mid-term enrollment, discounts/scholarships/fines with attributable grants and waivers, cancellation that returns billed fines to the queue, and the nightly due/overdue sweep. PR C: payments whose receipt and ledger posting commit in the same transaction as the money, §7.3's refund workflow with the requester barred from approving, bank/wallet vouchers in A4 and 80mm thermal, and the settlement import with its at-most-once match key and exceptions queue. PR D: expenses under an approval gate that posts to the ledger on approval rather than payment, budgets whose variance is computed from posted entries so a rejected expense stops counting, and §13's eight reports behind one endpoint that serves inline under 1000 rows and hands back a job past it. Follow-up: two campus-scoped budgets on the same account and period now keep their own actual spend, attributed through the `Expense` each posting names — closing a gap the PR D review left open, since `ledger_entries` itself still carries no campus column. **Online payments PR 1** ([ADR-0034](decisions/0034-online-fee-payments.md), plan `docs/superpowers/plans/2026-11-07-fee-online-payments.md`): `core/integrations` (Fernet-encrypted, write-only school credentials with `rotate_integration_credentials`, the provider-agnostic `PaymentAdapter` and a fake provider), `payment_gateway_accounts`, `:initiate-payment` for the available balance, the public signed callback re-fetched from the provider, booked `gateway_reconciliation_issues` with `:resolve`, the 15-minute pending sweep and the nightly `reconcile-gateway-payments`, behind `fees.online-payments`. **PR 2 is blocked** on PayFast/Safepay sandbox keys and the portal stack: the real adapter, the portal Pay button and the staff gateway/issues screens) **AI gateway PR (`feat/ai-gateway`, in review):** `core/ai` (one provider adapter, feature registry, tenant-timezone budgets, grounding, append-only `ai_requests`/`ai_request_feedback`, `GET /ai/usage`, `:feedback`, the `run_ai_evals` harness; ADR-0035) and its first feature, AI-FEE-02, `POST /reports/finance-summary:summarize` (module doc §14, §20 "Built (AI gateway: AI-FEE-02)"); off for every school until the eval baseline is committed and the governance §10 checklist is signed | — (backend-only; the dashboard agent owns screens; online payments' screens are PR 2) | live API journey `api/online-payments.spec.ts` (fake provider: signed callback confirms once, replay is a no-op, another school's slug is 404) | done (module doc §1-§20 + all 22 entities at column level; payroll deferred with hr-leave)
| communication | **done** (the `GET /notifications` inbox, its `:unread-count`, `:mark-read` and `:mark-all-read`, and guardian notice browsing in the `PortalNotice` shape came with parent-portal PR 1; module doc §20 "Built (parent portal)") — PR A (#62): `NotificationTemplateOverride` (tenant per-code/channel/locale wording, validated against the platform template's declared variable set) and `NotificationPreference` (per-user category × channel opt-in; emergency category refused closed). Extends `core/notifications`'s `notify()` to render each channel's own template (previously every channel reused the single in-app-rendered string) and to gate delivery through a batch-shaped preference resolver — both hooks self-registered from this app's `AppConfig.ready()` so `core/` still never imports a Tier-4 app; both also gated on the `module.communication` feature flag, so a tenant that hasn't enabled the module pays a cached flag check instead of a table query on every `notify()` call platform-wide. PR B (#64): `Announcement` (draft/scheduled/published/archived) and `Notice` (draft/pending_approval/published/archived, sequence-numbered at publish via `numbering.py`, optional acknowledgment tracked on the recipient's own `Notification.acknowledged_at` row) — both fan out through the real `notify()`. `services.resolve_audience` turns `(audience_type, audience_filter)` into recipient user ids in one query per branch (`all`/`staff`/`students`/`guardians`/`class`/`section`/`custom`); `class`/`section` resolve to the **guardians** of enrolled students, not the students themselves, matching the module doc's own worked example. `publish_notice` enforces the approver ≠ drafter segregation of duties, mirroring fees_finance's refund-approval gate. PR C (#145): `MessageThread`/`Message` (append-only, `read_by` the one mutable column), guardian/internal/group threads routed to the class teacher or a fallback role, membership-based visibility with audited `thread.oversee` oversight (ADR-0030), and `:preview`/`:emergency` broadcast with count + digest confirmation, a frozen-recipient job on the `emergency` queue and campus-scoped senders (ADR-0029); thread attachments are module-gated off the generic `/files` routes and download through the thread, and `Idempotency-Key` is now bound to the request body platform-wide (a reused key with a different body is `422`) | **threads, oversight and broadcast dashboard done** (PR D: `/communication` Messages inbox with reply, close and reopen, read-only Oversight, and the Emergency broadcast wizard; module doc §20 "Built (PR D)"). No screens yet for announcements, notices (with the publish-approval gate), template overrides, notification preferences or delivery logs (`docs/deferred-work.md`) | mocked `dashboard`-project journeys `tests/dashboard/communication-messages.spec.ts` and `communication-broadcast.spec.ts`; live API journey `api/communication-threads-broadcast.spec.ts` | done (module doc §16/§20, entity doc, ADR-0029/0030)
| attendance | **done** (register `:bulk-mark` with idempotent re-submission, the §5.5 lock window, corrections, guardian alerts, nightly lock sweep; the five leave tables, §7.2's escalating chain, auto-marking `on_leave`; staff attendance with `:check-out`, §13's six reports with a 202 export lane, and the absent-teacher cover feed into timetable) | **Full-stack complete**: all three PRs have merged. **PR A** (#134): `/attendance` with Register (My registers, the pickers, Mark all present, inline row refusals, Request correction on a locked row), Records (cursor-paged, filtered by date, class, section, status, lock) and Settings (mode, lock window, escalation threshold), plus the attendance mode and period-mode rules behind it (ADR-0028) and the `assigned`-scope marking fix. **PR B** (#137): Corrections (a cursor-paged queue with a Status filter and Mine, the change field by field, Approve/Reject with a note, never on one's own request) and Leave (a cursor-paged queue filtered by status, type and dates; a detail sheet with the approval chain and the attachment; Approve/Reject per level), with the contract behind them: the correction queue readable with either correction key, a correction's target resolved through the caller's record scope (out of scope is a 404), `mine`, and name fields on corrections and leave. **PR C** (#141), which completes the dashboard: Staff (`/attendance/staff`: a per-row register with Save, Check out and Request correction on a locked row, and a cursor-paged history; a viewer without the mark key gets their history alone), Reports (`/attendance/reports`: the six reports, inline per kind or a polled job, a defaulters threshold, Export CSV/XLSX/PDF) and the Records toolbar's Import, with the backend behind them: the staff register (`GET /staff-attendance/register`), staff corrections (exactly one target, no remarks, minutes recomputed on approval, campus scope over both targets), report rows typed by `kind`, and `threshold` and the mode carried into the export job | live-lane API journeys for marking (mark → re-submit → read back, rejected row, future date, the register and `my-registers`), leave (submit → approve → auto-mark, self-approval refused, cancel, overlap) and staff/reports (record a day, check out, the staff register's joining-date rule, a staff correction approved by a second identity with its minutes recomputed, run a report, export as a job, a defaulters export at 90% with the inline report's row count); a live browser journey (the class teacher marks today's register and reads it back in Records); mocked dashboard specs for the register (marking, the on-leave refusal, a locked register with a correction, the view-only reader, settings), the approvals (a principal's correction decision and their own request, a 409, a teacher's own corrections, a class teacher's leave at both levels, "Not reached", an attachment download) and staff and reports (HR marks two staff, checks one out and requests a correction on a locked row; a staff member's own history; defaulters at 90%; an export downloaded; an `it_admin` import) | done |
| examinations | **done** (PR A: grading scales with validated bands, exams, per-class subject configuration. PR B: sittings with a date/time clash engine, schedule publish, the idempotent admit-card batch and its PDF job. PR C: the marks grid with its four entry gates, the lock/unlock lifecycle, the sheet import and §6's missing-entries dashboard. PR D: result processing, the approval gate with segregation of duties, publishing, per-student withholding, and versioned report cards with an attendance snapshot. PR E: §13's six reports with a 202 export lane, question banks with §7.2's approval gate, and deterministic paper assembly) | **Built across five stacked PRs, all open: A #147, B #149, C #152, D #154, E #155; full-stack once they merge** (plan `docs/superpowers/plans/2026-11-01-examinations-dashboard.md`). **PR A (#147, open):** the Examinations sidebar group and tab bar; `/exams`, a page-numbered list (session, term, status and type filters) with New exam, Edit (up to `scheduled`) and Delete (a draft only); `/exams/{id}`, the exam's header, status stepper and Subjects tab (per class, with add, edit and remove while the exam is configurable); and `/exams/grading-scales`, scales with Make default and a band editor that checks 0–100 coverage. The backend behind it: page numbers on `/exams` and `/grading-scales`, unpaginated bands, names on exams and exam-subjects, `assigned` scope for exams and exam-subjects, the duplicate subject as a field 422 (see `docs/03-modules/examinations.md` §16 and §20). **PR B (#149, open, stacked on A):** the exam page's Schedule tab (sittings by date, the clash panel, reschedule, cancel, delete, publish schedule held by a hard clash) and Admit cards tab (cursor-paged cards by section and status, Issue admit cards with the server's counts and a polled render job, Download through `:download`, Revoke with a reason); behind it the clash-list read, the typed publish, the admit card's student and section, `:download`, and the sitting scope through `_assigned_teaching`. **PR C (#152, open, stacked on B):** the exam page's Marks tab (per (exam-subject, section) progress with Enter marks, Lock, and a confirmed, audited Unlock; the section's grid at `?tab=marks&subject=&section=`, with Save draft sending the filled rows (and any row it clears) and Submit, once every row is filled, sending them all, `error.meta.rows` refusals marked per cell, read-only with the server's reason when the grid is closed, and the sheet import per exam-subject); behind it the grid read, the `section_id` on bulk entry and the per-row section check on import, per-section progress, the typed progress and lock results, the lock, unlock and progress resolved through the record scope, the import's MIME allowlist enforced, and `exams.marks.view` (see `docs/03-modules/examinations.md` §4, §11, §16 and §20). **PR D (#154, open, stacked on C):** the exam page's Results tab (cursor-paged results by section, outcome and status; a detail sheet with the student's subject marks; Process results as a polled job, the outstanding-marks refusal linking to the Marks tab; Approve held for the latest processor with the reason; Send back with a reason; Publish reporting the server's published and withheld counts; Withhold with a reason) and Report cards tab (cards by section and status, Download through `:download`, Remarks showing only the fields the viewer's keys write, Generate as a polled job, Publish); behind it `results.processed_by`, names on results and report cards, the typed results actions, the per-field remarks keys and the report card's `:download` (see `docs/03-modules/examinations.md` §4 and §16); and the Examinations Reports section (`/exams/reports`, on `exams.result.view`: §13's six reports by kind and exam in the URL, typed per-kind columns inline under 1,000 rows, a polled CSV job above, and CSV/XLSX/PDF export for a holder of `exams.result.export`, on the report job panel, export buttons and grid hoisted from attendance to `components/reports/`). E2E coverage for PR D is in (see the next column). **PR E (#155, open, stacked on D):** the Examinations Question banks section (`/exams/question-banks`, on `exams.question-bank.view`: a page-numbered list by subject and status, each bank's subject and class or "every level", with New, Edit and Remove on the bank keys; an `assigned` teacher sees their subjects' banks) and a bank's page (`/exams/question-banks/{id}`: its questions cursor-paged and filtered by topic, difficulty, type, source and approval; New and Edit with each type's own fields; the "AI-generated" label and, on an unapproved AI draft only, Approve for a holder of `exams.question.approve`, behind a confirm that shows the whole question, its choices, answer key, marks and topic; and Assemble paper, a blueprint of sections whose every shortfall the server names is listed, then a polled job and the PDF's download, which still lands if the dialog is closed mid-job, the dialog saying to save it since papers are not kept); behind it page numbers on `/question-banks`, names on banks and the approver's name on questions, the nested routes through the bank's record scope, an `assigned` creator's bank held to a subject they teach, `source` fixed at create, a mid-job shortfall stored as its plain sentence, and the typed assembly job (see `docs/03-modules/examinations.md` §16 and §20) | live-lane API journeys for setup (`api/exams-setup.spec.ts`: exam staff build, read back by name and delete a draft; the duplicate 422; the default scale and its unpaginated bands; an `assigned` teacher sees an exam only once allocated to it) and for the schedule (`api/exams-schedule.spec.ts`: a clash holds the publish until moved, issue awaits the render job, a card lists with its section and file, `:download` signs a link, a revoke withdraws it and a re-issue does not reinstate it) and for marks (`api/exams-marks.spec.ts`: an allocated `teacher` sees only their section in progress, reads its roll and submits it; the sibling section is a 404 to read and a 422 to write, another scaffold's exam a 404; the exam staff sees entered = expected, locks, and a re-submission is a 409) on a run-unique scaffold (`src/lib/live-exams.ts`); mocked `dashboard`-project coverage in `tests/dashboard/exams-setup.spec.ts`, `exams-schedule.spec.ts` and `exams-marks.spec.ts` (a teacher enters and submits from progress, an out-of-range mark refused on its row, the author's lock turns the grid read-only). For results (PR D): `api/exams-results.spec.ts` (built to `processing` by `buildProcessedExam`: the teacher's marks, the exam staff's lock and process; the principal sends back, the school owner re-processes and its own approval is a 422, publishing before approval a 409, the principal approves and publishes, the exam staff generates report cards that each get a file and a `:download` link; and the 409 `marks_outstanding`), the live browser journey `exams-results-journey.spec.ts` (the principal approves and publishes from the Results tab, one login), and mocked `exams-results.spec.ts` (process, the outstanding-marks link, withhold, approve and publish, Approve held for the processor and withheld kept through a re-process, the 422 and 409 a forced approval or early publish gets) and `exams-report-cards.spec.ts` (report-card generation and download, the result register). A student's view of published results stays in the Django suite. For question banks (PR E): `api/exams-question-banks.spec.ts` (the exam staff creates a bank for every level and its questions, an AI draft saved unapproved; a two-section paper's job awaited and its file's link signed; an over-asking blueprint a 422 naming every short section, the draft not counted) and mocked `exams-question-banks.spec.ts` (an `assigned` teacher sees only their subjects' banks and approves an AI draft, the one question Approve shows on; the exam staff, without the approve key, sees none, creates a bank, is shown every shortfall and downloads a paper) | done |
| parent-portal | **in review** (PR 1: `GET /parent-portal/dashboard`, per-child attendance, fees and latest-result cards plus unread counts and server-computed `modules`, each card from its owning module's own visibility function; no tables; module doc §20) | **in review** (PR 2: the `(portal)` route group under `/portal`: home, a child's attendance, fees with receipt download, results and timetable, messages, notices, the inbox and notification settings; module doc §20 "Built (dashboard, PR 2)", ADR-0032; PR C: admit-card download on Results) | mocked `dashboard`-project journeys `tests/dashboard/portal-home.spec.ts`, `portal-child-pages.spec.ts` and `portal-communication.spec.ts`; `portal-leave-vouchers.spec.ts` (PR B); admit-card download and empty state in `portal-child-pages.spec.ts` (PR C); live API journeys `api/parent-portal.spec.ts` and `api/portal-leave.spec.ts` (PR B) on `seed_e2e_data`'s portal fixtures (summary matches the seed, an unlinked child is `404`, a staff reply in the inbox, a notice acknowledged, the other tenant sees nothing) | done (module doc §16/§20, ADR-0032) |
| everything else (11 modules) | — | — | — | done (spec exists; nothing implemented) |

---

## Done

The monorepo skeleton is in place and structurally complete.

| Area | State |
| ---- | ----- |
| Workspace root | pnpm workspace, Turborepo (`dev/build/lint/test/test:coverage/typecheck/clean`), `tsconfig.base.json` (strict + `noUncheckedIndexedAccess`), `.npmrc`, `.nvmrc` (Node 24), `.env.example`, `.gitignore`, committed `pnpm-lock.yaml` |
| CI | `.github/workflows/frontend.yml` — install → API-schema-freshness check → lint → typecheck → test, then an isolated `Test (coverage)` job enforcing an **85% global `coverageThreshold`** per app (`pnpm test:coverage`, see [`07-quality/testing-strategy.md`](07-quality/testing-strategy.md) §9.6 — the floor is a ratchet, never decreases), a build matrix over `dashboard`/`website`, a Playwright E2E job, and a gitleaks secret scan. `.github/workflows/api.yml` — ruff (incl. `RUF100`/`BLE`/`TID251` with CI-generated noqa baselines), mypy, tests on real PostgreSQL 18 with coverage plus per-package floors (tenancy 90, fees_finance 85, rbac 80 — ratchets), OpenAPI staleness gate, `manage.py check --deploy`. Architectural contract tests cover RLS, append-only grants, endpoint and inline permission keys, cross-app import boundaries (ADR-0013) and `.env.example` drift. `.github/workflows/repo-hygiene.yml` runs on every PR regardless of path (workflow-YAML validation, markdown-link check, cspell, Prettier, the doc-sync gate below, the plan-review gate tests and review-record check from ADR-0015, the commit-message check from ADR-0016, the `__tests__/` placement check, and the lint-baseline shrink check). Every frontend workspace lints with `--max-warnings 0` against a shrink-only `eslint-suppressions.json` baseline (ADR-0014); `generate-baselines.yml` produces baselines in CI |
| `apps/api` | Django 6.1 + DRF 3.18, managed by `uv`. `core/tenancy` (Tenant/TenantSettings, RLS via `SET LOCAL` + `rls_operations`), `core/rbac` (User/Role/Permission, code-defined permission registry seeded via `post_migrate`), `core/audit` (append-only audit log), `core/api` (envelope renderer, pagination, exception handling, base viewsets). One Django app: `apps/school_organization` (campuses, departments, academic sessions, terms, classes, sections, subjects, houses) — the reference module every later app copies |
| `packages/types` | API envelope `{data, meta}` / `{error:{code,message,details,request_id}}`, cursor + offset pagination, discriminated by `isCursorPagination()`/`isOffsetPagination()`. Fifteen bounded admin lists page by NUMBER (`PageNumberPagination` — students, staff, designations, campuses, departments, classes, sections, subjects, houses, rooms, periods, substitutions, class-subjects, allocations, promotions; the set is named in `api-architecture.md` §2.4), so their `total_count` is always present. Append-heavy lists keep cursors, where `total_count` stays opt-in and is omitted rather than nulled, job resource, auth/RBAC types (`PermissionKey = module.resource.action`), tenant + branding, website CMS content types |
| `packages/api-client` | Hand-written transport core: envelope unwrapping, bearer auth, single-flight refresh-on-401 + replay, `ApiError` normalization, cursor pagination helpers. The resource layer (`schema.d.ts`) is REGENERATED from `apps/api/openapi.yaml` and CI fails if it's stale |
| `packages/ui` | Every primitive except `Sidebar` (button, card, data-table, tabs, sheet, label, tooltip, alert, avatar, dialog, badge, table, separator, dropdown-menu, select, textarea, input, skeleton, form, and `chart` over Recharts, plus accordion/breadcrumb/calendar/collapsible/hover-card/kbd/progress/radio-group/scroll-area/switch/toggle) is now **Metronic's own admin-template component**, ported verbatim rather than adapted — not a from-scratch shadcn port. A handful of props Metronic's components have no equivalent for are restored as additive, opt-in props alongside Metronic's own API: `Button.isLoading`/`loadingLabel`/`block`, `Dialog`/`Sheet.closeLabel`, `Popover.label`, `Checkbox.label`, `Form`'s required-field asterisk, `Table.frame`, and `Card`'s `elevation` (flat/raised/floating)/`tone` (surface/spotlight). `chart.tsx` needed a type-only patch too: Metronic's file assumes recharts@2's Tooltip/Legend prop shapes and this repo runs recharts@3, so the payload typing is hand-rolled rather than imported from Recharts. Badge's tinted appearance is now named `light` (was `soft`). Metronic's own `layouts/`, `partials/`, `image-input/` and `keenicons/` reference directories — vendored alongside the primitives, excluded from typecheck/lint/spellcheck, never wired into anything — were deleted once confirmed unused by either app (the dashboard shell's own port of the relevant pieces, `apps/dashboard/src/app/(app)/shell/`, renamed from `_metronic/`, no longer needed the source alongside it). `Sidebar`/`Header`/`Shell` themselves stay in `apps/dashboard` (they call this app's real session/permissions/preferences directly, so a package shared with the session-less `apps/website` can't hold them) and use Metronic's own `useSettings`/`document.body`-class collapse state verbatim, not a schoolhub-authored state machine — there is no `SidebarCollapseToggle`. Genuinely reusable, zero-app-coupling pieces the shell needed were promoted here instead: `useMenu` (+ generic `MenuItem`/`MenuConfig` types), `useScrollPosition`, `AvatarGroup`, `Rating`, `toAbsoluteUrl`, `DropdownMenu4`, and `useIsMobile` (already existed here, unexported — `apps/dashboard` had silently duplicated it). A port-and-adapted `AccordionMenu` primitive (Radix Accordion-based nested menu, adapted from Metronic's `accordion-menu.tsx` with two ARIA/navigation fixes) is what `apps/dashboard`'s nav rendering is built on; the shell's mega-menu (duplicated the sidebar's real nav with more of Metronic's demo content) was removed rather than promoted. The dashboard shell built on top of these — header, sidebar chrome, nav content — is tracked separately in `docs/metronic-dashboard-shell.md`, not here. `ChartConfig.color` is still TYPED to `var(--sh-color-chart-N)` so a literal colour is a compile error rather than a review note. `empty-state`, `stat-card` (with an `unavailable` state, so a metric whose module does not exist yet says so rather than rendering an error), and shape-matched `skeletons` (screen header / table / grid / chart / detail / form) are schoolhub's own, unaffected by the swap. `DataTable` is a table LAYER rather than a table: it draws one card holding a `toolbar` slot (the screen's filter row plus a show/hide-columns menu), the table itself, the empty state and a footer carrying rows-per-page, the `{from}–{to} of {count}` summary and a numbered pager. Columns declare `sortKey` (server-side ordering only — a header sorts exactly when the endpoint allows it), `numeric` (`measure` end-aligned, `identifier` start-aligned, both in the figures face), `alwaysVisible`, and a per-column `skeleton`. `Checkbox` (indeterminate state), `Pagination` + `getPageNumbers`, `CursorPagination` (Previous / Next alone, for a cursor list with no page count, sharing `Pagination`'s arrows), `DataTableColumnsMenu`, `BadgeDot`. `--sh-*` Tailwind v4 token layer; default platform brand is **Aurora** (vivid indigo + cyan, with a `chrome` tier for the sidebar/header that is never tenant-overridable but is aliased 1:1 to the page's own background/foreground/muted/border/primary tokens — a flat, same-surface-as-the-page frame separated only by a border, matching Metronic's own admin-template look, confirmed against Metronic's real unmodified Demo1 source before that reference copy was deleted as unused (see above); an earlier recessed/ink-frame chrome design was deliberately retired in favour of that match). Only two named presets live under `presets/` now — **tenant** (branding withheld, whatever `theme.css`'s `:root` carries) and **metronic**, the admin template's own default palette (`config.reui.css`'s zinc/blue/red scale), reproduced as shipped rather than redesigned, including one real AA gap on primary-foreground/primary that is documented rather than corrected. The other seven (ink-brass, azure, cobalt, tangerine, soft-pop, brutalist, neon) were deliberately trimmed to keep the product on a single Metronic look while that's the only palette actively being worked on — nothing about them was wrong, and they're recoverable verbatim from git history (`presets.ts`'s own header has the exact re-add steps) whenever multi-theme support returns. Metronic's own `css/` directory is vendored as that preset's untouched reference source. `DESIGN.md` at the repo root is the written source of truth for the platform default. The token layer carries three surface planes (`surface-sunken`/`surface`/`surface-raised`), three brand-tinted elevation steps, an `info` hue, one named gradient (`bg-spotlight`), and a validated six-slot chart ramp — and the `dark` variant answers to both a `.dark` class (the dashboard's toggle) and `prefers-color-scheme` (the website, which has no toggle) |
| `packages/config` | Shared ESLint flat config (ESLint 9, typescript-eslint) |
| `apps/dashboard` | Auth-guard proxy, tenant-subdomain login (own subdomain namespace, auth cookies via a same-origin proxy), in-memory access token + refresh, TanStack Query client + key factory, `hasPermission`/`<Can>` helpers, `(auth)/login` (RHF + Zod), `/api/health`, next-intl (`en` + `ur`, RTL), a light/dark/match-system toggle (`next-themes`, `attribute="class"`) whose resolved theme the toaster follows, layout preferences (sidebar variant/collapse/state, content width, navbar style, colour preset) persisted via cookie, and `motion` behind `LazyMotion`+`m`. Every business route (students, staff, academics, timetable, admissions...) and the previous `(app)` shell/nav plus the shared `ScreenHeader`/`ApiErrorAlert`/`FilterBar`/`PersonCell`/`useTableParams` list-screen convention were reset to rebuild the shell clean against Metronic's Demo1 template — see `docs/metronic-dashboard-shell.md` for that rebuild's status and backlog. Currently in place: a minimal `(app)` shell — now `apps/dashboard/src/app/(app)/shell/` (renamed from `_metronic/`: this is the app's own composition root, not vendored reference code), with the mega-menu removed (it duplicated the sidebar's real nav with more of Metronic's demo content) and the zero-app-coupling pieces it needed (`useMenu`, `useScrollPosition`, `useIsMobile`, etc.) promoted to `packages/ui` — Metronic-shaped header + sidebar, breadcrumb, ⌘K command palette, permission-unfiltered nav, no session/tenant wiring yet, and one bare placeholder `/dashboard` route so the shell has somewhere to render; tenant theming, session/permission-filtered nav, and every business route are rebuilt in later chunks. Reusable pieces the academics curriculum screen added: a sidebar item may carry a `permission` key as well as a `module` (`MenuItem.permission`, applied at every level by `filterMenuByAccess` in `shell/menu-access.ts`, dropping a parent whose children all drop); `useAcademicSession` (`features/academics/`) resolves a session-scoped screen's session from its `session` URL value; and `usePageClamp` (`src/hooks/`) is the stale-page guard every server-paginated `DataGrid` list shares, `/students` and `/staff` included. The allocations screen hoisted the rest of what a list screen and its dialogs share, used by it and by the curriculum screen: `LoadErrorCard`, `SearchInput`, `FilterSelect` and `FormSelectField` (`src/components/`), the `use-reference-data` hooks, and `FormDialogLayout` with `useFormDialogSubmit` and `useConfirmAction` for the dialogs; the places that still inline the older versions are in `docs/deferred-work.md` **`(portal)` route group** (parent-portal PR 2): the guardian and student portal under `/portal`, with its own shell (`features/portal/shell/`, no sidebar); `AudienceGate` sends each audience to its own shell once `/auth/me` resolves |
| `apps/website` | Host→tenant proxy, cached tenant resolution, read-only content layer, ISR rendering of `website_pages`/`page_sections`, theme registry + 12 section components, per-tenant sitemap/robots, HMAC-signed revalidate webhook. `lib/host.ts` is the single canonical source for reserved-subdomain labels — `lib/env.ts` re-exports the same Set rather than keeping its own separately-maintained copy |
| `e2e` | Playwright suite with `dashboard` and `website` projects run in the PR gate against mocked routes. `live` (the real backend in compose, brought up and seeded by `infra/scripts/seed-dev.sh --backend-only`, with the apps served by Playwright's `webServer` under `E2E_REAL_API=1`) is opt-in via `.github/workflows/e2e-live.yml` (`workflow_dispatch` + nightly, not the PR gate) — real-browser journeys for login/logout/session/dashboard-summary/tenant-resolution, plus API-only journeys for every `school_organization` resource (no dashboard UI exists for that module yet). `AuthEndpointThrottle` allows only 10 requests/minute, and refresh tokens rotate, so a shared browser session can safely serve at most one cold-navigation test — every live browser spec logs in for itself instead (`e2e/AGENTS.md` has the confirmed reasoning); the `live-setup` project stays wired up for a future spec that's actually safe to share, but nothing uses it today. Live API specs (`tests/live/api/`) share one real login per worker via a worker-scoped fixture instead, which has no rotation problem. `student-management`'s first two Critical User Journeys were built with real coverage: `api/students-record-scope.spec.ts` (a seeded `student`-role identity, `RecordScope.OWN`, proves it sees only its own `Student` row and gets 404 — never 403 — on another's) still passes. `students-admission-enrollment.spec.ts` drives the creation stepper (the dashboard has no `/students/new`/`/students/{id}` routes; create is a dialog and the record a sheet opened from its directory row), and `api/attendance-leave.spec.ts` submits as a seeded `guardian` linked to each test's own students; `api/communication-threads-broadcast.spec.ts` runs a guardian's thread to an `assigned`-scope class teacher and back, oversight, and an emergency broadcast through preview, a refused digest and its job; `api/parent-portal.spec.ts` reads the portal summary, inbox, notices and a child's week as the seeded comms guardian, on fixtures `seed_e2e_data` builds through `apps/parent_portal/management/commands/seed_e2e_portal.py` (attendance, an issued invoice, a result taken through marks entry, lock, processing, approval and publication, and a notice) |
| `infra` | Local dev stack (Docker: Postgres/Redis/MinIO/PgBouncer/Mailpit). MinIO runs pgsty's community build pinned by digest, since upstream withdrew its public images ([ADR-0025](decisions/0025-minio-images-from-the-pgsty-community-build.md)). The compose `dashboard` and `website` services run `next dev` from a `dev` image stage, and every image takes `NODE_IMAGE` (`node:24-slim`). The `e2e-live` lane, which had failed all 50 recorded runs, is rebuilt to bring the backend up through `seed-dev.sh --backend-only` and serve the apps through Playwright; its first run past setup is pending ([ADR-0026](decisions/0026-live-lane-backend-in-compose-apps-on-the-runner.md)); `infra-compose` builds every service image |

Both apps (`dashboard`, `website`) were generated with `create-next-app` (Next 16,
Turbopack, Tailwind 4, `src/`, `@/*`) and then customized. The Next-managed block at
the top of each app's `AGENTS.md` is regenerated by `next dev` — removing it from a
diff only re-creates the uncommitted change, so commit it with your work instead.

### Doc-sync gate

`repo-hygiene.yml`'s `project-status-sync` job enforces this file's own rule: any
PR that touches `apps/**`, `packages/**`, `e2e/**`, or `infra/**` must also touch this file
or [`deferred-work.md`](deferred-work.md), or the check fails. Add `[skip-status-doc]` to the PR title for a change that
genuinely doesn't shift the status below (a dependency patch bump, a typo fix).

---

## Repository settings

- Merge, squash and rebase merges are all **allowed** by GitHub's settings; PRs land as merge
  commits by convention ([ADR-0006](decisions/0006-merge-commits.md)). Head branches are **not**
  auto-deleted on merge.
- **Classic branch protection is active on `main`** (verified with
  `gh api repos/{owner}/{repo}/branches/main/protection`): a pull request is required
  (0 approvals), six checks are required and strict — the original `repo-hygiene` jobs (Prettier,
  Markdown links, Secret scan, cspell, Workflow YAML, project-status sync; the plan-review and
  commit-message jobs added later are not yet required) — admins are included, and
  force-push and deletion are blocked. Linear history is **off**, so merge commits land
  ([ADR-0006](decisions/0006-merge-commits.md)). The `api` and `frontend` jobs are **not**
  required checks (they are path-filtered, so requiring them would block PRs that never trigger
  them) — "green before merge" for backend and frontend is still discipline.
- [`.github/rulesets/main.json`](../.github/rulesets/main.json) is **not applied** (no rulesets
  exist). It now matches ADR-0006 (merge commits only, no linear-history rule) and requires the
  always-running `repo-hygiene` checks, so applying it would add, not remove, protection.

## Deliberately NOT done

Moved to [`deferred-work.md`](deferred-work.md) — every deferred item, cut scope and known gap,
with its reasoning. Read the entry for the area you are about to touch before re-deciding it.

---

## Start here next session

0. **Make the new checks blocking** (owner, once the engineering-standards stack #82–#86 has
   merged): add `Plan-review gate tests`, `Specs and plans carry an independent review` and
   `Commit messages follow the convention` to `main`'s required status checks —
   `gh api -X POST repos/{owner}/{repo}/branches/main/protection/required_status_checks/contexts -f 'contexts[]=Plan-review gate tests' -f 'contexts[]=Specs and plans carry an independent review' -f 'contexts[]=Commit messages follow the convention'`.
   Until then they report but don't block (ADR-0015, ADR-0016).
1. **CI is the source of truth for coverage** — the 85% `Test (coverage)` floor is a
   ratchet (never decreases), so a new PR without its own tests fails this check —
   expected, not a gate bug. Check the latest `frontend.yml` run for the current
   per-app percentages rather than trusting a number written here, since it drifts
   with every PR.
2. **Leave the two-TypeScript setup alone.** `typescript` is aliased to the TS 6 API for
   tooling and `@typescript/native` supplies TS 7's `tsc`. Collapse to one
   TypeScript only after typescript-eslint supports the 7.1 API (#10940).
3. **Do not bump ESLint to 10.** `eslint-plugin-react` (bundled in `eslint-config-next`)
   still calls `context.getFilename()`, which ESLint 10 removes.
4. **Decide the typed-routes question.** App code uses explicit prop types rather than Next 16's
   generated `PageProps`/`LayoutProps` globals. If the team prefers the generated
   globals, add `next typegen` to the `typecheck` script.
5. **`student-management` full-stack is complete**, landed as 4 sequenced,
   stacked PRs: PR 1 foundation + student CRUD, PR 2 guardians/documents/
   files, PR 3 enrollment lifecycle/transfers, PR 4 import/export + ID
   cards. Along the way it built genuinely reusable platform infrastructure
   every later module inherits: `core.tenancy.features` (feature flags),
   `core.tenancy.sequences` (gapless per-tenant counters),
   `core.tenancy.tasks.TenantAwareTask` (tenant-bound Celery base class),
   `core.files` (two-step upload + server-generated `create_ready_file()`),
   `core.idempotency` (`Idempotency-Key` replay), and `core.jobs`
   (`BackgroundJob` + `GET /jobs/{id}`).
6. **`staff-management` full-stack is complete** (one PR, not stacked —
   the module is small enough that the students-style multi-PR split wasn't
   needed), reusing every piece of infrastructure from item 5 as-is:
   `core.tenancy.features` (`module.staff` flag), `core.tenancy.sequences.
   allocate_number` (`employee_number`), `core.jobs`/`core.tenancy.tasks.
   TenantAwareTask`/`core.files.create_ready_file()` (import/export jobs).
   **Phase 2 Tier 1 ("People") is now done.** A follow-up UI-only PR
   (`feat/staff-ui-polish`) added a row-click staff detail sheet on
   `/staff` (reusing the edit form's `fetchStaffById` query), replaced the
   directory table's ⋮ actions menu with direct Edit/Delete icon buttons,
   fixed the sidebar's selected-nav-item contrast, and added `Button`'s
   `appearance="light"` variant plus `Badge`'s `rose` variant (for a
   "resigned" employment status) to `packages/ui` — no backend changes.

   A separate follow-up backend fix switched `build_staff_export_csv`/
   `build_student_export_csv` from `list(Queryset...)` to `.iterator()`,
   raised by a question about what a full-tenant export does at a very
   large row count. The DB read now streams from the cursor instead of
   materializing every row (and every related Campus) as Django objects
   in memory at once — a real reduction, but only on the read side: the
   CSV itself is still assembled as one in-memory `str`/`bytes` before
   upload, so peak memory still grows with the export's total size, just
   by roughly an order of magnitude less than before. True end-to-end
   streaming would need `core.files`' upload path to accept a file
   object instead of a full `bytes` payload — tracked in
   `docs/deferred-work.md`.

   A further follow-up made `/staff` mobile-responsive: fixed a shell-wide
   layout bug where the desktop sidebar rendered unfixed (in normal document
   flow) between 768–1023px because the JS breakpoint deciding whether to
   mount it (768px) didn't match the CSS breakpoint that docks it
   (1024px) — see `use-is-desktop-shell.ts`; fixed the staff directory
   table overflowing instead of scrolling (a missing `min-w-0` on
   `CardTable`, a shared `packages/ui` primitive); and ported a `Drawer`
   primitive (shadcn/vaul, via Metronic's own vendor copy) so the Add
   Member, Exit, and Staff Detail panels render as a bottom sheet on mobile
   instead of a centered dialog/side panel. The Staff Detail panel's footer
   also goes icon-only on the mobile drawer. Import CSV isn't included — see the
   next entry, `feat/staff-bulk-export-import`, which wires it up.

   A second follow-up UI-only PR (`feat/staff-bulk-export-import`) wired
   `/staff`'s "Export CSV" and "Import CSV" toolbar buttons to the real
   `POST /staff-exports`/`POST /staff-imports` background jobs (job-polling
   via a new shared `useJobPolling` hook, a new `Services.staff` module, and
   a new per-action `hasPermission` gate; no backend changes — all three
   endpoints already existed). Closing the import dialog mid-job ("Run in
   background") keeps the job in a per-user `sessionStorage` entry, so
   reopening it — even after navigating away or reloading — reconnects to
   the running import; a timed-out or poll-failed export resumes watching
   the same job rather than starting a second one. Since students Phase 4 that
   dialog is the shared `BulkImportDialog` (`src/components/`) and the export
   flow is the shared `useJobFileDownload` hook, with `/staff` and `/students`
   both on them.

   A third follow-up (`refactor/staff-service-split`) finished moving staff off
   `Services.dashboard`: `fetchStaffPage`/`createStaff`/`updateStaff`/`exitStaff`/
   `fetchStaffById`/`fetchStaffDirectory`/`fetchStaffTypeCount` and their types moved
   out of `dashboard-service.ts` into `services/modules/staff/`, split per the
   then-current [ADR-0018](decisions/0018-per-module-file-split-for-growing-domains.md)
   into `staff-type.ts`/`staff-constant.ts`/`staff-helper.ts`/`staff.schema.ts`/
   `staff-service.ts`; the screens themselves moved from `src/app/(app)/staff/` into
   `src/features/staff/`, matching `students`' layout. Reference-data reads shared
   with other modules (`fetchCampuses`/`fetchDepartments`/`fetchDesignations`) stay on
   `Services.dashboard`. Staff's wire types are still hand-written, not generated
   `ApiSchemas`-derived aliases — a pre-existing ADR-0017 gap, logged in
   `deferred-work.md`, not fixed by this PR.

   A fourth follow-up (`refactor/auth-service-split`) applied the same five-file
   shape to `auth`: `auth-type.ts` (re-exports `AuthenticatedUser`/`LoginCredentials`/
   `LoginResponse` from `@schoolhub/types`, which stays their real source — they're
   consumed outside the auth domain, by `lib/permissions.ts` and tests across
   `students`/`staff`), `auth.schema.ts` (`loginSchema`/`LoginValues`, moved out of
   `login-form.tsx`), and empty-but-present `auth-constant.ts`/`auth-helper.ts`
   (nothing has accumulated in either yet). Recorded as
   [ADR-0019](decisions/0019-every-module-uses-the-five-file-shape.md), which
   supersedes ADR-0018: every service module now gets the full five-file shape from
   creation, not once a concern earns one. `tenant`/`files`/`jobs`/
   `school-organization`/`dashboard` still have only the original three files as of
   this PR — bringing each up to five is follow-up work, not done here.
7. **PR 0 (platform hardening) is done** — three fixes and two new pieces of
   platform infrastructure, all listed above: the upload-purpose registry, the
   guardian record scope, the api-client refresh split, the Celery beat
   schedule, and `core.notifications`. Every Tier 2 module consumes at least
   two of them.
8. **`attendance` is in flight, as three stacked PRs, and PR 1 has landed.**
   The build order `academics → timetable → attendance` held and was
   load-bearing: `timetable` needed `academics`' `teacher_subject_allocations`,
   and attendance's period mode is expressible only because `timetable.Period`
   already exists. Attendance did *not* fit PR #30's single-PR shape — it owns
   eight tables including the whole leave system — so it is split:
   **PR 1 (landed): marking.** The register, the lock window, corrections, the
   guardian alerts, and the school calendar in `school-organization` that §11
   needs and nothing had built.
   **PR 2 (landed): the leave system.** §15's five leave tables, `/leave-requests`
   and its three colon-actions, a read-only `/leave-types`, §7.2's escalating
   chain, and approved leave auto-marking `on_leave`. Both dangling
   `leave_request_id` columns became real FKs. `/leave-types` writes,
   `/leave-policies` and `/leave-balances` did **not** ship — see the gap recorded in
   [`deferred-work.md`](deferred-work.md).
   **PR 3 (landed): staff attendance and reports.** `staff_attendance` +
   `:check-out`, the `attendance_corrections.staff_attendance_id` column and its
   widened CHECK, §13's six reports behind one `kind`-parameterised endpoint with
   a 202 export lane, and the absent-teacher cover feed into `timetable`.
9. **The table layer is done; three things are deliberately left for a later pass.**
   Every list screen is `DataGrid` (the `useTableParams` + `DataTable` convention this
   item originally shipped against was retired along with the pre-shell-reset screens
   that used it — `/staff` and `/students`' Phase 1 directory are both `DataGrid`-backed
   now), every column backed by a real field is sortable, and the endpoints were widened
   to match — including
   `StableOrderingFilter`, which appends a unique tiebreaker so a cursor page
   boundary can no longer land mid-tie and silently skip or repeat rows. Both
   directories keep their search, filters, sort, page, page size and hidden columns in
   the URL again, through `useDataGridUrlState` (`apps/dashboard/src/hooks/`,
   [ADR-0024](decisions/0024-list-state-in-the-url.md)), so a reload keeps the view and
   a link shares it. Not done, and each its own piece of work:
   - **Row actions.** No table has a trailing `…` menu; rows navigate on click.
     The reference kits put edit/delete/duplicate there, which needs a per-screen
     action inventory and a permission key each.
   - **Responsive default column visibility.** Hidden columns live in the URL (the
     `hidden` key), so a breakpoint-driven default has to decide what beats what — a
     reader's explicit choice must survive a resize.
   - **`const EMPTY = "—"` is declared in eleven files.** It belongs in
     `lib/format.ts`; the sweep touches eleven screens and was not worth folding
     into this work.
10. **Two entity-ownership conflicts to settle before the modules that hit them.**
   Both module docs claim the same tables, and only one app can ship the
   migration:
   - ~~`attendance` §15 and `hr-leave` §15 both claim `leave_types`,
     `leave_policies`, `leave_balances`, `leave_requests`, `leave_approvals`.~~
     **Settled and recorded** in both `03-modules/attendance.md` §15 and
     `03-modules/hr-leave.md` §15 when attendance PR 2 shipped those tables:
     attendance owns them, hr-leave adds none.
   - ~~`communication` §15 and `core/notifications` both cover `notifications`
     and `delivery_logs`.~~ **Settled and recorded** — `entities/communication.md`'s
     `notifications` section states the split explicitly: those two tables, the
     adapters, the platform default templates and `notify()` are `core/notifications/`'s;
     `communication` owns `notification_templates` (tenant overrides),
     `notification_preferences`, announcements/notices/threads and the delivery
     dashboard. `communication` PR A (in flight, item 11 below) is the first PR to
     actually build against that split.
11. **`communication` (Tier 4): backend complete except `GET /notifications` (the in-app inbox, deferred); threads, oversight and broadcast dashboard done. PR A (#62) and PR B (#64) are merged; PR C (#145) adds threads, oversight and the emergency broadcast; PR D adds those three dashboard screens. The other staff screens (announcements, notices, template overrides, notification preferences, delivery logs) are deferred.**
   Plan: `docs/superpowers/plans/2026-09-08-communication-module.md`. PR A extended
   `core/notifications` — which already owns `notifications`/`delivery_logs`,
   `notify()` and the platform-default template registry (item 10's second bullet)
   — with two hooks `communication` registers at `AppConfig.ready()`:
   `core.notifications.templates.set_override_resolver()` (tenant-editable,
   per-channel rendering; previously every channel reused the single
   in-app-rendered string, which is why `DeliveryLog` gained its own `subject`/
   `body` columns) and `core.notifications.services.set_preference_resolver()`
   (per-user channel opt-out, with the mandatory in-app channel and every
   `emergency`-category trigger exempt by construction, and **batch-shaped** —
   `(user_ids, category, channel, tenant_id) -> {user_id: bool}`, one resolver
   call per gated channel per `notify()` call rather than one per recipient,
   after a review caught the per-item version reintroducing the exact
   per-recipient round trip `resolve_addresses` already avoids for email).
   Both hooks are also gated on the `module.communication` feature flag now,
   so a tenant that hasn't enabled the module pays a cached flag check instead
   of a table query on every `notify()` call platform-wide, regardless of which
   module fired the trigger. With neither hook registered — the state before
   this module shipped, and every test that doesn't explicitly register one —
   behaviour is byte-identical to before; regression-tested against the three
   existing `notify()` callers (attendance, fees_finance, examinations).
   `NotificationTemplateOverride`/`NotificationPreference` (PR A) and
   `Announcement`/`Notice` (PR B) models, services, endpoints and RLS policies
   are in. PR B's `services.resolve_audience` turns `(audience_type,
   audience_filter)` into recipient user ids, one query per branch
   (`all`/`staff`/`students`/`guardians`/`class`/`section`/`custom`) —
   `class`/`section` resolve to the **guardians** of enrolled students, not the
   students themselves, matching the module doc's own worked example ("targets
   classes 6-10 guardians"). `publish_notice` enforces the approver ≠ drafter
   segregation of duties (auth-and-rbac §2.4), mirroring fees_finance's
   refund-approval gate, and allocates a gapless `notice_no` through
   `numbering.py` (copies fees_finance/numbering.py's blank-the-`{seq}`-token
   pattern). PR C added message threads (membership-based visibility, read receipts, class-teacher routing with a configurable fallback role), audited oversight (ADR-0030) and the emergency broadcast with a count + digest confirmed send (ADR-0029); see `docs/03-modules/communication.md` §20. PR D built the dashboard for them: the Messages inbox, oversight and the emergency broadcast (§20, "Built (PR D)").
   Scope decisions recorded in the plan's Context section: locale variants
   deferred (no `User.locale` field yet — only `en` templates are created),
   SMS/push/WhatsApp providers deferred (no `core/integrations`, same
   reasoning as fees-finance's payment gateway), `GET /announcements`/
   `GET /notices` staff-only (guardians are meant to consume through
   `GET /notifications`; both the inbox and guardian notice browsing have since come with
   parent-portal PR 1), notice acknowledgment-progress reporting deferred
   (tracked per-recipient on `Notification.acknowledged_at`, but no aggregate
   endpoint yet).
   **RBAC: per-role record scope** (plan `docs/superpowers/plans/2026-11-02-per-role-record-scope.md`,
   [ADR-0031](decisions/0031-record-scope-per-role-assignment.md)). Scope reads used to take the
   union of every role's record scope, so a campus-scoped role plus any `all`-scoped role read
   tenant-wide. **PR A** (#148, `fix/per-role-record-scope`, stacked on #145) is open: every
   scope check reads only the roles that grant its key (`scope_grants`, `scopes_for`,
   `scope_queryset(permission=)`), a write that resolves a target needs both the target's view
   scope and the action's (the viewset mixin applies it to every PATCH, DELETE and colon action),
   ID-card generation reads its ids under its own key, a row privilege asks `holds_key_for`, and export jobs carry their key
   as `scope_permission`. **PR B** (#150, `fix/record-scope-type-union`, stacked on PR A) is built: one
   key held at several scope types reads the union of what each type reaches (ADR-0031 decision
   7), which closed attendance's two mixed-scope entries in [`deferred-work.md`](deferred-work.md);
   a single-type user's SQL is unchanged. It also holds promotion batch actions and batch
   creation to record scope: every student a batch covers must be in the actor's scope for the
   action's key (a 404 when the batch is unreadable, a 422 when it is only partly in scope),
   and marks bulk entry to `exams.marks.create`'s scope over each student.
   The follow-ups PR A left are that file's first entry.
12. **`student-management`'s dashboard Phases 1-4 have shipped.** Phase 1
   (`docs/superpowers/plans/2026-09-30-students-dashboard-phase-1.md`): `/students`
   replaces the "Coming soon" placeholder with a directory, create/edit, profile
   detail, and withdraw, following ADR-0017's generated-wire-types decision rather
   than a hand-maintained `packages/types` duplicate. Phase 2
   (`docs/superpowers/plans/2026-10-03-students-phase2-relations.md`): guardians,
   emergency contacts, documents tabs. Phase 3
   (`docs/superpowers/plans/2026-10-07-students-phase3-enrollment.md`): enrollment,
   class/section allocation, and transfers. Phase 4
   (`docs/superpowers/plans/2026-10-10-students-phase4-bulk-operations.md`): export,
   import and batch ID cards, on a shared import parser and shared dashboard
   components — see `docs/03-modules/student-management.md` §20 for the full
   as-shipped detail of all four. That finishes the original Roadmap and Tier 1.
   **The `academics` dashboard was rebuilt as three PRs, and is complete.** PR A shipped the
   curriculum screen and the Academics shell it sits in: the sidebar group, the tab
   bar, the `/academics` redirect, session resolution and the list-page clamp (see
   `docs/03-modules/academics.md` §20, and the Tier 2 row above for why it is a rebuild).
   PR B then shipped teacher allocation and load on that shell: `/academics/allocations`
   (the session-scoped list, a teacher-load panel against the norm, allocate, edit, end,
   reinstate and remove, an over-norm warning toast), with the backend rules behind it —
   `PATCH` now runs the §11 rules `create` runs, `effective_to` is writable on `PATCH` and
   a non-null value is refused on create, and `load-summary` is typed and carries `norm` (see
   `docs/03-modules/academics.md` §16 and §20).
   PR C then shipped promotions: `/academics/promotions` (the batch list, filters in the URL, a
   New batch dialog) and `/academics/promotions/{batchId}` (the review page, each transition
   behind a confirm dialog, execute as a polled job with a by-name report, the decision table
   and its edit dialog), with the backend contract behind it — the override reason now follows
   a proposal recorded at batch creation and covers the target class as well as the decision,
   and the responses are typed with name fields (see `docs/03-modules/academics.md` §11, §16 and
   §20). The nightly promotion journey now clicks through the confirm dialogs, and the mocked
   spec drives the same page-object methods.
   The `timetable` dashboard was built as three PRs, all merged (plan
   `docs/superpowers/plans/2026-10-19-timetable-dashboard.md`): PR A (#119, setup screens),
   PR B (#120, week grid, conflict panel, publish) and PR C (#123, substitutions, My timetable).
   **The `attendance` dashboard was built as three PRs, and with PR C it is complete** (plan
   `docs/superpowers/plans/2026-10-24-attendance-dashboard.md`): **PR A** (#134) — the
   register, Records, Settings, the tenant's attendance mode with period-mode markers,
   derived-day reporting ([ADR-0028](decisions/0028-one-attendance-mode-per-tenant.md)) and the
   fix that lets an `assigned`-only class teacher mark; **PR B** (#137) — the corrections and
   leave queues, with the approvals contract behind them; and **PR C** (#141) — staff attendance
   (`/attendance/staff`), reports (`/attendance/reports`) and the Records import, with the
   staff register, staff corrections, typed report rows and the threshold carried into exports
   behind them (see `docs/03-modules/attendance.md` §16 and §20). All three have merged, which
   finishes attendance's dashboard.
   **The `examinations` dashboard is being built as five PRs** (plan
   `docs/superpowers/plans/2026-11-01-examinations-dashboard.md`); **PR A, setup, is open (#147)**:
   `/exams`, an exam's page with its Subjects tab, and `/exams/grading-scales`, with the
   setup contract behind them (page-numbered lists, names on rows, `assigned` scope for exams
   and their subjects; `docs/03-modules/examinations.md` §20); its review round (#147) made a zero
   weightage a form error, gave out-of-range grade-band bounds and subject weightage a field
   error instead of a database conflict, and shared one active-path matcher across the sidebar,
   section tabs and auth proxy. **PR B, schedule and admit
   cards, is open (#149)** (stacked on PR A): the Schedule tab (an exam's sittings by date, the
   clash panel, publish schedule) and the Admit cards tab (the cards by section and status,
   issue with the server's counts, download through `:download`, revoke with a reason), with
   the clash-list read, the typed publish, the admit card's student and section, and
   `:download` behind them (§16, §20), and E2E coverage in `tests/dashboard/exams-schedule.spec.ts`
   and `tests/live/api/exams-schedule.spec.ts`. Its review round (#149) re-reads a sitting under
   the schedule lock before an edit or delete, so a concurrent cancel is not overwritten, and
   resolves every exam colon action under the hosting view's read key and then its own
   (ADR-0031 decision 3; plan `docs/superpowers/plans/2026-11-07-exams-dashboard-per-role-scope.md`).
   **PR C, marks, is open (#152)** (stacked on PR B):
   the Marks tab (progress per subject and section, lock and audited unlock, the section's grid
   with draft and submit, per-cell refusals, a read-only grid with the server's reason, and the
   sheet import), with the grid read and per-section entry behind it (§16, §20), and E2E coverage
   in `tests/dashboard/exams-marks.spec.ts` and `tests/live/api/exams-marks.spec.ts`.
   **PR D, results and report cards, is open (#154)** (stacked on PR C): the
   Results tab (process, approve held for the latest processor, send back, publish, withhold, a
   detail sheet with subject marks), the Report cards tab (generate, download, remarks per key,
   publish) and the Reports section (§13's six reports, inline or a polled job, export on
   `exams.result.export`), with E2E coverage in `tests/dashboard/exams-results.spec.ts`,
   `tests/dashboard/exams-report-cards.spec.ts`, `tests/live/api/exams-results.spec.ts` and the live browser journey
   `tests/live/exams-results-journey.spec.ts`.
   **PR E, question banks and paper assembly, is open** (#155, stacked on PR D #154):
   the Question banks section (banks by subject and status, an `assigned` teacher's subjects'
   only), a bank's page (questions by topic, difficulty, type, source and approval, each type's
   own fields, the AI label, and Approve on an unapproved AI draft behind a confirm showing the
   whole question) and Assemble paper (every shortfall listed, a polled job, the PDF downloaded
   once, even after the dialog is closed mid-job), with E2E coverage in
   `tests/dashboard/exams-question-banks.spec.ts` and `tests/live/api/exams-question-banks.spec.ts`.
   **The examinations dashboard is built across five stacked PRs, all open: A #147, B #149,
   C #152, D #154, E #155; full-stack once they merge.** What PR E left
   **`parent-portal` is in review as two stacked PRs** (plan
   `docs/superpowers/plans/2026-11-04-parent-portal.md`; module doc §20). PR 1
   (`feat/parent-portal-api`) is the backend: the per-child dashboard summary, the
   `GET /notifications` inbox (so `communication`'s backend is now complete), guardian notice
   browsing, a child's week through `/timetables/my?student_id=` and `/auth/me`'s
   `is_restricted_principal`. PR 2 (`feat/parent-portal-dashboard`, stacked on it) is the
   dashboard's `(portal)` route group
   ([ADR-0032](decisions/0032-parent-portal-in-dashboard-route-group.md)) and **completes the
   portal UI**: shell and routing, home, attendance, fees, results, timetable, messages,
   notices, the inbox and settings, with mocked `dashboard`-project specs. PR C
   (`feat/portal-admit-cards`) adds the child's current admit cards, with download, to Results.
   **Start here next** — review and merge the examinations stack in order (#147, #149, #152,
   #154, then #155); then account onboarding, the shared invitation flow in `deferred-work.md`'s
   parent-portal list: **only seeded guardians and students can log in until it ships**.
   Pay-now is in the same list; `communication`'s other staff screens are deferred
   (`docs/deferred-work.md`). What the academics PRs left out (term plans, syllabus
   attachment, curriculum import/export and approval, coverage reports, the §9 allocation grid,
   a tenant-configured load norm, a teacher's "My allocations", results- and attendance-based
   promotion proposals, a bulk section assignment) is in [`deferred-work.md`](deferred-work.md).

## Conventions worth re-reading before writing code

- Components resolve colour through `--sh-*` custom properties only — no literal hex, no
  `blue-600`. Tenant branding is the only thing that may override a `--sh-color-*`/
  `--sh-font-*`/`--sh-radius` value at runtime; the default is SchoolHub's own
  "Aurora" platform brand — see `DESIGN.md` at the repo root, and the doc comment at the
  top of `packages/ui/src/styles/theme.css`. A `--sh-platform-*` tier is separate and
  never tenant-overridable at all, and so is the `--sh-color-chrome-*` tier that skins
  the sidebar and header.
- Chart colour comes from `--sh-color-chart-1..6` in fixed slot order, never cycled and
  never by rank. Bars/lines/stacks may use all six; scatter, bubble and small-multiples
  are capped at the first three (slot 4 collapses against slot 2 under protanopia). Status
  is never carried by a chart colour — it takes success/warning/danger with an icon and a
  label. The reasoning and the measured separations are in `theme.css`'s own header.
- `bg-spotlight` is allowed **once per screen**, on that screen's hero element. It is a
  named utility rather than an inline gradient specifically so a second use is greppable.
- A column sorts only if the endpoint declares the field in `ordering_fields`. The UI
  never sorts the rows it holds: one page of 25 out of 400 students reordered in the
  browser looks like a sort and is a lie. Relation sorts are `annotate()`d and ordered by
  the alias, never `campus__name` — `SELECT DISTINCT` plus an `ORDER BY` on a joined
  column is a 500 for any principal whose `scope_queryset` adds `.distinct()`.
- Permission-aware UI is UX, never enforcement — the API enforces.
- `apps/website` must never gain a write path.
- Every new env var goes into `.env.example` with a dummy value and a comment.
- Tenant isolation is enforced by PostgreSQL RLS; every tenant-owned table
  inherits `TenantOwnedModel` and gets a policy via `core.tenancy.rls.rls_operations`
  in a hand-written `0002_rls_policies.py`. Cross-tenant access returns 404, never 403.
- Every backend endpoint declares a `module.resource.action` permission key
  (`docs/02-architecture/auth-and-rbac.md` §2.1); the permission class fails closed.
- The API contract is generated, not hand-written — `apps/api/openapi.yaml` and
  `packages/api-client/src/schema.d.ts` change together, in one commit.
- Every TS package/app tests in a sibling `__tests__/` folder next to the source it
  covers, not `*.test.ts(x)` co-located flat beside it — `packages/ui`, `apps/dashboard`,
  `apps/website`, and `packages/api-client` all moved to this convention; new test files
  go straight into `__tests__/` rather than being co-located and moved later.
