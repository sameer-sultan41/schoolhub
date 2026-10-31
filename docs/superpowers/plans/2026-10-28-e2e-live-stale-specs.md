# E2E Live Lane: Fix the Three Stale Specs

**Work tier:** 2

**Goal:** the nightly `e2e-live` lane goes from 49 passed / 7 failed to all green, by fixing
the tests and seed that drifted from the product — not by changing product behaviour.

**Evidence:** run 40663241847 (on #142, 2026-10-28), its log and its `playwright-report-live`
traces. Each spec stops at its first failure and none has ever passed, so every assertion
*after* the first failure was traced against the code too (L17), not assumed to work.

## Root causes

| Spec (failures) | What the test does | What the product does | Proof |
| --- | --- | --- | --- |
| `tests/live/api/attendance-leave.spec.ts` (4) | Submits a student leave request as `liveApiClient` — `e2e-admin@schoolhub.test`, the seeded **school_owner** (`src/env.ts:27`), not the school admin | §4 grants `attendance.leave-request.create` to `student` (own) and `guardian` (own children) only; §11 "requester must be the student or a linked guardian"; `services.assert_may_request_for_student` checks ownership, not keys, so even an all-keys owner is refused | 422 "You may only request leave for yourself or a child you are linked to." ×4. Already recorded in `deferred-work.md` ("needs a student or guardian identity") |
| `tests/live/dashboard-summary.spec.ts` (1) | Asserts the rebuilt home (now band "Today's schedule", "Teaching load this week", quick actions) | `main`'s `/dashboard` is `shell/dashboard/dashboard-page-content.tsx`: Metronic Demo1 layout with real widgets (`ChannelStats`, `EntryCallout`, `Highlights`, `EarningsChart` = Teacher Load, `TeamMeeting`, `Teams` = Staff) | The rebuild, commit `032d8280`, is not an ancestor of `main`. Every API call in the trace is 200; only the locators are missing |
| `tests/live/students-admission-enrollment.spec.ts` (2) | Clicks a "New student" **link** to `/students/new`, then uses routed `/students/{id}` pages | "New student" is a button opening `StudentCreateStepper` (Profile → Guardians → Emergency Contacts → Documents → Enrollment); the detail view is `StudentDetailSheet`, opened from a directory row, with no URL | Timeout on `getByRole('link', { name: 'New student' })` ×2. `deferred-work.md` (≈972-1018) already records this and the rewrite recipe this plan follows |

The user chose (2026-10-28) to make the dashboard spec assert today's home rather than
re-land the rebuild.

## Changes

### 1. Leave — a seeded guardian, linked to each test's own students

**Seed** (`apps/api/core/rbac/management/commands/seed_e2e_data.py`):
- `E2E_GUARDIAN_EMAIL = "e2e-guardian@schoolhub.test"`, a `guardian` role with
  `is_restricted_principal=True` and `E2E_GUARDIAN_PERMISSIONS =
  ["attendance.leave-request.create", "attendance.leave-request.view"]` (§4:46-47's
  guardian rows), at `RecordScope.OWN`. Allowed: `LeaveRequestViewSet` deliberately omits
  `DenyRestrictedPrincipals` (`views.py:671`), and no code limits a restricted role's keys.
- A `Guardian` row looked up idempotently on `(tenant, user_id)` (the partial unique
  `guardians_unique_user_per_tenant`), with first/last name `E2E` / `Guardian` and a fixed
  phone, `E2E_GUARDIAN_PHONE`. `phone` is required, and `GET /guardians?search=` matches
  name, phone and email, so the spec searches by the mirrored phone.
- Remove `attendance.leave-request.create` from `E2E_SCHOOL_ADMIN_PERMISSIONS`. This is
  **not the fix** (the failing caller is the owner); it makes the seed match §4 (L5), and no
  live spec or backend test relies on it (checked by the reviewer).
- Rewrite the three comments that are now wrong (L12): the school-admin block's "the
  submitter is a guardian identity", the class-teacher block's "that identity submits the
  request in the live lane", and the "§6 rule 4" reference, since auth-and-rbac.md has no §6.
- `core/rbac/tests/test_seed_e2e_data.py`: the guardian holds exactly those keys, its role
  is restricted, its `Guardian` row has its `user_id`, a second seed run creates no second
  row, and the admin no longer holds `leave-request.create`.

**E2E:**
- `e2e/src/lib/seed-constants.ts`: `E2E_GUARDIAN_EMAIL`, `E2E_GUARDIAN_PHONE`.
- A helper in `e2e/src/lib/` (next to `live-attendance-register.ts`):
  `linkSeededGuardian(admin, studentId)`. It finds the guardian by phone, then calls
  `POST /students/{id}/guardians` with `{guardian_id, relationship: "father",
  has_portal_access: true}`.
- `attendance-leave.spec.ts`:
  - The **guardian** submits in every test. There is one guardian session per worker, the
    `markerSession` pattern from `attendance-marking.spec.ts`.
  - The register stays run-unique (`seedAttendanceRegister`), so parallel workers never
    collide on the overlap rule.
  - The approve test enrols in the baseline session:
    `seedAttendanceRegister(liveApiClient, await todaysSession(liveApiClient))`.
    `apply_approved_leave` marks only an ACTIVE enrolment in the `is_current` session
    (`services.py:1451-1468`). The other tests keep the scaffold session, because they never
    auto-mark.
  - "The submitter cannot approve their own request" becomes "a requester cannot decide
    leave": the guardian's `:approve` is a **403**, because guardians never hold `approve`.
    The 422 self-decision rule is unreachable in the live lane by construction. It is
    covered by `apps/attendance/tests/test_leave.py:291`, and the header says so.
  - The cancel test cancels as the guardian, the real requester. `:cancel` is keyed on
    `leave-request.create` (`views.py:705`), and the own hook admits the guardian.
  - The header is rewritten: the submitter is the linked guardian, the only identity §11
    allows. It also notes the known `is_current` sensitivity: `academic-sessions.spec.ts`
    briefly activates another session. If that flakes, the fix is serialising the two specs
    or checking the current session first, never retries (stop rule 2).
  - Login budget: +1 login per worker for the guardian. The approver is unchanged.

### 2. Dashboard home — assert content that only loaded data produces

`dashboard-summary.spec.ts` keeps its purpose (a school admin's home renders from real
endpoints) and its one real login. Its assertions:
- `EntryCallout` greets the signed-in admin by full name (`Welcome back, E2E …`). That text
  appears only after `/auth/me` resolves, never in the error branch.
- The `Teams` (Staff) grid has a row for the seeded `E2E Teacher`, which proves `/staff`
  loaded and rendered.
- `ChannelStats`: each stat card shows a number, not the `—` placeholder. The locator is
  scoped to the card that holds the label, and is count-aware where a label also appears in
  `Highlights` (Playwright locators are strict).
- ~~No `QueryErrorMessage` text on the page~~ — dropped in review (amended): the widget
  prints the API's own error message, so no fixed copy can detect a failure, and the
  error branch has no role. The loaded-content assertions above are the proof; a widget
  not covered by one (`TeamMeeting`, `EarningsChart`) is recorded in `deferred-work.md`.
  The spec does **not** use `role="alert"`, which also matches Next's route announcer.

Locators live in `DashboardPage` (`e2e/src/pages/dashboard/dashboard.page.ts`), with no
`expect` there. There is no product change: if a stat card has no unique locator without an
accessibility label, the assertion stays count-aware rather than adding one. The
quick-action and now-band assertions are dropped, because those panels do not exist. The
header's history paragraph says the rebuild (`032d8280`) never reached `main`.

### 3. Admission — the recipe in `deferred-work.md` ≈1002-1018

1. Open the form with `studentsPage.addStudentButton.click()`, then fill Profile using the
   labels the mocked `tests/dashboard/student-create-stepper.spec.ts` uses. Assert the
   stepper's "has been created" banner, not a URL. Admission number: assert the server's
   `{year}-{seq}` text where the stepper or sheet shows it.
2. Do Guardians (create and link), Emergency Contacts, Documents (skipped) and Enrollment
   **through the wizard's own Next button**. The Enrollment step renders the same
   `StudentEnrollmentTab` the sheet does, so enrol, change section and request transfer
   happen there.
3. After the wizard closes, reopen the student with `studentsPage.row(lastName).click()`.
   The approver does the same, which needs a `studentsPage` added to `SecondIdentity`
   (`src/fixtures/index.ts`). Tabs are opened through `StudentDetailPage.openTab`
   (History overflows into "More"). Step 8 keeps `page.reload()` before re-opening the row
   (amended during implementation): the wizard's History step cached the transfers list
   for `DEFAULT_QUERY_STALE_TIME_MS` (30s), and the approval happened in another browser,
   so re-opening alone would show "Requested". Waiting out or polling the badge would be a
   suppressor (stop rule 2).
4. `StudentDetailPage` is made sheet-aware: scope to the named or topmost dialog, and stop
   waiting for "any dialog hidden", since the sheet is itself a dialog. It must keep the
   mocked `students-relations.spec.ts` (the only mocked user of it) green.
5. Retire `StudentFormPage` (only this spec uses it) and `StudentDetailPage.goto`, rather
   than re-pointing them.
6. The duplicate test submits Profile twice through the stepper and expects the `already
   exists` alert inside the dialog, scoped by text.

Login budget is unchanged (the admin and the approver), and so is the one refresh step 8 costs.

### Docs (same PR)

- `docs/deferred-work.md`:
  - Close the admission-rewrite entry (≈972-1018) and the leave bullet (≈345-349).
  - Add one bullet: the rebuilt dashboard home (`032d8280`) never reached `main`, and
    re-landing it means restoring that commit's panels and this spec's old assertions.
- `docs/project-status.md`: update the `e2e` row's "`students-admission-enrollment.spec.ts`
  is stale" line, and the student-management row's pointer to it.
- `docs/07-quality/agent-lessons.md`: extend L17 rather than add a new lesson. A never-green
  spec hides every step after its first failure, so a fix traces every later assertion
  against the code before calling the spec fixed.
- Module docs are unchanged, because product behaviour does not change.

## Alternatives considered (why not)

- **Let `school_admin` or `school_owner` submit leave on a student's behalf.** That changes
  §4 and §11 to make a test pass, which is a product decision nobody has made.
- **Submit as the seeded `student` for Student A.** That puts one shared student under four
  parallel tests and every local re-run, so the overlap rule would chain the tests together.
  Student A also has no enrolment. The guardian keeps run-unique students and covers §11's
  "linked guardian" half, which nothing else covers live.
- **Re-land the rebuilt home.** Feature work the user deferred (2026-10-28).
- **Delete or `test.skip` the stale specs.** Stop rule 2.
- **Restore `/students/new` and `/students/{id}` routes.** The stepper and sheet are the
  shipped design, and routes only the test uses would be dead product code.
- **Admission through the detail sheet's tabs instead of the wizard's steps.** The
  wizard's steps are the shipped create journey and the recipe already in deferred-work.
  The sheet is still used for the approver's and requester's re-access.

## Verification

- CI on the PR: `api` (the seed tests), and `frontend`'s mocked Playwright, because
  `StudentDetailPage` and `DashboardPage` are shared with the mocked gate.
- Dispatch `e2e-live` on the branch (`gh workflow run e2e-live.yml --ref <branch>`). The
  target is 56 passed and 0 failed. No local runs (ADR-0007).

## Independent review

- **Reviewer:** plan-reviewer agent, 2026-10-28
- **Verdict:** REVISE. The cause of each spec's first failure is proven, but the plan
  assumed the later steps work, and several do not: the admission spec's detail-page steps
  2-9, the leave auto-mark, the leave self-approve test, and the dashboard assertions.
- **Findings addressed:** all 11 are folded in above.
  - **Admission:** rewritten to the deferred-work recipe (wizard steps, directory-row
    re-access, `SecondIdentity.studentsPage`, a sheet-aware `StudentDetailPage`, retiring
    `StudentFormPage` and `goto`).
  - **Leave, auto-mark:** the approve test enrols in `todaysSession`.
  - **Leave, self-approve:** that test becomes a guardian 403, and the 422 rule is left to
    `test_leave.py:291`.
  - **Leave, submitter:** the root-cause table now names the school_owner. The admin key
    removal is reframed as matching §4, three stale comments are fixed, and the guardian
    cancels.
  - **Dashboard:** content-bearing, strict-safe assertions with no `role=alert` count, and
    locators in `DashboardPage`.
  - **Docs:** both deferred entries are closed and project-status is updated.
  - **The rest:** the `is_current` flake note, the guardian seed fields and lookup key,
    reuse of `addStudentButton`, the stated login budget, and L17 extended instead of a new
    lesson.
- **Unresolved:** none.
  - (1) Admission goes through the wizard's steps, which is the recipe; the sheet is used
    for re-access.
  - (2) The self-approve test is the guardian 403.
  - (3) No product change on the dashboard: count-aware locators, not new labels.
