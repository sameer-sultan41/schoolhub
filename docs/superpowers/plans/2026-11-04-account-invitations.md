# Account Invitations and Parent-Portal Gaps: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans. Steps use `- [ ]` checkboxes. One implementer pass per task, then one
> `change-reviewer` pass and one fix pass per PR. **Never run tests, linters or typechecks locally**
> (root `AGENTS.md`, ADR-0007): commit, push, read `gh pr checks <n> --watch` /
> `gh run view <id> --log-failed`. Regenerate `apps/api/openapi.yaml` and
> `packages/api-client/src/schema.d.ts` with the generators, never by hand (L2). Every subagent brief
> carries these overrides plus `docs/07-quality/agent-lessons.md` §2 (L11). Load `schoolhub-backend-module`,
> `schoolhub-testing`, `schoolhub-api-services` and `schoolhub-dashboard-screen` as each task touches them.

**Work tier:** 2

**Goal:** Schools invite staff, guardians and students by email; each sets their own password, and anyone
can reset a forgotten one. Guardians can then do the portal jobs that PR #156 leaves out: submit and cancel
leave with an attachment, attach files to messages, download fee vouchers, change their password, and
download admit cards.

**Relation to PR #156 (user decision, 2026-11-04: build on it).** PR #156 (`feat/parent-portal-api`) and its
planned stacked PR 2 (`feat/parent-portal-dashboard`) own the portal itself: `apps/parent_portal`, the
summary, the inbox, portal notices, `/timetables/my?student_id=`, `is_restricted_principal` on `/auth/me`,
`core/rbac/roles.py` (`PORTAL_ROLES`, `ALL_TENANT_ROLES`), `downloadBlob`, the portal shell and the home,
attendance, fees, results, timetable, messages, notices, inbox and preferences screens. This plan rebuilds
none of that. It implements what #156's plan defers to a later phase: account onboarding (its deferred-work
entry, using the approach its ruling chose: stateful invitations), guardian uploads and leave, vouchers,
change password, and admit cards.

**Architecture:** One shared invitation flow in `core/rbac`: an `invitations` table holding a hashed,
single-use, 72-hour token. Password reset uses Django's `PasswordResetTokenGenerator` (a subclass with its
own `key_salt`, one-hour expiry). Both emails go through the email adapter directly from a Celery task, never
through `notify()` (ADR-0033, new). Staff `:invite` adopts the flow; `guardians/{id}:invite` and
`students/{id}:invite` are added. Portal gaps reuse the owning modules' endpoints (`PORTAL_READABLE_ACTIONS`
+ `get_permissions`) and #156's dashboard.

| PR | Branch | Base | Ships |
| -- | ------ | ---- | ----- |
| A | `feat/account-invitations` | `main` if #156 has merged, else `feat/parent-portal-api` (retarget after merge) | Invitations, accept, password reset, staff/guardian/student invites, deactivation on revocation; dashboard pages and invite buttons |
| B | `feat/portal-leave-vouchers` | `feat/parent-portal-dashboard` (#156 PR 2) once pushed, else `main` after both merge | Guardian uploads, leave submit/cancel with attachment, thread-attachment ownership, voucher downloads, change password |
| C | `feat/portal-admit-cards` | `main` after #147, #149, #152, #154 and #156 PR 2 merge | Admit-card download in the portal; staff stamps hidden from portal result reads |

**Tech stack:** Django 6.1 + DRF, drf-spectacular, Celery; Next.js 16, TanStack Query, next-intl,
`@schoolhub/ui`; Playwright (mocked `dashboard` project + `live` lane).

**Spec:** `docs/03-modules/parent-portal.md` (§3, §4, §5.5 leave, §5.3 fees, §19 invitation-only);
`docs/02-architecture/auth-and-rbac.md`; `docs/02-architecture/notifications.md` §3, §5;
`docs/03-modules/{staff-management,student-management,attendance,fees-finance,examinations}.md` §4/§16/§20;
#156's plan (`origin/feat/parent-portal-api:docs/superpowers/plans/2026-11-04-parent-portal.md`, P4's
deferred-work list); ADR-0010, ADR-0013, ADR-0019, ADR-0021, ADR-0030, ADR-0031; OWASP Forgot Password
Cheat Sheet.

**Workspace:** another session uses this checkout (L21). Execute in a worktree:
`git worktree add ../schoolhub-invitations -b feat/account-invitations <base>` after `git fetch origin`.
**In-repo plan file:** PR A's first commit adds this plan, with its review block, as
`docs/superpowers/plans/2026-11-04-account-invitations.md` (not #156's `…-parent-portal.md`).

## Context

On `main`, nobody can get an account except through the seed. Staff `:invite`
(`apps/staff_management/staff/services/invite.py`) creates `User(is_active=False)` with an unusable password,
sends an in-app notification only, and raises `Conflict` if `user_id` is already set, so there is no resend
and no way to activate. `Guardian.user_id` and `Student.user_id` exist with no invite. There is no
forgot-password flow. #156 keeps `module.parent_portal` `default_enabled=False` for exactly this reason.

Portal gaps #156 defers and this plan builds: guardian thread and leave attachment upload
(`platform.file.create` is staff-only, `core/files/permissions.py`), leave submission screens, fee vouchers
(only receipts in #156's D2), change password, admit-card download. Still deferred (left in #156's list):
pay-now, notice attachments, library/transport, announcements, trend chart, combined calendar,
contact edits, locale, AI-PAR, an admin invitations list/revoke screen.

**User decisions (2026-11-02 and 2026-11-04):**
- build on #156; this plan is provisioning plus the remaining portal gaps;
- a staff email can never be a guardian's or student's login: the invite is a 409 asking for another address;
- when a guardian loses every portal-enabled link to an enrolled child, or a student withdraws, transfers out
  or graduates, the account is deactivated and pending invitations are revoked; re-inviting re-enables it;
- fees stay view-only (pay-now deferred); commit, push and PR approval granted for this phase.

## Alternatives considered (why not)

| Decision | Chosen | Rejected, and why |
| -------- | ------ | ----------------- |
| Invitation token | `invitations` table: SHA-256 hash of a 32-byte `secrets.token_urlsafe` token, 72 h expiry, single-use, rotated on resend (#156's ruling; GitHub/Slack/django-invitations pattern) | Django's stateless generator for invites: one timeout shared with reset, an invite token doubles as a reset token, and pending invites cannot be listed, audited or revoked except by a password-hash change. (#156's stated reason, "the generator refuses inactive users", is wrong: that filter lives in `PasswordResetForm`; the other reasons stand.) |
| Password-reset token | `PasswordResetTokenGenerator` subclass `ResetTokenGenerator` (`key_salt="schoolhub.password-reset"`), `PASSWORD_RESET_TIMEOUT=3600`: Django's documented mechanism, dies when the password changes | A reset table: state Django already derives from the password hash. |
| Activation gate | Only `POST /auth/invitations:accept` activates. Reset works only for `is_active=True` users | `User.invited_at` + reset link activates: a second meaning on one column, and the pending state has no expiry or audit. |
| Email delivery | Celery task on the `transactional` queue calls the email adapter directly; task args are ids only; the raw token is created inside the task and never persisted or passed through the broker (ADR-0033) | `notify()`: `Notification.body` and `DeliveryLog.body` persist the rendered link, readable by delivery-log viewers (school_admin, it_admin): account takeover. Passing the link as a task argument: the broker stores it. |
| Link host | Built from `PLATFORM_DOMAIN` (`<slug>.app.<PLATFORM_DOMAIN>`) plus new `DASHBOARD_URL_SCHEME` (default `https`) and `DASHBOARD_URL_PORT` (default empty; `dev.py` sets `http`/`3000`) | The request `Host` header: host-header poisoning (OWASP). A full `DASHBOARD_URL_TEMPLATE`: declares the domain twice. |
| Shared email (family, staff parent) | Any email already on a tenant user that is not this person's own user → 409 `email_in_use` (user decision for staff; same rule for guardians/students) | Linking to an existing user: a student invite on the guardian's email would make the guardian the student ("self" ownership); a staff account holding a restricted role is locked out of every staff endpoint. |
| Revocation | `sync_portal_account(user_id)` in `student_management`, called by the portal-access link update, withdrawal, transfer-out and graduation services: deactivates, revokes pending invitations, blacklists refresh tokens | Leaving the account active with no children (user chose deactivate); a nightly sweep: a window where access persists. |
| Portal uploads | `UploadPurposeSpec.portal_uploadable` allowlist (leave and thread attachments); `confirm` narrowed to `created_by`; `assert_file_usable(..., uploaded_by=)` used by leave **and** threads | Granting every purpose; checking ownership in leave only (threads have the same hole: `threads/services/post_message.py:89-102`). |
| Where this lives | Invitations and reset in `core/rbac` (users live there; staff, guardian, student all use it); guardian/student invite in a `student_management/portal_accounts/` resource package (ADR-0010) | `apps/parent_portal`: staff onboarding is not a portal concern. `student_management/services/portal_accounts.py`: collides with the existing `services.py` module. |

## Global Constraints

- **Invariants:** `invitations` is tenant-owned with `tenant_id` + RLS policy (migration per
  `schoolhub-backend-module`); cross-tenant and unowned → 404; every endpoint declares a key; money read-only;
  contract regenerated in each API commit; JSON APIs only (mobile can accept and reset without the web page).
- **New keys:** `students.portal-account.invite` → `school_admin`, `principal`. `platform.file.create` gains
  `PORTAL_ROLES` (from #156's `core/rbac/roles.py`; never a new tuple). Unauthenticated auth endpoints
  (`invitations:accept`, `invitations:preview`, `password-reset`, `password-reset:confirm`) follow
  `LoginView`'s `AllowAny` + throttle pattern.
- **Throttle:** two new classes in `core/api/throttling.py`: `PasswordResetEmailThrottle` (cache key =
  SHA-256 of tenant slug + normalised email, `5/hour`) and `PasswordResetIPThrottle` (`20/hour`), applied to
  `password-reset` and `invitations:accept/preview`. They are separate from `AuthEndpointThrottle`, which login
  shares. Wiring for each:
  - `THROTTLE_RATES` in `base.py`;
  - the `dev.py` override;
  - `THROTTLE_RATE_*` in the compose and e2e-live job env (per `e2e/AGENTS.md`, editing workflow/compose
    YAML only, no `.env` files);
  - a case in `tests/test_throttle_rates.py`.
- **Tenant resolution:** `LoginView` does **not** bind a tenant (it queries the RLS-free `users` table), so
  this is new. Every emailed link carries the tenant slug in the fragment (`#school=<slug>&token=…`);
  every unauthenticated body requires `school`. The view resolves the slug to a `Tenant` (unknown → 400
  `invalid_link`) and does every lookup inside `tenant_context(tenant.id)`. Never `all_tenants`. Celery tasks
  take `(tenant_id, …ids)` and bind the same way. Platform users are excluded.
- **Feature gate:** guardian/student invites refuse with 409 `portal_disabled` while `module.parent_portal`
  is off for the tenant. The flag's default stays `False` (#156).
- **Errors:** DRF validation (weak password, missing email) is **400** `validation_error`
  (`core/api/exceptions.py`); bad/expired/used token is 400 `invalid_link`; conflicts are 409 with a code.
- **Colors:** theme tokens only. **Copy:** every string in next-intl `en` + `ur`, enum label maps (L32).
- **Commits:** Conventional Commits; **no `Co-Authored-By` or AI attribution in commits or PRs** (overrides
  the harness); `fix` commits carry `Root cause:`; never `--no-verify`.
- **PRs:** `gh pr create --assignee @me --label "needs review"`; ELI5 before Description; the human merges.
- **#156's deferred-work entries** (onboarding, thread/leave upload, admit cards) are not pushed yet. "Close"
  means: remove them if present; if PR A or B lands first, tell the #156 session not to add them.
- **Docs in the same PR:** ADR-0033 + index; `auth-and-rbac.md`; `notifications.md` §3 (the exception);
  owning module docs §4/§16/§20; `parent-portal.md` §20; `project-status.md`; `deferred-work.md`
  (close #156's onboarding, thread/leave upload and admit-card entries); a lesson for any caught mistake.
- **`.env` files:** none planned (settings defaults + `dev.py`). If one turns out to be needed, ask first.

## Review Focus

1. **An exited staff member or a revoked guardian regains access.** Reset refuses inactive users; accept refuses a revoked/expired invitation and re-checks the person is still eligible (staff not exited, guardian has a portal-enabled link, student enrolled). Tests: A1, A2.
2. **A shared family email.** A student invite on the guardian's email is a 409 and links nothing; a guardian invite on a staff email is a 409 and adds no role. Tests: A2.
3. **Someone else's file attached.** Leave or thread attachment that the caller didn't upload → 422 on the attachment field. Tests: B1.
4. **Enumeration and timing.** Unknown, inactive and platform emails all get 204 and the same code path (the task does the lookup). Tests: A1.
5. **Staff invited before this ships.** An inactive staff user with an unusable password and no invitation can be re-sent an invite by `:invite`. Tests: A2.

---

# PR A: Account invitations and password reset

### Task A1: Backend: invitations, accept, password reset (`core/rbac`)

**Files:**
- Create:
  - `core/rbac/invitations/{__init__,services,serializers,views,tasks,eligibility}.py`;
  - `core/rbac/password_reset/{services,serializers,views,tasks,tokens}.py`;
  - `core/rbac/account_links.py`, `core/rbac/auth_emails.py`, `core/rbac/sessions.py`;
  - `docs/decisions/0033-account-invitations-and-auth-email.md`.
- What the new files hold:
  - `auth_emails.py`: platform-only subject and body templates rendered with `_substitute` semantics. It
    never goes through `templates.resolve()`, so a tenant can't override a security email.
  - `sessions.py`: `revoke_refresh_tokens(user_id)`.
- Modify:
  - `core/rbac/models.py`: `Invitation` lives **here** (flat app), plus the RLS migration;
  - `core/rbac/urls.py`;
  - `core/api/throttling.py` and the throttle wiring in Global Constraints;
  - `config/settings/{base,dev}.py`:
    - `DASHBOARD_URL_SCHEME`, `DASHBOARD_URL_PORT`, `PASSWORD_RESET_TIMEOUT=3600`;
    - a `CELERY_TASK_ROUTES` entry sending `core.rbac.*.tasks.*` to `transactional`;
  - `tests/test_celery_routing.py`.
- Before writing `revoke_refresh_tokens`, read the installed `rest_framework_simplejwt/serializers.py`
  (5.5.1). Confirm that a rotated refresh token gets an `OutstandingToken` row (`ROTATE_REFRESH_TOKENS=True`).
  If it doesn't, the helper must also cover rotated tokens; record which in ADR-0033.
- Test: `core/rbac/tests/{test_invitations,test_password_reset,test_invitations_cross_tenant,test_sessions}.py`.

**Interfaces — Produces:**
- `Invitation(tenant_id, user_id, kind: "staff"|"guardian"|"student", token_hash unique, expires_at,
  sent_at, accepted_at null, revoked_at null, created_by)`; `status` property: pending/accepted/revoked/expired.
- `Invitation` also has `send_failed_at`. Its `status` is one of pending, accepted, revoked, expired or
  send_failed.
- `create_invitation(*, user: User, kind: str, actor_id) -> Invitation`:
  - revokes the user's other pending invitations;
  - creates a new one with no hash yet;
  - enqueues `send_invitation_email.delay(tenant_id, invitation_id)` via `transaction.on_commit`.
- `send_invitation_email(tenant_id, invitation_id)`:
  - runs as a Celery task on the `transactional` queue;
  - binds the tenant, generates the raw token, stores its SHA-256 and `sent_at`;
  - emails `account_link(tenant, "/accept-invite", token=…)`;
  - retries transient SMTP errors up to 3 times (Celery `autoretry_for` <!-- cspell:disable-line -->); on final failure it sets `send_failed_at`;
  - records security events `auth.invitation.sent` and `auth.invitation.send_failed`.
- `revoke_pending_invitations(user_id) -> int`.
- `revoke_refresh_tokens(user_id) -> None` (`sessions.py`), used by reset, `sync_portal_account` and staff exit.
- `account_link(tenant, path: str, **fragment) -> str`: `<scheme>://<slug>.app.<PLATFORM_DOMAIN>[:port]<path>#school=<slug>&…`.
  The token sits in the **fragment**, so it never reaches the server or access logs.
- `POST /auth/invitations:preview {school, token}` → `{data: {email, school_name, expires_at}}`; invalid → 400 `invalid_link`.
- `POST /auth/invitations:accept {school, token, password}` → 204: validates password (Django validators), re-checks
  eligibility via a per-kind hook registry (`register_invitation_eligibility(kind, fn)`; staff registered in
  `staff_management`, guardian/student in `student_management` — no `core → apps` import), sets password,
  `is_active=True`, `accepted_at=now`, security event `auth.invitation.accepted`.
- `POST /auth/password-reset {school, email}` → 204 whenever the body is well-formed. `school` is
  required: the dashboard always has it on a tenant host, and the same email can exist at two schools.
  - An unknown `school` also gets a 204 and enqueues nothing.
  - A known `school` enqueues `send_password_reset_email.delay(tenant_id, email)` on every request, so
    timing is the same whether or not the email exists.
  - The task binds the tenant and looks for an active, non-platform user with that email. If it finds one,
    it emails `account_link(tenant, "/reset-password", uid=…, token=…)`; otherwise it does nothing.
- `POST /auth/password-reset:confirm {school, uid, token, new_password}` → 204: active user in this tenant only, sets
  password, blacklists outstanding refresh tokens, emails "your password was changed", event `auth.password.reset`.

- [ ] Failing tests:
  - `test_invitation_token_stored_hashed_and_link_emailed` (no `Notification`/`DeliveryLog` rows; raw token not in DB);
  - `test_accept_activates_and_sets_password`; `test_accept_twice_is_400_invalid_link`;
    `test_expired_invitation_is_400`; `test_resend_revokes_previous_token`;
  - `test_accept_refused_when_person_no_longer_eligible`;
  - `test_weak_password_is_400_validation_error`;
  - `test_reset_unknown_inactive_and_platform_email_all_204_no_email`;
  - `test_reset_confirm_refuses_inactive_user`; `test_reset_token_dies_after_use`;
  - `test_reset_blacklists_refresh_tokens_and_sends_changed_email`;
  - `test_revoke_refresh_tokens_covers_a_rotated_token` (refresh once, then revoke, then the rotated token is rejected);
  - `test_unknown_school_is_400_invalid_link` (accept/preview); `test_reset_unknown_school_is_204_no_task`;
  - `test_send_failure_marks_invitation_send_failed`;
  - `test_auth_email_ignores_tenant_template_override`;
  - `test_reset_throttled_per_email`;
  - `test_other_tenants_token_is_400` (cross-tenant).
- [ ] Implement, regenerate the contract, commit `feat(auth): account invitations and password reset`.

### Task A2: Backend: staff, guardian and student invites; deactivation on revocation

**Files:**
- Modify `apps/staff_management/staff/services/invite.py`. Every branch locks the staff row with
  `select_for_update`:
  - **Collision:** an email on another tenant user → 409 `email_in_use` (today it's an unhandled
    unique-constraint 500).
  - **No user:** create it, assign `role_ids`, `create_invitation(kind="staff")`.
  - **Linked user, inactive, unusable password** (invited, never accepted): resend. `role_ids` is ignored on
    a resend; roles change through role management.
  - **Linked user, inactive, usable password** (re-hired after exit; exit removed its `UserRole` rows):
    assign `role_ids`, then send a new invitation. Accept sets a fresh password.
  - **Linked user, active** → 409 `already_active`.
  - Keeps the in-app `staff.invited` notification.
- Modify `staff/services/exit.py`: add `revoke_pending_invitations` and `revoke_refresh_tokens`.
- Register the staff eligibility hook in `StaffManagementConfig.ready()` (ADR-0013 hook pattern). It
  requires that the staff member has not exited.
- Create `apps/student_management/portal_accounts/{__init__,services,serializers}.py` and the
  `student_management/permissions.py` key.
- Add the `:invite` actions to the **routed** viewsets in flat `student_management/views.py`
  (`GuardianViewSet`, `views.py:379`, and `StudentViewSet`). `config/api_v1.py` → `student_management/urls.py`
  routes these. `guardians/viewset.py`, `guardians/urls.py`, `student_guardians/services.py` and
  `transfers/services.py` are unrouted copies. Leave them unchanged and add a `deferred-work.md` entry to
  delete them.
- Revocation call sites, each calling `sync_portal_account(user_id)`:
  - **The `has_portal_access` change.** Today `PATCH /student-guardians/{id}` falls to a plain
    `perform_update` save (`views.py:412-466`). Route it through a new flat `services.update_guardian_link`.
  - **Withdrawal:** `services.withdraw_student` (`services.py:676`).
  - **Transfer-out:** the flat transfer service that sets `TRANSFERRED_OUT` (`services.py:898`).
  - **Graduation:** `academics/promotions/services.py:633`, which calls a `student_management.services`
    function (allowed by ADR-0013).
  - Guardian delete and link delete don't exist yet. A `deferred-work.md` note says they must call
    `sync_portal_account` when they're built.
- Guardian eligibility: at least one link with `has_portal_access=True` to a student whose status is
  enrolled/active. Student eligibility: the student is enrolled/active. A guardian with two children keeps
  their account when one withdraws.
- Guardian and student serializers gain `portal_status`, annotated with a subquery on `users` + `invitations`.
- Test: `student_management/tests/{test_portal_invite,test_portal_revocation}.py`,
  `staff_management/tests/test_invite.py` (updated), `academics/tests/test_promotion_portal.py`.

**Interfaces — Produces:**
- `invite_to_portal(*, person: Guardian | Student, actor_id) -> User` (locks `person` with `select_for_update`):
  - `module.parent_portal` off → 409 `portal_disabled`;
  - no email → 400 on `email`;
  - email on any tenant user other than `person.user_id` → 409 `email_in_use` ("This email belongs to another account. Use a different address.");
  - guardian with no portal-enabled link / student not enrolled → 409 `not_eligible`;
  - linked user active → 409 `already_active`; linked user inactive → new invitation (re-enable);
  - otherwise create `User(is_active=False, unusable password)`, assign `guardian`/`student` role, set `person.user_id`, `create_invitation`.
- `sync_portal_account(user_id) -> None`: if the user's person is no longer eligible → `is_active=False`,
  `revoke_pending_invitations`, blacklist refresh tokens, event `auth.account.deactivated`. Never reactivates.
- `POST /guardians/{id}:invite`, `POST /students/{id}:invite` → `{data: {portal_status}}`.
- `portal_status: "none" | "invited" | "expired" | "send_failed" | "active" | "inactive"`. In the dashboard, `expired`
  and `send_failed` show "Resend invitation" copy.

- [ ] Failing tests:
  - `test_invite_guardian_creates_pending_user_with_guardian_role`;
  - `test_student_invite_with_guardians_email_is_409_and_links_nothing`;
  - `test_guardian_invite_with_staff_email_is_409_and_adds_no_role`;
  - `test_invite_when_portal_disabled_is_409`; `test_invite_active_is_409`; `test_reinvite_pending_resends`;
  - `test_teacher_cannot_invite` (403); `test_foreign_guardian_invite_is_404`;
  - `test_revoking_last_portal_link_deactivates_and_revokes_invites`; `test_second_link_keeps_account_active`;
  - `test_student_withdrawal_deactivates`; `test_student_transfer_out_deactivates`;
    `test_graduation_deactivates`; `test_guardian_keeps_account_when_one_of_two_children_withdraws`;
    `test_reinvite_after_deactivation_reenables_on_accept`;
  - `test_concurrent_invites_create_one_user` (fails without the row lock, L30);
  - staff: `test_invite_existing_pending_staff_resends_ignoring_role_ids`, `test_staff_invite_on_guardian_email_is_409`,
    `test_rehired_staff_reinvite_assigns_roles`, `test_exit_revokes_pending_invitation_and_tokens`;
  - `test_portal_status_list_query_count_constant`.
- [ ] Implement, regenerate the contract, commit `feat(accounts): invite staff, guardians and students by email`.

### Task A3: Dashboard pages and buttons; E2E, docs, PR A

**Files:**
- Create:
  - `app/(auth)/accept-invite/page.tsx` (metadata `referrer: "no-referrer"`);
  - `features/auth/accept-invite-form.tsx`;
  - `features/students/portal-invite-button.tsx`.
- Modify:
  - **Existing pages:** `app/(auth)/{forgot-password,reset-password}/page.tsx` and their forms, if present;
    `Paths.FORGOT_PASSWORD`/`RESET_PASSWORD`, their `PUBLIC_PATHS` and the login link already exist
    (`paths.ts:19,50-51`, `login-form.tsx:141`). Wire them to the new API and add `no-referrer`.
  - **Auth services:** `services/modules/auth/*` (`previewInvitation`, `acceptInvitation`,
    `requestPasswordReset`, `confirmPasswordReset`).
  - **Invite services:** `services/modules/{guardians,students}/*` (`invite`).
  - **Staff invite button:** resend label when pending, expired or send_failed.
  - **Routing:** `endpoints.ts`, `config/paths.ts` (`ACCEPT_INVITE` only), `proxy.ts` `PUBLIC_PATHS`
    (`ACCEPT_INVITE`).
  - **Rest:** the student detail guardians tab, i18n.
- Behaviour:
  - **Reading the link:** token pages read `school` and `token` from the URL **fragment** once, then
    `history.replaceState` clears it.
  - **Forgot-password:** the form sends `school` from `parseTenantSlug` (host).
  - **Success:** `/login` with a toast.
  - **`invalid_link`:** an explanation and "Ask your school to resend".
- E2E:
  - **Mocked:** `e2e/tests/dashboard/account-invitations.spec.ts` (accept, invalid link, forgot/reset, admin
    invites a guardian).
  - **Live:** `e2e/tests/live/api/account-invitations.spec.ts` (unknown email 204, bad token 400, cross-tenant
    token 400).
  - **The full email journey stays backend-tested only.** `dev.py` hard-codes the console email backend, so
    the live stack never reaches Mailpit. Changing that is env config, so this plan doesn't do it. Add a
    `deferred-work.md` entry: env-driven `EMAIL_BACKEND` + a Mailpit live journey.
- Docs: ADR-0033 + index, `auth-and-rbac.md`, `notifications.md` §3, `staff-management.md` and
  `student-management.md` §4/§16/§20, `parent-portal.md` §20 (onboarding built), `project-status.md`,
  `deferred-work.md` (close onboarding; add admin invitations list/revoke screen, SSO, student username login,
  staff-who-is-a-parent second-account merge), this plan.

- [ ] Jest: each form's validation, `invalid_link` state, success redirect, token stripped from the URL;
  invite button hidden without the key, badge per `portal_status`.
- [ ] Commit → `change-reviewer` with this plan → fix → push → open PR A → CI → reply on every thread → dispatch `e2e-live`.

# PR B: Guardian uploads, leave, vouchers, change password

Starts when #156 PR 2 (`feat/parent-portal-dashboard`) is pushed; uses its shell, `[studentId]` routes, `downloadBlob`/`saveBlob` and services.

### Task B1: Backend: portal uploads and attachment ownership

**Files:**
- Modify: `core/files/purposes.py` (`UploadPurposeSpec.portal_uploadable: bool = False`),
  `core/files/permissions.py` (`platform.file.create` + `PORTAL_ROLES`; fix the "staff roles only" docstring),
  `core/files/views.py` (`get_permissions`: restricted principals may `create`/`confirm`; non-portal purpose →
  422 on `purpose`; `confirm` queryset narrowed to `created_by=user`), `core/files/services.py`
  (`assert_file_usable(..., uploaded_by: UUID | None = None, field: str = "non_field")`, so callers get the
  error on `attachment_file_id` / `attachment_file_ids`), `apps/attendance/uploads.py` and
  `apps/communication/uploads.py` (`portal_uploadable=True`), the leave create service and
  `threads/services/post_message.py` (pass `uploaded_by=request.user.pk` for restricted principals).
  Leave and vouchers are already portal-readable/creatable and `LeaveRequestFilterSet` already has
  `student_id` (reviewer-verified), so no change there.
- Test: `core/files/tests/test_portal_uploads.py`, `attendance/tests/test_leave_portal.py`,
  `communication/tests/test_thread_attachment_ownership.py`.

- [ ] Failing tests: `test_guardian_creates_leave_attachment_upload`; `test_guardian_cannot_upload_other_purpose` (422);
  `test_guardian_cannot_confirm_others_file` (404); `test_leave_with_someone_elses_file_is_422`;
  `test_thread_message_with_someone_elses_file_is_422`; `test_guardian_leave_for_unowned_student_is_404`.
- [ ] Implement, regenerate the contract, commit `feat(portal): guardian uploads with ownership checks`.

### Task B2: Dashboard: leave, vouchers, change password; E2E, docs, PR B

**Files:**
- Create: `app/(portal)/portal/[studentId]/leave/page.tsx`, `features/portal/leave/{leave-list,new-leave-dialog}.tsx`,
  `features/portal/fees/voucher-list.tsx`, `features/portal/preferences/change-password-form.tsx`.
- Modify: #156's fees screen (vouchers per open invoice via `downloadBlob("/vouchers/{id}/download?format=pdf")`;
  empty state "Ask the school office for a voucher"), #156's preferences screen (change-password section via
  `/auth/change-password`), #156's messages composer (attachment upload in portal mode), portal nav (Leave),
  services `leave-requests`, `leave-types`, `files`, `vouchers`, i18n.
- Leave: list `GET /leave-requests?student_id=`; dialog with type, dates, half-day, reason, attachment when the
  type requires one; Cancel on pending.
- E2E: mocked `portal-leave-vouchers.spec.ts`; live `tests/live/api/portal-leave.spec.ts` (guardian uploads,
  submits and cancels leave for their child; another child → 404; voucher list for own invoice).
- Docs: `attendance.md` §20, `fees-finance.md` §20, `communication.md` §20, `parent-portal.md` §20,
  `project-status.md`, `deferred-work.md` (close thread/leave upload; add guardian re-download of own leave attachment).

- [ ] Jest: dialog requires an attachment when `requires_attachment`; server 422 shown on the field; voucher
  empty state; download calls `downloadBlob`; change-password validation.
- [ ] Commit → `change-reviewer` → fix → open PR B → CI → replies → `e2e-live`.

# PR C: Admit cards (after #147, #149, #152, #154 and #156 PR 2 merge)

### Task C1: Backend + dashboard

- Backend: test `test_guardian_admit_card_download_own_only` (another child → 404); make the admit-card
  `:download` portal-readable if it isn't on the merged code.
- Staff stamps (`processed_by`, `approved_by` and names) in portal result reads are a #154 serializer leak
  (`examinations/serializers.py:740-767` on `feat/exams-results`). Before PR A ships, post a review comment on
  #154 asking for it to be fixed there; PR C does not carry it.
- Dashboard: admit-card download on #156's results screen during an exam window.
- Docs: `examinations.md` §20, `parent-portal.md` §20, `deferred-work.md` (close admit-card entry), `project-status.md`.
- [ ] Commit `feat(examinations): portal admit-card download` → PR flow.

## Verification

- **Per PR:** CI green (`api`, `frontend` incl. coverage ratchet, `repo-hygiene`); `e2e-live` dispatched and
  cited; every review thread replied to and resolved.
- **End to end on the compose stack (`infra/scripts/seed-dev.sh`; emails print to the API container log,
  because `dev.py` uses the console backend):**
  1. School admin enables `module.parent_portal`, invites a guardian; the logged email has a 72 h link with the token in the fragment; no notification row holds it.
  2. Guardian accepts, sets a password, lands on `/portal`; reusing the link fails.
  3. Forgot password → reset → old refresh token rejected → "password changed" email.
  4. Guardian submits leave with an attachment, downloads a voucher, changes their password.
  5. Admin turns off the guardian's last portal link → the guardian's next request is 401; re-invite → accept → access back.
  6. A teacher's email used for a guardian invite → 409.
- **After code changes:** `graphify update .` if `graphify-out/` exists in the worktree.

## Independent review

- **Reviewer:** plan-reviewer agent, 2026-11-04
- **Verdict:** REVISE. The approach holds, but guardian `:invite` targeted the unrouted `guardians/viewset.py`;
  the revocation call sites were wrong or missing (no guardian or link delete exists; the `has_portal_access`
  PATCH is a plain save; transfer-out and graduation were unhooked); and accept, preview and confirm had no
  tenant to bind under RLS, because `LoginView` doesn't resolve one.
  - The first round's RETHINK was about duplicating PR #156. The user resolved it by choosing to build on #156,
    and the plan was rewritten.
- **Findings addressed:**
  1. **Routing:** `:invite` goes on the routed flat `views.py` `GuardianViewSet`/`StudentViewSet`. The unrouted
     package copies are left unchanged, with a deferred entry to delete them.
  2. **Revocation call sites:**
     - `has_portal_access` changes go through a new `update_guardian_link` service;
     - withdrawal, transfer-out and graduation are hooked, each with a test;
     - guardian and link deletes don't exist, so they're documented as future call sites;
     - eligibility means "enrolled child".
  3. **Tenant binding:** the tenant slug is in every link's fragment and `school` is required in every
     unauthenticated body. Lookups run inside `tenant_context`, and tasks take `tenant_id`. The "as LoginView"
     wording is removed.
  4. **Mailpit:** the email journey stays backend-tested only, because `dev.py` uses the console backend.
     There is no env change and the deferred entry is added. Verification reads the API log.
  5. **Staff invite:** gains the `email_in_use` 409, a resend that ignores `role_ids`, and a re-hired-staff
     branch; each has a test.
  6. **Throttles:** two classes in `core/api/throttling.py`, with every wiring file listed and a hashed email key.
  7. **Refresh tokens:** `revoke_refresh_tokens` is a single helper, written after checking how simplejwt
     5.5.1 handles rotated tokens, with a rotated-token test.
  8. **Reset scope:** `school` is required on password reset; an unknown school gets a 204 and no task.
  9. **Auth emails:** platform-only templates outside `templates.resolve()`, with a test.
  10. **Celery routing:** `CELERY_TASK_ROUTES` entry plus a routing test.
  11. **Existing pages:** the forgot/reset paths and the login link are reused; only `ACCEPT_INVITE` is new.
  12. **Concurrent invites:** `select_for_update`, with a concurrent-invite test (L30).
  13. **Statuses:** `expired` and `send_failed` added to `portal_status`, with resend copy.
  14. **Model location:** `Invitation` lives in `core/rbac/models.py`.
  15. **Error field:** `assert_file_usable(field=)`.
  16. **#156 deferred entries:** "close" is defined as removing them if present, or coordinating with #156.
  17. **Token placement:** the token is in the URL fragment.
  - **PR C:** the stamp leak goes to #154 as a review comment, not into PR C.
- **Unresolved:**
  - **#156's rule, not this plan's:** whether a guardian still sees a withdrawn, transferred or graduated child
    while other children keep the account active. `Student.filter_owned_by_user` governs it; it's flagged to
    the #156 session.
  - **Mailpit:** an env-driven `EMAIL_BACKEND` so the live lane can read Mailpit needs the user's go-ahead
    (`.env` rule); it's deferred until then.

## Execution rulings

Decisions taken while executing PR A, where the plan was silent, ambiguous or overtaken. Each
names its cost if wrong. From the execution ledger.

1. **Invitation status values.** The plan listed them twice; the later list wins: pending,
   accepted, revoked, expired, send_failed. Cost: one enum value.
2. **Accepting for a person no longer eligible** is the same 400 `invalid_link` as any other
   unusable link, so an anonymous caller learns nothing. Cost: less specific copy.
3. **Forgot/reset pages "if present".** They were not; A3 created them on the existing
   `Paths.FORGOT_PASSWORD`/`RESET_PASSWORD` and `PUBLIC_PATHS` entries.
4. **No local test, lint or typecheck runs** (ADR-0007 and the user's rule override the SDD
   template's "run tests"). CI on the draft PR is the evidence. Cost: a slower red/green loop.
5. **Throttle env overrides held back.** The `dev.py` `THROTTLE_RATE_*` reads, compose,
   e2e-live job env and `.env.example` wiring wait for the user's OK on `.env.example`; the fixed
   rates apply everywhere (patch kept as `task-A1-throttle-env.patch` in the SDD folder). Cost:
   live and dev runs could hit the reset throttle.
6. **A third throttle.** Invitation preview and accept get their own `invitation_ip` bucket
   (60/hour); reset request and confirm keep `password_reset_ip` (20/hour); the per-email reset
   throttle is unchanged. Onboarding behind a school's NAT must not starve, and a reset burst
   must not block invites (ADR-0033 §8). Cost: a looser IP bound on 256-bit tokens (negligible).
7. **A1 review minors.** Locking the user row in `create_invitation`, `select_for_update` on
   reset confirm, `OSError` among the transient send errors and public OpenAPI descriptions were
   folded into fix round 1; an anonymous actor on accept/reset audit events and
   no-notification-row tests for the reset emails were left to the final review.
8. **Eligibility.** A student is eligible while `active` with an active enrollment; a guardian
   while they hold a `has_portal_access` link to an eligible student. Withdrawal, transfer-out
   and graduation all close the enrollment; promotions change nothing. Cost: an admitted but
   unenrolled student cannot be invited until enrolled.
9. **Student `:invite` takes a required `email`** (there is no `Student.email` column; it is
   stored only on the user); a guardian's comes from `Guardian.email` and the body is not
   accepted. Cost: an extra field on the student invite form.
10. **Re-hired staff branch** implemented as specified; its test sets the status directly, and
    `deferred-work.md` records that no API path re-hires. Cost: unreachable until re-hire exists.
11. **Invite 409 codes** are `Conflict` subclasses in `core/rbac/invitations/exceptions.py`, left
    out of `API_ERROR_CODES` (the `audience_changed` precedent); the dashboard maps them by
    string. Cost: the client cannot narrow on them by type.
12. **Suspended students** keep portal access until withdrawn: a `deferred-work.md` entry, no
    hook now, since nothing sets `suspended`.
13. **A2 review round 1 minors folded in:** `IntegrityError` → `email_in_use` (with the
    `Lower(email)` constraint deferred), `replay_or_execute` on the portal `:invite`, one lock
    order (revoke invitations before locking the user), the shared role helper and RBAC cache
    eviction after `bulk_create`. Cost: a larger fix diff.
14. **Staff `user_id` is read-only.** A writable link plus exit's new token and invitation
    revocation was the same lockout class as the guardian/student finding; exit now deactivates
    only a user linked to this staff row alone. Cost: the staff `user_id` edit flow is gone.
15. **Exit on a shared login** deletes only the staff (non-restricted) roles and evicts the RBAC
    caches: staff access ends, portal access stays. This overrides round 2's "never strips
    roles", which meant portal roles. Cost: a dual-role login loses its staff roles on exit
    (intended).
16. **A2 review round 3 minors folded in:** `deleted_at` filters in `is_portal_account`, no
    deleted role reused for a portal role, the residual deadlock risk stated in the lock-order
    comment, `updated_by` on unlink, `invite_staff` refusing a linked portal login with 409
    `email_in_use`, and dead `user_id` parameters dropped. Idempotency endpoint names without a
    pk are a pre-existing pattern, deferred.
17. **CI failures after review** go back to the task's implementer as a CI-fix round outside
    the five-round review cap.
