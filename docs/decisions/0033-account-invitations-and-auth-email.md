# 0033. Accounts activate through a hashed, single-use invitation; security emails bypass `notify()`

- **Status:** Accepted
- **Date:** 2026-11-05
- **Enforced by:** `apps/api/core/rbac/tests/test_invitations.py` (`test_invitation_token_stored_hashed_and_link_emailed`, `test_accept_refused_when_person_no_longer_eligible`, `test_send_failure_marks_invitation_send_failed`, `test_auth_email_ignores_tenant_template_override`); `core/rbac/tests/test_invitations_cross_tenant.py`; `core/rbac/tests/test_password_reset.py` (`test_reset_unknown_inactive_and_platform_email_all_204_no_email`, `test_reset_confirm_refuses_inactive_user`, `test_reset_throttled_per_email`); `core/rbac/tests/test_invitations.py`'s `test_reset_burst_does_not_throttle_invitation_accept` (the separate invitation throttle bucket); `core/rbac/tests/test_sessions.py` (`test_revoke_refresh_tokens_covers_a_rotated_token`); `core/rbac/tests/test_concurrency.py` (one pending invitation, one spend per reset link); `tests/test_celery_routing.py`; `tests/test_throttle_rates.py`; `tests/test_rls_coverage.py` (the `invitations` policy); the dashboard's `features/auth/__tests__/accept-invite-form.test.tsx` and `reset-password-form.test.tsx` (the token is cleared from the URL) and `src/__tests__/proxy.test.ts` (an emailed-link page is never redirected); `e2e/tests/live/api/account-invitations.spec.ts` (an unknown email is a 204, every unusable link the same `invalid_link`)

## Context

Until now nobody could get an account except through the seed: staff `:invite` created an
inactive user with an unusable password and no way to activate it, guardians and students had
no invite at all, and there was no forgotten-password flow. Accounts need a way to activate
and a way to recover, both by email, for staff, guardians and students alike, and both usable
from a future mobile app (Invariant 7). Decided in plan
[`docs/superpowers/plans/2026-11-04-account-invitations.md`](../superpowers/plans/2026-11-04-account-invitations.md).

## Decision

1. **Invitations are rows.** `invitations` (tenant-owned, RLS) holds one row per invitation:
   `kind` (`staff`, `guardian`, `student`), `token_hash`, `expires_at` (72 hours from the
   send), `sent_at`, `accepted_at`, `revoked_at`, `send_failed_at`. Its `status` is pending,
   accepted, revoked, expired or send_failed. A resend revokes the user's earlier pending
   invitations first, so only the newest link works.
2. **Only a hash is stored, and the raw token never leaves the send task.** The task mints a
   32-byte `secrets.token_urlsafe`, stores its SHA-256, and emails the link. Task arguments
   are ids only, so the broker never holds a token. A retry mints a new token and replaces
   the hash; a final send failure clears the hash and sets `send_failed_at`.
3. **Only accepting an invitation activates an account.** `POST /auth/invitations:accept`
   validates the password with Django's validators, re-checks that the person is still
   eligible through a per-kind hook (`core/rbac/invitations/eligibility.py`:
   `register_invitation_eligibility(kind, fn)`, registered by the owning apps; no hook means
   eligible), then sets the password, `is_active=True` and `accepted_at`. Every refusal
   (unknown school, unknown, used, revoked or expired token, ineligible person) is the same
   400 `invalid_link`.
4. **Password reset uses Django's documented generator.** `ResetTokenGenerator`
   (`key_salt="schoolhub.password-reset"`) with `PASSWORD_RESET_TIMEOUT=3600`. The token is
   an HMAC over the password hash, so it dies when the password changes. Reset works only for
   an active, non-platform member of the named school. `POST /auth/password-reset` answers 204
   to every well-formed body and, for a known school, always queues the task, which does the
   lookup: unknown, inactive and platform addresses take the same path as a real one. Confirm
   sets the password, revokes every refresh token and emails "your password was changed".
5. **Unauthenticated calls name their school.** The tenant slug travels in each link's
   fragment and in every request body (`school`). The view resolves it to an operational
   tenant (unknown → `invalid_link`; for a reset request, a silent 204) and runs every lookup
   inside `tenant_context(tenant.id)`; `users` has no RLS, so user lookups also filter on
   `tenant_id`. Tasks take `tenant_id` and bind it the same way. `all_tenants` is never used.
6. **Links come from settings, and the token sits in the fragment.**
   `<DASHBOARD_URL_SCHEME>://<slug>.app.<PLATFORM_DOMAIN>[:<DASHBOARD_URL_PORT>]<path>#school=<slug>&token=…`.
   Browsers never send a fragment, so the token stays out of access logs and `Referer`; the
   host never comes from the request's `Host` header. The dashboard page reads the fragment
   once and clears it with `history.replaceState`, so the token is not left in the address bar
   or history; the pages set a `no-referrer` policy; and the auth proxy never redirects a
   signed-in visitor off them, since a redirect would carry the fragment to the new URL.
7. **Security emails do not go through `notify()`.** They are platform-only templates in
   `core/rbac/auth_emails.py`, rendered with `NotificationTemplate.render` (the same literal
   substitution) and sent through the email adapter from a Celery task on the `transactional`
   queue (`core.rbac.*.tasks.*`). They are never registered in the template registry and never
   looked up through `templates.resolve()`, so no school can override them. Any `OSError` is
   retried three times: connection and timeout errors, and every SMTP error, since `smtplib`'s
   exceptions subclass it. That includes a permanent 5xx refusal, which costs three wasted
   attempts before `send_failed`; anything else (a template error, a bug) fails at once. The
   audit row for a final failure stores only the exception class and SMTP status code, because
   an SMTP error's message can carry the recipient's address.
8. **Three throttles of their own, none shared with login.**
   - `PasswordResetEmailThrottle` (5/hour, keyed on the SHA-256 of the school slug and the
     normalised email) guards the reset request.
   - `PasswordResetIPThrottle` (20/hour per IP) guards the reset request and its confirm.
   - `InvitationIPThrottle` (60/hour per IP) guards invitation preview and accept. It is
     roomier because a school onboards many people at once, often behind one school or
     mobile-carrier NAT, and onboarding must not starve. It is a separate bucket so a burst
     of reset requests from that address cannot block invite acceptance.

   None of them is `AuthEndpointThrottle`, so a burst here cannot lock a school out of login.
9. **Revoking sessions is one helper.** `core/rbac/sessions.py`'s
   `revoke_refresh_tokens(user_id)` blacklists every unexpired `OutstandingToken` of the user.
   It is used by reset, and by account deactivation, staff exit and staff delete.

### What simplejwt 5.5.1 does with rotated tokens

Checked in the installed source (`rest_framework_simplejwt/serializers.py` and `tokens.py`),
not from memory. `RefreshToken.for_user` (login) creates an `OutstandingToken` row. On
refresh, `TokenRefreshSerializer.validate` blacklists the submitted token
(`BLACKLIST_AFTER_ROTATION=True`), then sets a new `jti`, `exp` and `iat` and calls
`refresh.outstand()`, which `get_or_create`s an `OutstandingToken` row for the rotated token
with the user resolved from the `sub` claim. So **every rotated refresh token has its own
`OutstandingToken` row**, and blacklisting the user's rows covers the token they hold now,
however often it has rotated. The helper needs no extra handling for rotation;
`test_revoke_refresh_tokens_covers_a_rotated_token` pins it, so a library upgrade that stops
outstanding rotated tokens fails the build. Access tokens cannot be blacklisted: they live 15
minutes, and `JWTAuthentication` refuses an inactive user on every request.

## Alternatives considered

- **Django's stateless token generator for invitations too** — why not: one timeout shared
  with reset, an invitation token would double as a reset token, and a pending invitation
  could not be listed, audited or revoked except by changing the password hash.
- **A reset-token table** — why not: it stores state Django already derives from the password
  hash, and needs its own expiry and single-use bookkeeping.
- **Activating through the reset link (`User.invited_at`)** — why not: a second meaning on one
  column, and a pending state with no expiry or audit.
- **Sending through `notify()`** — why not: `Notification.body` and `DeliveryLog.body` persist
  the rendered link, which delivery-log viewers (school_admin, it_admin) can read. That is an
  account takeover. A tenant override could also rewrite the link.
- **Passing the link or token as a task argument** — why not: the broker stores it.
- **Building the link from the request's `Host` header** — why not: host-header poisoning
  (OWASP). A full `DASHBOARD_URL_TEMPLATE` setting — why not: it declares the domain twice.
- **Answering an unknown email with 404 or an unknown school with 400 on reset** — why not:
  it tells an anonymous caller who has an account where.

## Consequences

Any app that sends an invitation calls `create_invitation(user=..., kind=..., actor_id=...)`
and registers an eligibility hook for its kind; it never builds a link or sends the email
itself. A new security email goes in `auth_emails.py` and is sent from a task under
`core/rbac/*/tasks.py`, not through `notify()`; this is the only exception to
"every message goes through `notify()`" (notifications.md §3). Anything that deactivates an
account also calls `revoke_pending_invitations` and `revoke_refresh_tokens`. The emails are
English-only until `User` gains a locale, and they are not visible in the notification inbox
or delivery log, by design: the audit trail records `auth.invitation.sent`,
`auth.invitation.send_failed`, `auth.invitation.accepted` and `auth.password.reset` instead.

No migration seeds a tenant's `guardian` or `student` role, so the first portal invite at a
school creates it (restricted, holding the registry's keys for the slug, synced by
`core.rbac.seeding.sync_role_permissions`) unless the school or the platform already has a live
one. A soft-deleted role is never reused, which is why the lookup is local rather than
`ensure_role_with_permissions`, whose `get_or_create` ignores `deleted_at`.
