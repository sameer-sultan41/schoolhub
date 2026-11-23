# 0036. Platform roles hold scope-tagged keys; the console reads one school at a time, never past RLS

- **Status:** Accepted
- **Date:** 2026-11-16
- **Enforced by:** `apps/api/core/rbac/tests/test_platform_scope.py` (`test_tenant_principal_gets_404_on_platform_routes`, `test_platform_token_without_otp_amr_is_403_mfa_required`, `test_platform_support_cannot_provision`, `test_nested_route_binds_target_tenant`, `test_platform_role_refuses_tenant_user`, `test_every_console_key_is_platform_scoped`, `test_school_owner_gets_no_platform_key`, `test_sync_role_permissions_refuses_cross_scope_key`, `test_registry_refuses_a_default_role_of_the_other_scope`); `core/rbac/tests/test_default_role_sync.py`; `tests/test_role_permission_scope.py` (every `RolePermission` row); the `user_roles_match_principal_scope` trigger and the `roles_platform_has_no_tenant` check (rbac migration 0003); `tests/test_rls_coverage.py`; reading tenant data only through `PlatformTenantNestedMixin` is review only

## Context

The platform console ([`platform-admin.md`](../03-modules/platform-admin.md)) is the first code
that acts across schools: it provisions tenants, sells plans and reports on the fleet. Every
tenant table is isolated by RLS (invariant 1, [ADR-0003](0003-tenant-isolation-rls.md)), and the
console's keys (`platform.tenant.*`, `platform.plan.*`, …) share the `platform` module name with
the tenant-side `platform.file.*`, `platform.job.view` and `platform.notification.view`, which every
school's staff hold. `ensure_school_owner_role` granted `Permission.objects.all()`, so a console
key would have reached every school owner the moment it was registered. No production code
created any default role but `school_owner` either (the gap `deferred-work.md` recorded), so
provisioning a school would have left it with no `teacher` or `principal` to assign. Decided in
plan `docs/superpowers/plans/2026-11-15-platform-admin.md`.

## Decision

1. **Every permission key has a scope, `tenant` or `platform`.** `registry.register(...,
   scope="platform")` declares a console key, and `Permission.scope` stores it, written by the
   `post_migrate` sync. `register` refuses a default role of the other scope, so the mistake fails
   at import.
2. **Platform roles are their own kind.** `platform_super_admin` and `platform_support`
   (`PLATFORM_ROLES`) are `Role.is_platform` rows with no tenant (`roles_platform_has_no_tenant`).
   A role's `is_platform` must equal its holder's `User.is_platform`. A trigger on `user_roles`
   enforces that, so a `bulk_create` cannot bypass it either.
3. **Every grant path filters on scope.** `ensure_school_owner_role` grants every *tenant-scope*
   key. `sync_role_permissions` raises `ValueError` before writing a key of the other scope.
   `sync_default_roles` filters to the role's scope. A contract test scans every `RolePermission`
   row.
4. **Default roles are synced in production.** On `post_migrate`, after the keys,
   `sync_default_roles()` gives each slug in `ALL_TENANT_ROLES + PLATFORM_ROLES` one shared
   `tenant=None` row, holding `registry.keys_for_role(slug)` in its scope (`school_owner`: every
   tenant-scope key). It is additive only, like `sync_permissions`.
5. **Console routes live under `/api/v1/platform/` and are gated in this order:** a 401 for an
   anonymous caller; a **404** for any tenant principal, an impersonation token included (the
   route does not exist for a school, invariant 2's reasoning); a 403 `mfa_required` for a
   platform token without `"otp"` in its `amr` claim, or whose user's MFA is off (an
   operator reset with `--reset-mfa`); then the route's key (`PlatformViewSet`,
   `IsPlatformPrincipal`). A missing `amr` claim fails closed.
6. **One target school per platform request.** A route touching a school's rows is nested under
   `tenants/<tenant_pk>/`. `PlatformTenantNestedMixin` loads the tenant after authentication and
   the permission checks have passed, binds it for the whole request (`SET LOCAL` under
   `ATOMIC_REQUESTS`) and sets `request.tenant`. Its `run_idempotent` stores the replay record
   under that tenant. Fleet-wide views read platform tables only, and aggregates come from the
   per-tenant nightly visit.
7. **Operators are created by command only.** `create_platform_admin --email --first-name
   [--role]` prompts for the password and leaves `mfa_enabled=False`, so TOTP enrolment happens
   at first sign-in.
8. **The second factor is TOTP, built on `pyotp` in `core/rbac/mfa.py`.** Login answers an MFA
   user with a signed, short-lived challenge (`django.core.signing`, salted, `max_age`), not a
   session; `/auth/mfa:verify` trades it and a code for the token pair, whose `amr` claim
   (`["pwd","otp"]`) is what the console gate reads. The per-account failure count and lockout
   live on the `users` row, under its row lock, and only an operator lifts the lock at 100
   consecutive failures (NIST SP 800-63B §5.2.2).

## Alternatives considered

1. **Cross-tenant reads through a `BYPASSRLS` role, the unused `schoolhub_readonly` alias, or a
   policy clause for platform users.** Why not: any of them makes every school's rows readable
   from one connection, so one bug in a console view leaks every school's data.
   `infra/postgres/init/02-app-role.sql` refuses it. The per-tenant `for_each_tenant` visit writes
   aggregates to a platform table instead (multi-tenancy §8's separate read path). The cost is
   reports as fresh as the last run.
2. **Fleet-wide subscription lookups reading the RLS-bound `subscriptions` with no tenant
   bound.** Why not: that silently returns zero rows. A tenant id in the billing webhook's URL
   does not fit a SaaS provider's single platform endpoint, and making `subscriptions` a platform
   table contradicts the entity spec, under which the owner reads it through RLS. Denormalised
   platform-scope columns on `tenants` are written in the same transaction instead.
3. **A platform-scope `BackgroundJob` or `IdempotencyRecord` table.** Why not: premature. Every
   console action but `POST /tenants` targets one school, which owns the job and the replay
   record. `POST /tenants` is idempotent by its unique slug.
4. **Renaming the console keys to `platform_admin.*` to keep them apart from `platform.file.*`.**
   Why not: §4's keys are locked vocabulary, and no key actually collides. A `scope` on each key,
   a filter in every grant path and a contract test over every row separate them by meaning, not
   by spelling.
5. **`django-otp` or `django-allauth`'s MFA instead of `pyotp`.** Why not: both are built
   around Django sessions and their own device models and views, while every SchoolHub client,
   mobile included (invariant 7), authenticates with JWTs. Adopting either means a session
   step in a token flow or bypassing most of the package. `pyotp` is the RFC 6238 primitive
   (`verify_and_get_timecode` gives replay prevention), and the rest is a few hundred lines this
   repo owns and tests.
6. **A server-side session (or a cache entry) for the half-signed-in state, and a session flag
   for "passed MFA".** Why not: the API is stateless JWT; a session would be web-only and the
   cache evicts (`allkeys-lru`). A signed challenge needs no storage beyond its attempt counter,
   and the `amr` claim (RFC 8176) carries the second factor in the token every route already
   reads.
7. **The failure counter in Redis.** Why not: production Redis evicts keys, so an attacker who
   churns the cache resets their own count; and the row lock that serialises attempts for replay
   prevention already exists. The row makes the count durable and race-free.
8. **`core/tenancy/features.py` reading `Plan` directly.** Why not: `core` imports no app
   ([ADR-0013](0013-cross-app-dependencies.md)). `platform_admin` registers a resolver from
   `AppConfig.ready()`, as `communication` does with `core/notifications`.

## Consequences

- A new console key is `register(..., scope="platform")` and names platform roles only; a new
  tenant role slug joins `ALL_TENANT_ROLES` and is created on the next migrate.
- A platform user is never assignable to a school. Staff `:invite` cannot find a platform role
  among a school's roles (`_grantable_roles`), and `seed_all_roles` seeds no console login.
- A console route that reads a school's rows must use `PlatformTenantNestedMixin`. Nothing
  else binds a tenant for a platform user, and RLS returns no rows without one.
- The `tenant=None` default rows are shared by every school, so a release that adds a key to a
  default role gives it to every school at once, as `school_owner` always has.
- A school's own live role of a default slug wins over the shared `tenant=None` row wherever a
  role is looked up by slug (the portal invite, `_portal_role`). The shared rows are never
  school-editable: no school-facing endpoint writes a role, and a future role editor must
  create the school's own copy rather than change the shared row, which every school holds.
- The trigger checks a new or re-pointed assignment only. Flipping `is_platform` on a user or a
  role that already has assignments is not supported.
