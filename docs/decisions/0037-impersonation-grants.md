# 0037. Impersonation is a revocable grant behind an access-only token, checked on every request

- **Status:** Accepted
- **Date:** 2026-11-28
- **Enforced by:** `apps/api/apps/platform_admin/tests/test_impersonation.py` (`test_released_grant_rejects_token_before_exp`, `test_holder_losing_key_ends_session`, `test_expired_grant_rejects_token`, `test_grant_id_without_checker_is_401`, `test_handoff_code_single_use`, `test_handoff_code_expires_before_grant`, `test_handoff_code_is_stored_hashed`, `test_the_token_cannot_be_refreshed`, `test_impersonated_token_cannot_reach_platform_routes`, `test_cannot_impersonate_platform_user`, `test_target_permissions_apply_not_operator`, `test_impersonated_mutation_audit_has_impersonated_by`, `test_impersonated_password_change_forbidden`, `test_logout_releases_grant`); the partial unique index `impersonation_grants_one_open_per_pair` (platform_admin migration 0004)

## Context

Platform support must be able to act as a school user to reproduce a problem
([`platform-admin.md`](../03-modules/platform-admin.md) §7.3): time-boxed (≤ 1 h), with a reason,
a banner, the target's own permissions, and every action tagged `impersonated_by`. Access tokens
are stateless JWTs (15 minutes) with a rotating refresh token (30 days), and the dashboard runs
on each school's own subdomain, while the console runs on the bare host. A session must stop the
moment the grant is released or the operator loses the right to hold it. Decided in plan
`docs/superpowers/plans/2026-11-15-platform-admin.md` (PR E).

## Decision

1. **A grant is a platform-scope row** (`impersonation_grants`, `apps.platform_admin`): school,
   target user, holder, reason, `expires_at` (1 to `PLATFORM_IMPERSONATION_MAX_MINUTES`),
   `released_at` and `end_reason` (`released`, `revoked`, `superseded`, `expired`). Platform scope,
   so the authenticator reads it before any school is bound. A new grant by the same holder for
   the same person releases the previous one (`superseded`); the holder's row lock serialises
   two requests, and a partial unique index is the backstop. Only an active, non-platform user of
   an operational school can be the target; a platform user never can, so grants cannot chain.
2. **The handoff is an authorisation code (RFC 6749 §4.1.2 style).** `:impersonate` returns
   `handoff_url = account_link(tenant, "/impersonate", code=raw)`, the ADR-0033 fragment link.
   `raw` is `secrets.token_urlsafe(32)`; only its SHA-256 is stored. It expires after
   `PLATFORM_HANDOFF_CODE_TTL_SECONDS` (never after the grant) and is spent by one conditional
   `UPDATE … WHERE handoff_used_at IS NULL`. `POST /auth/impersonation:exchange` trades it for
   `{access, expires_in}`; every unusable code is the same 400 `invalid_link`, audited.
3. **The token is an access token only.** `sub` is the target, `tenant_id` its school,
   `is_platform=false`, `act={"sub": operator}` (RFC 8693), `grant_id`, `amr=["impersonation"]`
   and `exp = grant.expires_at`. No refresh token or cookie is issued, so nothing outlives the
   grant, and the console gate (`IsPlatformPrincipal`) 404s it as any school token.
4. **SimpleJWT's documented extension point re-checks the grant on every request.**
   `core.rbac.authentication.ImpersonationAwareJWTAuthentication` subclasses `JWTAuthentication`.
   For a token carrying `grant_id` or the impersonation `amr`, it asks the checker
   `apps.platform_admin` registers through `core.rbac.impersonation` (ADR-0013: core never
   imports the app). The grant must be unreleased and unexpired, for exactly this user and
   operator; the school operational; the holder active, a platform user with MFA on and still
   holding `platform.tenant.impersonate`. Anything else, and no registered checker at all, is a
   401 `impersonation_ended`. On success it sets `request.impersonated_by`, which `record_audit`
   and `record_security_event` write to `audit_logs.impersonated_by`.
5. **The target's permissions apply, never the operator's.** The request is the target user's;
   RBAC, record scope and the restricted-principal rules run unchanged. A student or guardian
   can be impersonated, and stays restricted. The account's own credentials are off limits:
   `change-password` and `/auth/mfa:enroll|confirm|disable` answer 403 `impersonation_forbidden`.
6. **Ending.** `POST /auth/impersonation:end`, logout under impersonation (which leaves the
   refresh cookie alone), and `DELETE /platform/impersonation-grants/{id}` by the holder release
   the grant; a `platform_super_admin` revokes another operator's. A sweep every five minutes
   records each expiry. Every grant, exchange, release, revocation, supersession and expiry is a
   security event, and a start or end tells the school's owners in-app (`platform.impersonation`).

## Alternatives considered

1. **Issue the target's normal access and refresh pair.** Why not: a refresh token outlives the
   grant, and a JWT cannot be recalled, so a released grant would keep working for 30 days.
2. **A cookie set across subdomains.** Why not: web-only (invariant 7), and a shared parent-domain
   cookie would reach every school's subdomain.
3. **Check the grant only at exchange and rely on a short `exp`.** Why not: Review Focus 2 needs a
   release, or a holder losing the key, to take effect on the next request, not at expiry.
4. **A token denylist instead of a grant lookup.** Why not: it answers "was this token revoked?",
   not "may this operator still hold it?"; the holder checks would still need the grant.
5. **`Idempotency-Key` on `:impersonate`.** Why not: the replay record stores the response, so it
   would store the raw handoff code. A retry makes a new grant, which supersedes the first.

## Consequences

- Every impersonated request costs one indexed grant read plus the holder's cached keys.
- A deployment without `apps.platform_admin` refuses every impersonation token (fail closed).
- Reloading the impersonated tab loses the in-memory token; the operator starts a new grant,
  which supersedes the old one.
- The tenant-visible impersonation log is deferred (`docs/deferred-work.md`); owners get the
  in-app notice instead.
