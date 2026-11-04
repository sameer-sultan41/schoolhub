# Parent Portal (guardian and student web portal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every subagent brief carries this repo's overrides (agent-lessons L11): no local tests, lint or typecheck; no AI attribution; never `--no-verify`; CI is the source of truth. The user has authorised commits, pushes and PR creation for this work.

**Work tier:** 2

**Goal:** Give guardians, and students, a portal inside `apps/dashboard`. A guardian sees each linked child's attendance, fees (read-only), published results and report cards, notices, messages, an in-app notification inbox and notification preferences. Everything shown comes from the owning modules' own visibility rules, plus one per-child summary call.

**Architecture:**
- **Backend:** a new `apps/parent_portal` Django app that owns no tables. It registers `parent-portal.dashboard.view` and `module.parent_portal`, and serves `GET /parent-portal/dashboard`.
  - **Visibility:** each card calls a visibility function exported from its owning module's `services`. That module's viewset is switched to call the same function, so the summary cannot show more than the endpoints do (§4).
  - **Gap-fills:** the inbox (`core.notifications`), guardian notice browsing, a `student_id` on `GET /timetables/my`, and `is_restricted_principal` on `/auth/me`.
- **Dashboard:** a `(portal)` route group with its own shell. Restricted principals are routed there, and staff are kept out. The server enforces every permission.

**Tech Stack:** Django 6.1 + DRF, PostgreSQL 18 (RLS), Next.js 16 App Router, TanStack Query, next-intl, `packages/ui`, `packages/api-client`; Jest; Playwright (mocked dashboard project and `live` lane).

**Spec:**
- `docs/03-modules/parent-portal.md`: §3–§7, §11, §12, §15, §16, §18, §19.
- `docs/03-modules/communication.md` §16 and §20: inbox, notice browsing.
- `docs/deferred-work.md`: the inbox entry; "guardians use the parent portal"; thread attachments.
- `docs/08-future/mobile-apps.md`: Invariant #7.

**User decisions (2026-11-03):**
- The portal lives in `apps/dashboard` as a route group.
- Fees are read-only (pay-now deferred).
- It ships as two stacked PRs, backend then dashboard.

**Lands as:** this file is copied to `docs/superpowers/plans/2026-11-04-parent-portal.md`, with its `## Independent review` block, in PR 1's first commit.
- **PR 1:** `feat/parent-portal-api`, **off `main`**.
- **PR 2:** `feat/parent-portal-dashboard`, stacked on PR 1.
- **The examinations stack (#147–#155) is not a base.** It is about 106 commits behind main and lacks `scope_queryset(permission=)`, `holds_key_for` and threads.
- **The one dependency on that stack:** D2's report-card button needs #154's `POST /report-cards/{id}:download`. If #154 hasn't merged when D2 runs, D2 ships without the button, with a deferred-work entry and a follow-up.

---

## Context

Guardian reads already on `main`:
- `GET /students` (own).
- `GET /student-attendance` (`student_id`, `date__gte/lte`, `status`).
- `GET /fee-invoices` (`student`, `outstanding`). Drafts are hidden for restricted principals, **in the viewset**, `fees_finance/views.py:504-513`.
- `GET /receipts/{id}/download`: a streamed PDF.
- `GET /results`: published only, **in the viewset**, `examinations/views.py:778-785`.
- `GET /report-cards`.
- Admit cards.
- Message threads.
- Notification preferences.
- `GET /timetables/my`: all owned sections, no per-child selector.

Ownership is `Student.filter_owned_by_user` (`student_management/models.py:170-195`, which honours `has_portal_access`). Anything out of scope is a 404.

Missing:
- The portal app, key and summary.
- Any inbox API.
- Guardian notice browsing. `Notice.filter_owned_by_user` exists, but `NoticeSerializer` is staff-shaped.
- A per-child timetable.
- A server-provided restricted flag.
- A client path for streamed PDFs.
- Payment initiation: deferred.
- Library and transport: no modules.
- **Any user or role management API.** Only seeded guardians can log in. Provisioning is deferred to its own platform-wide phase (see the ruling under Independent review). `module.parent_portal` stays `default_enabled=False`, so real tenants cannot switch on a portal nobody can sign in to.

## Alternatives considered (why not)

| Decision | Chosen | Rejected, and why |
| -------- | ------ | ----------------- |
| Where the portal lives | `(portal)` route group in `apps/dashboard` (user decision), recorded in ADR-0032 | A new `apps/portal` app. It duplicates auth, session, proxy, services and i18n wiring and adds a CI lane, for the same backend calls. |
| Card visibility | Each owning module exports a visibility function from `services` (scope **plus** the restricted-principal narrowing), and its own viewset calls it too | `scope_queryset` alone: wrong, because drafts, canceled and unpublished rows are filtered in each viewset's `get_queryset`. Importing those viewsets: ADR-0013 forbids it. Re-stating the rules in `parent_portal`: a second copy that drifts. |
| Which children | `Student.filter_owned_by_user` ∩ `scope_queryset(permission="students.student.view")`, as `MyTimetableViewSet._learner_timetable` does | Scope alone. A school owner holds every key at scope `all`, so they would get every student in one unpaginated response. |
| When a card is `null` | Key not in `effective_permission_keys(user)` (cached), or `not is_feature_enabled(flag, tenant_id=)` (cached) | `holds_key_for`: a per-row check, so N queries. |
| Which tabs to show | The summary carries server-computed `modules: {attendance, fees, examinations, communication, timetable}` | `menu-access.ts`'s `canAccessModule`: it checks key prefixes only, and the dashboard has no feature-flag source. A new `/tenant/features` endpoint: a second source for one consumer. |
| Portal routing | `/auth/me`'s new `is_restricted_principal`. The shells redirect on the client, rendering nothing until `/auth/me` resolves, then calling `router.replace` (the token is in memory, and Next 16 layouts don't re-run auth checks on navigation) | Role-slug sniffing: misses tenant-defined restricted roles. Reading roles in `proxy.ts`: it only sees an opaque cookie. |
| Inbox authorisation | `Notification.objects.filter(user_id=request.user.pk)` in `get_queryset`. Membership is the authorisation (ADR-0030). The key goes to one new `core.rbac.roles.ALL_TENANT_ROLES`, with a registry-derived test | Record scope: a scope-`all` admin reads everyone's inbox. A tenth copy of `ALL_STAFF`. |
| Inbox location | `core/notifications/`, beside the models. Staff use it too, whatever modules are on | The communication app. |
| Unread count | `GET /notifications:unread-count` → `{unread}` | `meta.unread_count` on the list: core `CursorPagination` emits only `meta.pagination`, so the field would be untyped. |
| Mark all read | `POST /notifications:mark-all-read` with `{before?}` (default now), marking only rows at or before it. This is GitHub's `last_read_at` pattern | Marking everything at request time: an item that arrived after render is lost. |
| Inbox after portal access is revoked | Delivered notifications stay (they're the user's own mail). New ones stop, because fan-out resolves current links. Documented | Retro-filtering: notifications have no student column, and hiding delivered mail surprises users. |
| Notices for guardians | `communication.notice.view` granted to `PORTAL_ROLES`. `list`, `retrieve` and `acknowledge` are portal-readable (`OWN_PREFERENCE_PERMISSIONS`). Restricted principals get `PortalNoticeSerializer`: `id, notice_no, title, body, notice_type, published_at, requires_acknowledgment, acknowledged_at` | The staff `NoticeSerializer`: it leaks `audience_filter` (a custom audience's user ids), `approved_by`, `status` and `show_on_website`. A portal-owned notice endpoint. Announcement browse (the inbox carries announcements; deferred). Notice attachments are deferred (L29). |
| Per-child timetable | Optional `student_id` on `/timetables/my`. A non-owned id → 404. A caller with a staff row → 400 | Merging all children into one grid. |
| Streamed PDFs | A typed `downloadBlob(path): Promise<Blob>` in `packages/api-client` (bearer header, the usual 401 refresh), plus a dashboard `saveBlob`. Reusable for every streamed download; mobile streams with the bearer token (Invariant #7) | A bare anchor: sends no `Authorization` header. A signed-URL receipt action: receipts are rendered on request, so there is no stored file to sign. |
| Payment | Read-only. No Pay button; a deferred-work entry | Building the gateway now (rejected by the user). |
| Child selection | `[studentId]` URL segment | Local state or a cookie: lost on refresh. |

## Global Constraints

- **Invariants:**
  - #1: no new tables.
  - #2: out of scope → **404**, including `student_id` params.
  - #3: every new endpoint declares a key.
  - #6: the contract is regenerated in every API commit. The dashboard uses **generated** types; the hand-written `packages/types` `AuthenticatedUser` drift is recorded, not extended.
  - #7: plain JSON and streams only.
- **Keys and roles:**
  - `parent-portal.dashboard.view` → `PORTAL_ROLES`.
  - `platform.notification.view` → `ALL_TENANT_ROLES`.
  - `communication.notice.view` gains `PORTAL_ROLES`.
  - `PORTAL_ROLES = ("student", "guardian")` and `ALL_TENANT_ROLES` are defined once, in `core/rbac/roles.py`. The copies in `examinations/permissions.py:86` and `fees_finance/permissions.py:65` are repointed.
  - Restricted roles get scope `own` (`seed_all_roles.py:66` `RESTRICTED_ROLES`, `:229`).
- **Feature flag:** `module.parent_portal`, `default_enabled=False`. The inbox has no module flag.
- **ADR-0013:** `parent_portal` imports other apps' `services`/`models` only, never `views`, `viewset`, `reports` or `filters`.
- **Visibility:**
  - Published results only (§11).
  - No draft or canceled invoices in the fees card.
  - Students see only themselves (§11).
  - Percentages are computed on the server, never in the client.
- **Repo rules:**
  - Theme tokens only.
  - i18n in `en.json` and `ur.json`, with label maps for every enum (L32).
  - Conventional Commits; `fix` commits carry `Root cause:`.
  - Docs in the same PR.
  - Each PR gets `--assignee @me --label "needs review"` and an ELI5 section.

## Review Focus

1. **A draft or canceled invoice, or an unpublished result, for a guardian's child.** It is absent from the summary exactly as from `/fee-invoices` and `/results`. Tests: `test_fees_card_excludes_draft_and_canceled_invoices` and `test_latest_result_skips_unpublished` (P2).
2. **A school owner (every key, scope `all`) calls the summary.** No children are returned. Test: `test_school_owner_summary_lists_no_children` (P2).
3. **Two children, one with `has_portal_access=False`.** That child is absent everywhere, and a 404 as `student_id`. Tests: `test_child_without_portal_access_is_absent` (P2) and `test_timetable_for_unlinked_child_is_404` (P3).
4. **Fees disabled for the tenant.** `fees: null` and `modules.fees: false`, and the tab is hidden. Tests: `test_disabled_module_card_is_null` (P2) and `fees tab hidden when module disabled` (D1).
5. **A scope-`all` admin's inbox, and cross-routing.**
   - The admin sees own rows only. Test: `test_inbox_is_own_rows_even_for_scope_all` (P1).
   - A guardian on `/students` lands on `/portal`, and staff on `/portal` land on the dashboard (D1).

---

# PR 1 — backend (`feat/parent-portal-api`, off `main`)

Load `schoolhub-backend-module` and `schoolhub-testing` first.

### Task P1: Role constants and the notification inbox

**Files:**
- Create:
  - `apps/api/core/rbac/roles.py`.
  - `apps/api/core/notifications/{views,urls,serializers,filters,permissions}.py`.
  - `apps/api/core/notifications/tests/test_inbox.py`.
- Modify:
  - `apps/examinations/permissions.py` and `apps/fees_finance/permissions.py` (import `PORTAL_ROLES`).
  - `config/api_v1.py`.
  - The contract.

**Interfaces:**
- **`core.rbac.roles`:** `PORTAL_ROLES` and `ALL_TENANT_ROLES`, every tenant role slug in `docs/00-overview/users-and-roles.md`.
- **`NotificationInboxViewSet`:**
  - Actions: list and retrieve.
  - `get_queryset` filters own rows, with a docstring explaining why it isn't scoped.
  - Cursor ordering `("-created_at", "-id")`; `ordering_fields = []` (L28).
  - Filters `read` (bool) and `category`.
  - `required_permission = "platform.notification.view"`, with an explicit `required_permission_map` for `mark_read`, `mark_all_read` and `unread_count`.
- **Endpoints:**
  - `GET /notifications`.
  - `GET /notifications/{id}`.
  - `GET /notifications:unread-count` → `{unread}`.
  - `POST /notifications/{id}:mark-read` → `{read_at}`, idempotent.
  - `POST /notifications:mark-all-read` with body `{before?: datetime}` → `{marked}`, one UPDATE.
- **Serializer fields:** `id, event_key, category, title, body, data, source_type, source_id, priority, read_at, created_at`.

- [ ] **Step 1, failing tests:**
  - `test_inbox_lists_only_own_rows`
  - `test_inbox_is_own_rows_even_for_scope_all`
  - `test_mark_read_other_users_notification_is_404`
  - `test_mark_read_is_idempotent`
  - `test_mark_all_read_leaves_rows_after_before`
  - `test_read_filter_and_unread_count`
  - `test_guardian_reads_thread_reply_in_inbox`
  - `test_every_default_role_holds_notification_view`: every slug in any registered key's `default_roles` is in `ALL_TENANT_ROLES`.
  - Cross-tenant: retrieve and mark-read return 404.
- [ ] **Step 2:** Implement and regenerate the contract.
- [ ] **Step 3, commit:** `feat(notifications): in-app notification inbox with mark-read and an unread count`.

### Task P2: Owning-module visibility functions, and `GET /parent-portal/dashboard`

**Files:**
- Modify (move rules into `services`; viewsets call them):
  - `apps/fees_finance/{services,views,filters}.py`
  - `apps/examinations/{services,views}.py`
  - `apps/attendance/services.py`
  - `apps/communication/threads/{viewset.py,services/access.py}`
- Create:
  - `apps/api/apps/parent_portal/{__init__,apps,features,permissions,serializers,services,views,urls}.py`
  - `tests/{test_dashboard,test_cross_tenant}.py`
- Modify: `config/settings/base.py` (`INSTALLED_APPS`), `config/api_v1.py`, the contract.

**Interfaces:**
- **Owning-module functions:**
  - `fees_finance.services.visible_invoices(user) -> QuerySet[FeeInvoice]`: the scope, plus drafts excluded for restricted principals.
  - `fees_finance.services.outstanding_invoices(qs) -> QuerySet[FeeInvoice]`: the `outstanding=true` rule (`balance_due > 0`, not canceled), which `filters.py` now calls.
  - `examinations.services.visible_results(user) -> QuerySet[Result]`: the scope, plus published-only for restricted principals. The same move applies to `visible_report_cards(user)`.
  - `attendance.services.student_month_summary(*, students, month) -> dict[uuid, dict]`: a wrapper over `reports.student_summary`, using derived days (ADR-0028), `PRESENT_STATUSES` and `EXCLUDED_FROM_RATE`.
  - `communication.threads.services.access.visible_threads(user, *, restricted)` and `unread_count`: moved from `threads/viewset.py:68-113`, and the viewset imports them back.
- **`parent_portal.services.build_dashboard(*, user) -> dict`** returns:
  - `children[]`: `{student: {id, first_name, last_name, admission_number, class_name, section_name}, attendance, fees, latest_result}`.
  - `unread_notifications`.
  - `unread_threads | None`.
  - `modules: {attendance, fees, examinations, communication, timetable}`.
- **Children:** `Student.filter_owned_by_user(Student.objects.alive(), user)` ∩ `scope_queryset(..., permission="students.student.view")`, with the active enrolment prefetched. Ordered by first name, then id.
- **Cards.** Each card is one grouped query for all children, and is `null` when its `modules` flag is false.
  - `attendance`: `{today, month_percentage, month_present_days, month_counted_days}` for the current month, in the tenant's timezone.
  - `fees`: `{outstanding_total, outstanding_count, next_due_date}` over `outstanding_invoices(visible_invoices(user))`.
  - `latest_result`: `{exam_name, percentage, grade, published_at}`, the newest `published_at` in `visible_results(user)`.
  - `unread_threads`: the number of `visible_threads` with unread messages, one query.
- **`DashboardView`:** `GET`, base permission stack, `required_permission = "parent-portal.dashboard.view"`, `required_feature = "module.parent_portal"`.

- [ ] **Step 1, failing tests:**
  - `test_guardian_sees_one_card_per_linked_child`
  - `test_child_without_portal_access_is_absent`
  - `test_student_sees_only_self`
  - `test_school_owner_summary_lists_no_children`
  - `test_disabled_module_card_is_null`
  - `test_missing_key_card_is_null`
  - `test_modules_flags_reflect_key_and_feature`
  - `test_latest_result_skips_unpublished`
  - `test_fees_card_excludes_draft_and_canceled_invoices`
  - `test_attendance_card_matches_attendance_summary`: period mode counts days; `on_leave` is excluded.
  - `test_unread_threads_excludes_revoked_child_threads`
  - `test_staff_without_key_is_403`
  - `test_portal_module_off_is_403_module_disabled`
  - `test_query_count_constant_for_one_and_three_children`
  - Cross-tenant: another tenant's guardian sees none of this tenant's children.
  - The existing fees, results, report-card and threads endpoint tests stay green after the move.
- [ ] **Step 2:** Implement and regenerate the contract.
- [ ] **Step 3, commits:**
  - `refactor(fees,examinations,attendance,communication): export each module's restricted-principal visibility from services`
  - `feat(parent-portal): per-child dashboard summary from each module's own visibility rules`

### Task P3: Guardian gap-fills: notices, timetable child selector, `/auth/me` flag

**Files:**
- `apps/communication/{permissions.py,notices/viewset.py,notices/serializers.py,notices/tests/}`.
- `apps/timetable/slots/{viewset,serializers}.py`, `slots/tests/`.
- `core/rbac/serializers.py` (`UserSerializer`, also used by the login response), `core/rbac/tests/`.
- `apps/dashboard/src/features/communication/messages/reply-composer.tsx:24-27` (the comment, and gate on the flag).
- The contract.

**Interfaces:**
- **Notices:**
  - `communication.notice.view` gains `PORTAL_ROLES`.
  - Rewrite its description ("including drafts" holds for staff only) and the module docstring.
  - `NoticeViewSet.PORTAL_READABLE_ACTIONS = {"list", "retrieve", "acknowledge"}`, using `OWN_PREFERENCE_PERMISSIONS`. Every other action stays `STAFF_PERMISSIONS`.
  - Remove `scope_read_exempt_actions={"acknowledge"}`, whose reason is now false; acknowledge falls back to ADR-0031 decision 3.
  - Restricted principals get `PortalNoticeSerializer`, with `acknowledged_at` read in one query.
- **Timetable:** `GET /timetables/my?student_id=`.
  - An owned id returns that child's timetable.
  - A non-owned id → 404.
  - A caller with a staff row → 400 on `student_id`.
  - With no `student_id`, behaviour is unchanged.
- **`UserSerializer.is_restricted_principal: bool`**, from `core.rbac.permissions.is_restricted_principal`.

- [ ] **Step 1, failing tests:**
  - `test_guardian_lists_only_received_notices`
  - `test_portal_notice_omits_audience_and_approver`
  - `test_guardian_cannot_create_or_publish_notice`
  - `test_notice_list_carries_own_acknowledged_at`
  - `test_timetable_for_one_child`
  - `test_timetable_for_unlinked_child_is_404`
  - `test_staff_timetable_with_student_id_is_400`
  - `test_me_flags_restricted_principal`
  - `test_me_flag_false_for_staff`
  - Cross-tenant: notice retrieve and timetable `student_id` return 404.
- [ ] **Step 2:** Implement and regenerate the contract.
- [ ] **Step 3, commit:** `feat(portal): guardian notice browsing, per-child timetable and the restricted-principal flag`.

### Task P4: Seed, live e2e, docs, ADR, PR

**Files:**
- **`seed_e2e_data.py` and its tests:**
  - The seeded guardian role gets the keys a real `guardian` role gets, built from the registry.
  - Enable `module.parent_portal`, `module.fees_finance` and `module.examinations` on both tenants.
  - `e2e-comms-guardian`'s child gets:
    - attendance rows;
    - an issued, outstanding invoice through `fees_finance.services`;
    - a published result through the real service chain: exam → exam-subject → `bulk_enter_marks` → `lock_marks` → `process_exam_results` → approve → publish. If that chain is not on `main` at execution time (the exams stack still open), seed the result through `examinations.services` functions that exist on `main`, and say so in the PR.
- `e2e/tests/live/api/parent-portal.spec.ts`.
- **Docs:**
  - `parent-portal.md`: §16 gets the real endpoints and filter names, and a "§20 Built" section is added, including the revoked-access inbox rule.
  - `communication.md`: §16 and §20.
  - `docs/decisions/0032-parent-portal-in-dashboard-route-group.md`, and the ADR index.
  - `project-status.md`: states that only seeded guardians can log in until provisioning ships.
  - `deferred-work.md`: remove the inbox entry, and add:
    - Pay-now (`:initiate-payment`, `fees.payment.create`, gateway, webhook).
    - **Account onboarding (staff, guardian, student)** (§3, §19). This is a shared `core` invitation flow:
      - an `invitations` table holding a hashed, single-use token with a 72h expiry;
      - `POST /auth/invitations:accept {token, password}` (API-driven, so mobile can use it);
      - resend and revoke actions;
      - email delivery.
      Staff `:invite` adopts it, and `guardians/{id}:invite` plus `students/{id}:invite` are added on top. Self-registration is deferred, per §19 (invitation-only).
    - `platform.notification.view` for custom tenant roles.
    - Guardian thread and leave attachment upload.
    - Library and transport panels.
    - Announcement browse.
    - Notice attachments.
    - Admit-card download in the portal.
    - Results trend chart.
    - Per-month attendance percentage beyond the current month.
    - Combined calendar.
    - Contact-field edits.
    - Locale selection.
    - Guardian profile view.
    - Class-threshold comparison.
    - §13 guardian PDF summaries.
    - Office-hours auto-notice.
    - SSE badge.
    - AI-PAR-01/02/03.
    - Parent-engagement report.
    - Per-panel tenant toggles.
    - The `packages/types` `AuthenticatedUser` drift.

- [ ] **Step 1, live spec** (each identity logs in once):
  - The summary numbers match the seed.
  - An unlinked `student_id` is a 404.
  - The inbox shows a thread reply.
  - A notice can be listed and acknowledged.
  - The other tenant sees nothing.
- [ ] **Step 2, commits:** `test(e2e): seed and live journeys for the parent portal API`; `docs(parent-portal): built status, ADR-0032, deferred work`.
- [ ] **Step 3, ship:**
  1. Run `change-reviewer` with this plan and fix what it finds.
  2. Push and run `gh pr create --base main --assignee @me --label "needs review"` (ELI5).
  3. `gh pr checks --watch`.
  4. Dispatch `e2e-live.yml` on the branch and cite the run.

---

# PR 2 — dashboard (`feat/parent-portal-dashboard`, stacked on PR 1)

Load `schoolhub-dashboard-screen`, `schoolhub-api-services`, `schoolhub-testing` and `next-best-practices` first.

### Task D1: API client download, services, portal shell and routing

**Files:**
- `packages/api-client/src/client.ts` (`downloadBlob`) and its tests.
- `apps/dashboard/src/lib/helpers.ts` (`saveBlob`).
- `src/services/modules/{parent-portal,notifications,notices,notification-preferences,fee-invoices,receipts,results,report-cards}/`. Reuse any that already exist on the base; check `src/services/index.ts` first.
- `endpoints.ts` and `index.ts`.
- `src/config/paths.ts`, which gets `PORTAL`, `PORTAL_CHILD(id)`, `PORTAL_ATTENDANCE(id)`, `PORTAL_FEES(id)`, `PORTAL_RESULTS(id)`, `PORTAL_TIMETABLE(id?)`, `PORTAL_MESSAGES`, `PORTAL_NOTICES`, `PORTAL_NOTIFICATIONS` and `PORTAL_SETTINGS`.
- `src/app/(portal)/portal/layout.tsx` and `features/portal/shell/{portal-shell,child-switcher,portal-nav}.tsx`.
- `src/app/(app)/layout.tsx` (Shell redirect).
- `features/auth/login-form.tsx` (role-aware default landing).
- `messages/{en,ur}.json` (`portal` namespace).

**Interfaces:**
- `usePortalSummary()` wraps the summary query.
- Nav items come from `summary.modules`.
- The child switcher navigates between `[studentId]` segments; students see no switcher.
- Each shell renders nothing until `/auth/me` resolves, then calls `router.replace(Paths.PORTAL)` or `router.replace(Paths.DASHBOARD)`.

- [ ] **Step 1, failing tests:**
  - Each service hits its `endpoints.*` path and method.
  - `downloadBlob sends the bearer token and returns a Blob`
  - `restricted principal is redirected to the portal`
  - `staff user is redirected out of the portal`
  - `child switcher lists only summary children`
  - `fees tab hidden when module disabled`
- [ ] **Step 2:** Implement, then commit `feat(dashboard): portal shell, routing, services and blob downloads`.

### Task D2: Home, attendance, fees, results, timetable

**Files:** `features/portal/{home,attendance,fees,results,timetable}/` + `__tests__/`, and the routes under `(portal)/portal/`.

**Behaviour:**
- **Home:** one card per child. `null` cards are omitted.
- **Attendance:**
  - A month grid on the `packages/ui` `calendar` primitive, from `/student-attendance?student_id=&date__gte=&date__lte=`.
  - The percentage is shown only for the current month, from the summary card.
  - Status labels come from an i18n map (L32).
- **Fees:**
  - Outstanding and paid lists, plus invoice detail with lines.
  - Receipts download via `downloadBlob("/receipts/{id}/download?format=pdf")` + `saveBlob`.
  - No Pay button.
- **Results:**
  - Published results, as a term list.
  - Report-card download via `:download` → `{download_url}` when #154 is on the base, otherwise omitted (see Lands as).
- **Timetable:** `features/timetable/my/my-timetable.tsx` and `features/timetable/grid/week-grid.tsx`, with `student_id`.

- [ ] **Step 1, failing Jest tests:**
  - `home omits null cards`
  - `attendance grid renders statuses and shows the percentage only for the current month`
  - `fees shows outstanding and paid with a receipt blob download`
  - `results lists only what the API returns`
  - `timetable passes the selected child`
- [ ] **Step 2:** Implement, then commit `feat(dashboard): portal home, attendance, fees, results and timetable`.

### Task D3: Messages, notices, notification inbox, preferences

**Files:** `features/portal/{messages,notices,notifications,preferences}/` + `__tests__/`, and their routes.

**Behaviour:**
- **Messages:** reuse `features/communication/messages/*` in `portal` mode: a student picker of the summary's children, and no recipients, close or reopen.
- **Notices:** list and detail, with Acknowledge when the notice requires it and the caller hasn't acknowledged yet.
- **Inbox:**
  - A cursor list with a `read` filter.
  - Opening an item marks it read, through a do-once guard that resets on error (L33).
  - Mark-all-read sends `before` = the newest on-screen `created_at`.
  - The badge comes from `:unread-count`.
  - Category labels come from an i18n map (L32).
- **Preferences:**
  - Category × channel toggles.
  - Both enums get i18n label maps (L32).
  - Emergency is locked on.

- [ ] **Step 1, failing Jest tests:**
  - `portal messages limit student picker to own children`
  - `notice acknowledge hides button after success`
  - `opening a notification marks it read once, and retries after an error`
  - `mark all read sends the newest on-screen timestamp as before`
  - `emergency preference cannot be turned off`
- [ ] **Step 2:** Implement, then commit `feat(dashboard): portal messages, notices, inbox and preferences`.

### Task D4: Mocked e2e, docs, PR

**Files:**
- `e2e/src/mocks/domains/portal.ts` (+ store), with fixtures copied from real server shapes (L5).
- `e2e/src/data/factories.ts` (`GUARDIAN_PERMISSIONS`, `buildGuardianUser()` with `is_restricted_principal: true`).
- Page objects in `e2e/src/pages/portal/`.
- `e2e/tests/dashboard/portal-{home,child-pages,communication}.spec.ts`.
- Docs: `parent-portal.md` §20 and `project-status.md`.

- [ ] **Step 1, specs:**
  - A two-child switcher.
  - Attendance grid; fees with a receipt; results.
  - Notice acknowledge; inbox mark-read; preferences.
  - A guardian on `/students` lands on `/portal`.
  - Staff on `/portal` land on the dashboard.
- [ ] **Step 2, ship:**
  1. Run `change-reviewer`.
  2. Push and run `gh pr create --base feat/parent-portal-api --assignee @me --label "needs review"` (ELI5).
  3. `gh pr checks --watch`.

---

## Verification

- **CI only, no local runs:**
  - `api.yml`: contracts, RLS and cross-tenant suites, the OpenAPI staleness gate.
  - `frontend.yml`: schema freshness, lint, typecheck, Jest ratchet, build, mocked Playwright.
  - `repo-hygiene`.
- **Live:** dispatch `e2e-live.yml` on PR 1's branch and cite the run.
- **Manual smoke (the human's call, after merge):**
  - Log in as `e2e-comms-guardian` and land on `/portal`.
  - The card numbers match the seed.
  - Download a receipt.
  - Use messages, notices, the inbox and preferences.

## Self-Review

- **Spec coverage:**
  - §5.1 → P2/D1/D2.
  - §5.2 → D2 (current-month percentage only; other months deferred).
  - §5.3 → D2 (pay-now deferred).
  - §5.4 → D2 (chart deferred).
  - §5.5 → P3/D3.
  - §5.6 → D3.
  - §5.7 → D3.
  - §5.8 → P3/D2 (homework, library and transport deferred).
  - §11 → the P2/P3 tests.
  - §16 → P1–P3, with real names written back in P4.
  - Every §6, §13, §14 and §19 item not built is listed in P4's deferred-work entries.
- **Review findings:** every finding in the independent review is addressed above.
- **Type consistency:** these are each defined once and used by name:
  - `visible_invoices`, `outstanding_invoices`, `visible_results`, `visible_report_cards`, `student_month_summary`, `visible_threads`, `build_dashboard`
  - `NotificationInboxViewSet`, `PortalNoticeSerializer`
  - `PORTAL_ROLES`, `ALL_TENANT_ROLES`, `platform.notification.view`, `parent-portal.dashboard.view`, `module.parent_portal`
  - `is_restricted_principal`, `downloadBlob`, `saveBlob`, `PORTAL_*`

## Independent review

- **Reviewer:** plan-reviewer agent, 2026-11-04
- **Verdict:** REVISE. The approach is right, but the summary would have shown guardians draft invoices and unpublished results: those filters live in viewsets, not in `scope_queryset`. Also: drop the exams-stack base, use a portal-safe notice serializer, and bound the summary for scope-`all` holders.
- **Findings addressed:**
  - **High:**
    - Visibility functions are moved into the owning modules' `services` and called by both the viewsets and the summary (with the draft/canceled and unpublished tests).
    - PR 1 is based on `main`; only D2's report-card button waits for #154.
    - `PortalNoticeSerializer` has explicit fields; notice attachments are deferred.
    - Children are `filter_owned_by_user` ∩ scope (with the school-owner test).
  - **Medium:**
    - The attendance card uses `reports.student_summary` through `services`, and the client never computes a percentage.
    - Null cards come from `effective_permission_keys` and `is_feature_enabled`.
    - `visible_threads` and `unread_count` are moved to `services`.
    - `ALL_TENANT_ROLES` plus a registry test; the custom-role grant is deferred; `required_permission_map` and `ordering_fields` are set.
    - Tabs come from `summary.modules`.
    - `downloadBlob` for streamed PDFs.
    - The seed enables fees and exams, and a published result is reached through services.
    - Provisioning is deferred and stated in project-status.
    - The generated types are used, and the drift is recorded.
    - The stale notice exemption, description and docstring are fixed.
  - **Low:**
    - The `read` filter name.
    - The `:unread-count` endpoint and `before` on mark-all-read.
    - Client-side `router.replace` after `/auth/me`, targeting `Paths.DASHBOARD`.
    - The missing spec items are listed in deferred-work.
    - The revoked-access inbox rule is decided.
    - `PORTAL_ROLES` is defined once and `OWN_PREFERENCE_PERMISSIONS` is reused.
    - A staff caller passing `student_id` gets a 400.
    - Citations are corrected.
    - L32/L33 are applied.
- **Unresolved:**
  - Settled by author ruling, recorded above:
    - Module enablement → `summary.modules`.
    - Receipts → `downloadBlob`.
    - The notification key → `ALL_TENANT_ROLES` plus a registry test, with custom roles deferred.
    - Revoked access → delivered notifications stay.
  - **Ruling (user delegated to industry standard, 2026-11-04):** provisioning is deferred out of this plan.
    - **Evidence:** staff `:invite` on `main` also creates an inactive account with an unusable password and has no activation flow. The gap is platform-wide account onboarding, not portal-specific, so it belongs in `core` and serves every account type once. Building it inside the portal would make a second, guardian-only copy.
    - **Approach for that phase:** stateful invitations (hashed token, expiry, resend/revoke, audit). Django's stateless `PasswordResetTokenGenerator` refuses inactive users with unusable passwords, and cannot list or revoke pending invites.
    - **Safety until then:** `module.parent_portal` defaults off.
    - **Execution:** subagent-driven.
