# Platform Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans. Steps use `- [ ]` checkboxes. **Never run tests, linters or typechecks
> locally** (ADR-0007): commit, push, read CI. Regenerate `apps/api/openapi.yaml` and
> `packages/api-client/src/schema.d.ts` with the generators (L2) in **every** task that adds or changes an
> endpoint. No AI attribution in commits or PRs; `fix` commits carry `Root cause:`. Load
> `schoolhub-backend-module`, `schoolhub-testing`, `django-security` and `django-celery` for backend
> tasks, and `schoolhub-dashboard-screen` and `schoolhub-api-services` for dashboard tasks. Backend tests
> are Django `TestCase`/`APITestCase` classes (schoolhub-testing §Backend). The test names below are method
> names. Every subagent brief carries `docs/07-quality/agent-lessons.md` §2 (L11). `.env` files are never
> touched: new settings get a default in `config/settings/base.py` and a line in `apps/api/.env.example`.

**Work tier:** 2

**Goal:** A platform operator signs in to a platform console with password + TOTP. From there they can:
- provision a school with working default roles, and invite its owner;
- move the school through its lifecycle;
- sell it a plan that decides which modules it gets and how much it can use;
- override feature flags;
- read aggregate platform reports;
- support a school user through an audited, time-boxed impersonation.

Throughout, the app's database role never reads past one tenant's RLS boundary.

**Architecture:**
- **Platform scope in `core/rbac`:**
  - platform roles and scope-tagged permission keys;
  - a production `post_migrate` sync of every default role, platform and tenant;
  - TOTP MFA;
  - a `PlatformViewSet` base gated on `IsPlatformPrincipal` plus an MFA-verified token.
- **The module is a new app, `apps/platform_admin`.** It owns `Plan`, `Subscription`, `BillingEventReceipt`,
  `TenantUsageSnapshot` and `ImpersonationGrant`, the tenant lifecycle state machine, provisioning,
  dunning, quotas and reports.
- **`core/` never imports it (ADR-0013).** It plugs into core through registered hooks: plan-based feature
  enablement (at the step `core/tenancy/features.py:178` reserves), quota checks, a flag-toggle guard and
  the impersonation-grant checker.
- **Tenant data is touched only with one target tenant bound,** either a platform request's single target
  tenant, bound in `initial()` for reads and writes alike, or one tenant per step of the nightly
  `for_each_tenant` visit. The visit writes metrics-only `TenantUsageSnapshot` rows, which the platform
  reports read.
- **Platform-wide lookups need no tenant bound.** They read denormalised, platform-scope columns on
  `tenants` (`current_plan`, `subscription_status`, `billing_provider_ref`), which the subscription
  services write in the same transaction as the subscription row. No `BYPASSRLS` role or RLS exception
  is added.
- **Platform jobs and idempotency are attributed to the target tenant.** The existing tenant-bound
  `BackgroundJob` and `IdempotencyRecord` are reused unchanged.
- **Impersonation:**
  - a short-lived, single-use handoff code becomes a refresh-less access token tied to a revocable grant;
  - the grant and its holder are re-checked on every request;
  - a new grant for the same target releases the holder's previous one.

**Tech stack:** Django 6.1 + DRF, Celery beat, SimpleJWT, `pyotp` (TOTP, RFC 6238), PostgreSQL RLS;
Next.js 16 + TanStack Query in PRs D-E.

**Spec:**
- **Module:** `docs/03-modules/platform-admin.md` §4, §5, §7, §11, §12, §13, §16.
- **Entities:** `docs/05-database/entities/tenancy.md` (`tenants`, `plans`, `subscriptions`, `feature_flags`,
  `tenant_feature_overrides`, `users.mfa_*`, `audit_logs`).
- **Architecture:** `docs/02-architecture/multi-tenancy.md` §5-§8 and `docs/02-architecture/auth-and-rbac.md` §1
  (MFA, impersonation), §4 (audit).
- **Security:** `docs/06-security/security.md` SEC-06 (TOTP for platform roles at launch).
- **Roles:** `docs/00-overview/users-and-roles.md`.

**Spec conflict, flagged:** multi-tenancy §7 moves Provisioning → Trial when the onboarding wizard
completes. platform-admin §7.1 starts the trial at the owner invite. This plan follows the module doc, the more
specific of the two (docs/AGENTS.md rule 2): `:provision` moves the tenant to `trial`. Task 3 updates
multi-tenancy §7's diagram to match.

**ADR numbers:** #182 (`feat/ai-gateway`) already claims `0035-ai-gateway-shape.md`. This plan writes
**ADR-0036** (platform scope and cross-tenant access) and **ADR-0037** (impersonation grants). If #182
has not merged when PR A opens, check `docs/decisions/` on `main` and renumber both if needed.

**Base:** `main`; stacked branches `feat/platform-admin-scope` (PR A) → `feat/platform-admin-plans` (B) →
`feat/platform-admin-usage` (C) → `feat/platform-admin-console` (D) → `feat/platform-admin-impersonation` (E).

A second stack covers school setup and onboarding, which the Phase 2 exit ("onboard tenant → configure
academics/fees", `docs/01-phases/phase-2-core-build.md:107-110`) needs:
- `feat/school-setup` (PR F) is based on `main` and runs in parallel with A–E;
- `feat/school-setup-structure` (G) is based on F;
- `feat/onboarding-wizard` (H) is based on G and rebased onto `main` once PR A merges, because it lives in
  `apps/platform_admin`.

**Migration rule:** F/G add one `core/tenancy` migration. Whichever stack lands second rebases and renumbers
its own migration; never use a merge migration.

**Out of scope, each recorded in `docs/deferred-work.md` by the PR noted:**
- **`AI-PLA-03`, the onboarding assistant; contact details and address on the profile; and showing the logo on
  the public website (H).** `/public/tenants/by-host` does not exist in the API.
- **Legacy-data migration imports (C).** Schools already have the student and staff importers. Guardians,
  fee balances and marks history get their own plan.
- **Hard purge and the certificate of deletion (C).** Append-only tables revoke `DELETE` from the app role, so
  a purge needs a migrator-role job and an ADR.
- **A real billing provider (B).** Manual invoicing plus a fake adapter ship first, mirroring ADR-0034's
  PR 2 split.
- **SMS-credit and AI-token quotas (C).** The AI gateway is in review (#182). Only `students`, `staff` and
  `storage_gb` are enforced.
- **The owner's read-only billing login while suspended, and the website suspension notice (A).**
- **The platform-ops notification channel (B).** `notify()` is per tenant, so §12's copies to
  `platform_super_admin` and "platform ops" are deferred. v1 notifies school owners only.
- **MFA for tenant owners and admins, and per-tenant MFA enforcement (A).** v1 builds the shared TOTP
  machinery and enforces it for platform users only. Turning it on for tenant roles is a follow-up.
- **`TenantUsageSnapshot` retention (C),** and the tenant-visible impersonation log, percentage rollouts,
  proration and grandfathering (E/B; spec *recommendations*).

## Alternatives considered (why not)

1. **Cross-tenant reads through a `BYPASSRLS` role, the unused `schoolhub_readonly` alias, or an RLS policy
   clause for platform users.** Rejected. Any of them makes every tenant row readable from one connection,
   so a single bug in a platform view leaks schools' data. That breaks invariant 1, and
   `infra/postgres/init/02-app-role.sql` refuses it. Instead, the per-tenant `for_each_tenant` visit
   (`core/tenancy/maintenance.py:41`) writes aggregate counts to a platform table, the "separate read path"
   of multi-tenancy §8. It has one cost: reports are as fresh as the last nightly run, plus whatever an
   operator triggers with `:refresh-usage`.
2. **Platform-wide subscription lookups (the billing webhook, "is this plan in use?", "which tenants are
   over a new limit?").** Reading the RLS-bound `subscriptions` table with no tenant bound silently returns
   zero rows. Two options were rejected:
   - *a tenant id in the webhook URL, as ADR-0034 does:* a SaaS billing provider has one platform-level
     webhook endpoint, not one per school;
   - *making `subscriptions` a platform table:* the entity spec scopes it to the tenant, and the school owner
     reads it under RLS.

   Instead, three platform-scope columns on `tenants` are written with each subscription change, in one
   transaction: `current_plan`, `subscription_status` and `billing_provider_ref`. This is the standard
   denormalised read model; the subscription row stays the source of truth.
3. **A new platform-scope `BackgroundJob` or `IdempotencyRecord` table.** Rejected as premature
   (`core/jobs/models.py:6-12`). Every platform action except `POST /tenants` targets one tenant, which
   owns the job and the replay record. `POST /tenants` is idempotent by its unique slug instead.
4. **Renaming the console keys to `platform_admin.*` to avoid the tenant-side `platform.file.*`,
   `platform.job.view` and `platform.notification.view`.** Rejected. The spec's keys are locked vocabulary,
   and no key collides. Each key gets a `scope` instead; every grant path filters on it (including
   `ensure_school_owner_role`, which today grants `Permission.objects.all()`); and a contract test scans
   every `RolePermission` row.
5. **`core/tenancy/features.py` reading `Plan` directly.** Rejected by ADR-0013. Instead `platform_admin`
   registers a resolver from `AppConfig.ready()`, as `communication` does with `core/notifications`.
6. **Impersonation by issuing the target's normal access and refresh pair, or by setting a cookie across
   subdomains.** Rejected:
   - a refresh token outlives the grant, and a JWT cannot be revoked;
   - a cross-subdomain cookie is web-only (invariant 7).

   Instead, the access token carries `grant_id` and an RFC 8693 `act` claim (`{"sub": operator_id}`), and
   gets no refresh token. SimpleJWT's documented extension point, a `JWTAuthentication` subclass,
   re-checks the grant and its holder on every request. The handoff is an RFC 6749 §4.1.2-style
   authorization code: single use, a 2-minute TTL, carried in a URL fragment, the ADR-0033 link pattern.
7. **Stripe now.** Rejected. The launch market is Pakistan, where Stripe does not onboard merchants, and the
   spec leaves the provider open (§19). §6 names manual invoicing for bank-transfer markets.
8. **MFA through `django-otp` or `django-allauth`.** Rejected. Both assume session-based Django auth; this
   API is JWT and must serve mobile (invariant 7). `pyotp`'s `verify_and_get_timecode` with a stored last
   timecode is the library's documented replay-prevention pattern. The login state machine gains the
   `second_factor` step auth-and-rbac §1 reserves.

## Global Constraints

- **Route prefix:** platform routes live under `/api/v1/platform/`. A tenant-scope or impersonation JWT gets
  **404** there (via `IsPlatformPrincipal`). A platform user without a key gets 403. A platform token without
  `"otp"` in its `amr` claim gets 403 `mfa_required`.
- **One target tenant per platform request.** `PlatformTenantNestedMixin` binds it in `initial()` and sets
  `request.tenant`, so `record_audit` attributes rows correctly. Under `ATOMIC_REQUESTS` the `SET LOCAL`
  lasts the whole request; the base class docstring states this rule.
- **Roles:** slugs `platform_super_admin` and `platform_support`; `Role.is_platform` must equal the
  holder's `User.is_platform`. Every default role (`ALL_TENANT_ROLES` plus the platform roles) is a
  `tenant=None` row, synced from the registry's `default_roles` on `post_migrate` in production. Grants are
  additive only, the reasoning of `ensure_school_owner_role`.
- **Permission keys:** exactly §4's list, with `scope="platform"`:
  - `platform.tenant.view|provision|update|suspend|reinstate|export|delete|impersonate`
  - `platform.plan.view|create|update|delete`
  - `platform.subscription.view|update`
  - `platform.feature-flag.view|update`
  - `platform.migration.import`
  - `platform.report.view`

  New tenant key: `school.subscription.view` (`school_owner`), added to the module doc §4.
- **Tenant lifecycle edges:** these and only these. Any other edge is a 409 `invalid_transition`.

  | From | To | Trigger |
  | ---- | -- | ------- |
  | `provisioning` | `trial` | `:provision` |
  | `provisioning` | `deprovisioned` | `:delete`, for a mistaken create; no export needed, nothing to export |
  | `trial` | `active` | Subscription activated |
  | `active` | `past_due` | Payment failed |
  | `past_due` | `active` | Payment recorded |
  | `past_due` | `suspended` | Grace sweep |
  | `trial` | `suspended` | Trial-expiry sweep |
  | `trial`, `active`, `past_due` | `suspended` | `:suspend` |
  | `suspended` | the status the live subscription implies | `:reinstate` |
  | `active`, `suspended` | `deprovisioned` | `:delete` |
  | `deprovisioned` | `suspended` | `:restore`, only while `now < deprovision_after` |

  `:reinstate` details:
  - an `active` subscription → `active`, a `past_due` one → `past_due`;
  - a `trialing` one → `trial` only when the body carries a future `trial_ends_at`;
  - with no live subscription it is refused 409 `no_live_subscription`.

  *Amended (PR A final review, ruling C2):* with no live subscription, a future `trial_ends_at`
  reinstates to `trial`; a past `trial_ends_at` is a 400 on `trial_ends_at`, and so is a missing
  one under a `trialing` subscription; only no subscription and no `trial_ends_at` is the 409.
- **Reasons and export:** `:suspend`, `:delete` and `:restore` require a non-empty `reason`. `:delete` from
  `active` or `suspended` also requires a succeeded `tenant_export` job for that tenant, or `waive_export:
  true`.
- **Slug:** the regex `^[a-z0-9]` then `(?:[a-z0-9-]{1,61}[a-z0-9])?$` (one pattern, split here
  so the link checker does not read it as a link), globally unique, and not in `RESERVED_SLUGS`. That
  constant lives in `apps/platform_admin/constants.py` and is pinned to `apps/website/src/lib/host.ts` by a
  test. Immutable after `:provision`.
- **Retention:** `deprovision_after = now + PLATFORM_RETENTION_DAYS`.
- **Subscriptions:** at most one live subscription (`trialing`, `active` or `past_due`) per tenant, enforced by
  a partial unique index. Every write to `plan_id` or `status` also updates `tenants.current_plan` and
  `tenants.subscription_status`, and bumps the feature-flag generation.
- **Plans:**
  - **Codes:** a plan's `code` is unique and immutable.
  - **Limits:** `limits` keys come from `QUOTA_METRICS = ("students", "staff", "storage_gb", "sms_credits",
    "ai_tokens")`, as non-negative integers or `null` (unlimited).
  - **Lowering a limit below usage:** refused 409 `limit_below_usage` when it drops below the latest snapshot
    of any tenant whose `current_plan` is the plan, unless the body carries `acknowledge_over_usage: true`.
    *Amended (PR C):* the same 409 guards every write that lowers a school's effective limits: a
    subscription's `limits_override`, `:change-plan` to a smaller plan, and a paid sign-up (`subscribe`,
    reached through `:activate`) of a school with no plan, which was unlimited.
  - **`DELETE`** soft-deletes; it is refused 409 `plan_in_use` while any tenant's `current_plan` is the plan.
- **Quota counters (fixed definitions):**
  - `students`: non-soft-deleted students whose status is not `withdrawn`, `graduated` or `transferred_out`;
  - `staff`: non-soft-deleted staff not `exited`;
  - `storage_gb`: the sum of the tenant's `files.size_bytes`, in GiB. *Amended (PR C, user ruling):*
    platform export archives (purpose `platform.tenant-export`) are left out, since the school can
    neither see nor delete them.
- **Settings (env-overridable, ADR-0014):**
  - `PLATFORM_TRIAL_REMINDER_DAYS = (7, 3, 1)`
  - `PLATFORM_DEFAULT_TRIAL_DAYS = 14`
  - `PLATFORM_DUNNING_GRACE_DAYS = 14`
  - `PLATFORM_RETENTION_DAYS = 90`
  - `PLATFORM_QUOTA_WARN_RATIO = 0.9` *Amended (PR C, user ruling): 0.8*, matching §12's 80 % warning.
  - *Amended (PR C):* `PLATFORM_EXPORT_TIME_LIMIT_SECONDS = 14400`, the export task's hard time limit.
  - `PLATFORM_IMPERSONATION_MAX_MINUTES = 60`
  - `PLATFORM_HANDOFF_CODE_TTL_SECONDS = 120`
  - `MFA_CHALLENGE_TTL_SECONDS = 300`
  - `MFA_ISSUER_NAME = "SchoolHub"`
  - `PLATFORM_BILLING_WEBHOOK_SECRET` (no default; the webhook answers 503 when unset)
- **Feature resolution order:**
  1. A live override.
  2. The plan, which enables a `module.*` key iff it is in the live plan's `enabled_modules`.
  3. `default_enabled`.

  A kill switch stays off regardless of the override or plan steps.
- **Celery queues:** sweeps, snapshot and export go to `bulk`; notices go to `transactional`. The route
  patterns are `apps.platform_admin.tasks.*`. No new queue is added.
- **Impersonation:**
  - duration is 1 to `PLATFORM_IMPERSONATION_MAX_MINUTES` minutes, and `reason` is required;
  - the target is an active, non-platform user of an operational tenant;
  - a new grant by the same holder for the same target releases the previous one;
  - the holder must still be active, still `is_platform`, and still hold `platform.tenant.impersonate` on
    every request;
  - a token carrying `grant_id` when no checker is registered is a 401 (fail closed).
- **Notification codes** (dotted, locked vocabulary; §12's `pla-*` refs are renamed in the module doc):
  - `platform.trial-expiring`
  - `platform.payment-failed`
  - `platform.tenant-suspended`
  - `platform.tenant-reinstated`
  - `platform.quota-threshold`
  - `platform.impersonation`

  The owner invite is ADR-0033's invitation email with a new `InvitationKind.OWNER`. `notify()` does not
  dedupe, so each sender checks
  `Notification.objects.filter(event_key=..., source_type=..., source_id=...).exists()` first.

  *Amended (PR A final review, Task 3 ruling):* the lifecycle notices (`platform.tenant-suspended`,
  `platform.tenant-reinstated`) are **not** deduped. A tenant-keyed check would silence a school's second
  suspension forever, and a duplicate cannot happen: the notice is sent only after the edge is accepted
  under the tenant row's lock, so a retry is refused first. The sweeps' notices (PR B, Task 5) still
  dedupe, on a key more specific than the tenant: tenant plus subscription period or trigger.
- **`meta.warnings`:** a list of `{code, message, details}` on a 2xx response. It is documented in
  `docs/02-architecture/api-architecture.md` §2 in Task 6, if it is not already there.

## Review Focus

1. **A tenant user, or a tenant role holding `platform.job.view`, calls `/api/v1/platform/tenants`. A school
   owner's `/auth/me` lists their keys.** Expected: 404 on the console route, and no `platform.tenant.*`
   key in `school_owner`'s grants. Covered in Task 1 by `test_tenant_principal_gets_404_on_platform_routes`
   and `test_no_role_permission_crosses_scope`.
2. **An operator releases a grant, loses `platform.tenant.impersonate`, or the grant expires, while the
   impersonating tab is still open.** Expected: the next request is 401 `impersonation_ended`, even though
   the JWT's `exp` is still in the future. Covered in Task 10 by `test_released_grant_rejects_token_before_exp`
   and `test_holder_losing_key_ends_session`.
3. **`:provision` is retried or double-clicked.** Expected: one settings row, one owner, one invitation and one
   subscription. The same `Idempotency-Key` replays the first response; without one the second call is a 409.
   Covered in Task 3 by `test_provision_replays_under_same_key` and `test_second_provision_is_409`.
4. **A plan or a tenant's subscription changes.** Expected: module access follows at once, because of the
   generation bump. A limit lowered below usage is refused without the acknowledgement. Covered in Task 4 by
   `test_plan_module_removal_disables_feature`, `test_change_plan_refreshes_features` and
   `test_lowering_limit_below_usage_is_409`.
5. **A school at its student quota creates one student, or two requests race at limit − 1, or an import of 50
   arrives with 10 places left.** Expected:
   - a 409 `quota_exceeded` with the metric, limit and usage;
   - exactly one of the two racers succeeds;
   - the import is refused at upload, before a job is created;
   - from 90 % the response carries `meta.warnings`. *Amended (PR C):* from 80 %
     (`PLATFORM_QUOTA_WARN_RATIO = 0.8`). The upload's pre-check is refuse-only
     (`core.tenancy.quotas.assert_room`): no warning and no notice, since its rows may never be created.

   Covered in Task 7 by `test_create_at_limit_is_409`, `test_concurrent_creates_at_limit_minus_one`,
   `test_import_over_remaining_refused_at_upload` and `test_warn_band_adds_meta_warning`.

---

## PR A — platform scope, MFA, tenants, lifecycle, provisioning (`feat/platform-admin-scope`)

### Task 1: Platform scope, the production default-role sync, and the `platform_admin` skeleton

**Files:**
- Modify:
  - `apps/api/core/rbac/registry.py`: `register(..., scope: Literal["tenant","platform"] = "tenant")`,
    plus `PermissionSpec.scope`
  - `apps/api/core/rbac/models.py`: `Permission.scope`, `Role.is_platform`
  - `apps/api/core/rbac/sync.py`: write the scope; new `sync_default_roles()` on `post_migrate`
  - `apps/api/core/rbac/seeding.py`: `ensure_school_owner_role` and `sync_role_permissions` filter on and
    validate the scope, raising `ValueError` as today
  - `apps/api/core/rbac/roles.py`: `PLATFORM_ROLES`
  - `apps/api/core/rbac/permissions.py`: `IsPlatformPrincipal` raises `NotFound` and requires `"otp"` in
    `request.auth["amr"]`, or 403 `mfa_required`
  - `apps/api/config/settings/base.py`: `MODULE_APPS`, `CELERY_TASK_ROUTES`, the `PLATFORM_*` settings
  - `apps/api/config/api_v1.py`
  - `apps/api/.env.example`
- Create:
  - `apps/api/core/api/platform.py` (`PlatformViewSet`, `PlatformTenantNestedMixin`)
  - `apps/api/apps/platform_admin/{__init__,apps,permissions,constants,urls}.py`
  - `apps/api/core/rbac/management/commands/create_platform_admin.py`
  - the migrations
- Test:
  - `apps/api/core/rbac/tests/test_platform_scope.py`
  - `apps/api/core/rbac/tests/test_default_role_sync.py`
  - `apps/api/tests/test_role_permission_scope.py` (the contract test)
- Docs:
  - `docs/decisions/0036-platform-scope-and-cross-tenant-access.md` (Alternatives 1-5)
  - `docs/deferred-work.md:1571-1586`: closed

**Interfaces — Produces:**
- `PlatformViewSet(GenericViewSet)`: `permission_classes = [IsAuthenticated, IsPlatformPrincipal,
  HasPermissionKey]`, with the usual `required_permission` / `required_permission_map`.
- `PlatformTenantNestedMixin`: `initial()` loads `Tenant` by `kwargs["tenant_pk"]` (or 404), calls
  `bind_tenant` the way `core/api/viewsets.py:96-118` does, and sets `request.tenant`. It also provides
  `run_idempotent(endpoint: str, execute: Callable[[], Response]) -> Response`, which wraps
  `replay_or_execute(tenant_id=request.tenant.pk, key=request.headers.get("Idempotency-Key"), endpoint=...,
  request_data=request.data, execute=execute)`.
- `sync_default_roles()`: for each slug in `ALL_TENANT_ROLES + PLATFORM_ROLES`, `get_or_create` the
  `tenant=None` role and add `registry.keys_for_role(slug)` filtered to the role's scope. It is additive only.
  `school_owner` keeps "every tenant-scope key".
- `create_platform_admin --email --first-name [--role ...]` prompts for a password. It creates the account
  with `mfa_enabled=False`, and enrolment (Task 2) is forced at first login.

- [ ] **Step 1: Write the failing tests**
  - `test_tenant_principal_gets_404_on_platform_routes` (Review Focus 1);
  - `test_no_role_permission_crosses_scope`: every `RolePermission` row has
    `permission.scope == ("platform" if role.is_platform else "tenant")`, after `ensure_school_owner_role()`
    and `sync_default_roles()`;
  - `test_school_owner_gets_no_platform_key`;
  - `test_sync_role_permissions_refuses_cross_scope_key` (asserts `ValueError`);
  - `test_platform_role_refuses_tenant_user`;
  - `test_platform_support_cannot_provision` (403);
  - `test_platform_token_without_otp_amr_is_403_mfa_required`;
  - `test_every_console_key_is_platform_scoped`: keys where `module == "platform" and resource in
    PLATFORM_RESOURCES` are all `scope == "platform"`; `platform.file.view` stays `tenant`;
  - `test_sync_default_roles_creates_teacher_with_registry_keys`;
  - `test_sync_default_roles_is_additive`;
  - `test_nested_route_binds_target_tenant`.
- [ ] **Step 2:** Commit the tests, push, and confirm CI fails.
- [ ] **Step 3:** Implement, write ADR-0036 and regenerate OpenAPI.
- [ ] **Step 4:** Confirm CI is green, including `test_rls_coverage`, `test_celery_routing` and the
  `.env.example` drift check.

### Task 2: TOTP MFA for platform users

**Files:**
- Modify:
  - `apps/api/pyproject.toml` (`pyotp`, the current release, checked on PyPI) and `uv.lock`
  - `apps/api/core/rbac/models.py`: `User.mfa_secret` (`BinaryField`, encrypted with
    `core/integrations/crypto.encrypt`, null) and `User.mfa_last_timecode` (`BigIntegerField`, null); a new
    `MfaRecoveryCode` (user FK, `code_hash`, `used_at`)
  - `apps/api/core/rbac/serializers.py` / `views.py`: `LoginView` returns the challenge when the user has
    `mfa_enabled`, and the tokens' `amr` claim is set
  - `apps/api/core/rbac/urls.py`
  - `core/integrations` rotator registration for `mfa_secret`. *Amended (PR A final review):* `users`
    has no RLS, so this is a **global** rotator seam (`mfa.rotate_mfa_secrets`, run once per
    `rotate_integration_credentials` call), not a per-tenant one
- Create: `apps/api/core/rbac/mfa.py`
- Test: `apps/api/core/rbac/tests/test_mfa.py`
- Docs: auth-and-rbac §1 (the `second_factor` step, as built)

**Interfaces — Produces:**
- **Login:**
  - with `mfa_enabled`, it returns `200 {"mfa_required": true, "mfa_token": <signed, MFA_CHALLENGE_TTL_SECONDS>}`,
    sets no cookie and issues no tokens;
  - `POST /auth/mfa:verify {mfa_token, code | recovery_code}` issues the normal pair with
    `amr=["pwd","otp"]`;
  - without MFA the pair carries `amr=["pwd"]`;
  - refresh copies `amr` from the refresh token.
- **Enrolment:** `POST /auth/mfa:enroll` (authenticated) returns `{secret, otpauth_uri}`. The secret comes
  from `pyotp.random_base32()` and is stored encrypted but not yet enabled. `otpauth_uri` is
  `provisioning_uri(name=email, issuer_name=MFA_ISSUER_NAME)`.
- **Confirming:** `POST /auth/mfa:confirm {code}` enables MFA and returns ten single-use recovery codes, of
  which only the hashes are stored. It also returns a fresh token pair with `"otp"` in `amr`.
- **Verification:** `mfa.verify(user, code) -> bool` uses `verify_and_get_timecode(code, valid_window=1)` and
  accepts only `timecode > mfa_last_timecode` (replay prevention), then stores it.
- **Throttling:** all `/auth/mfa:*` routes use `AuthEndpointThrottle`.
- **Disabling:** `POST /auth/mfa:disable` is refused for platform users. Resetting one is done with
  `create_platform_admin --reset-mfa`.

- [ ] **Step 1: Write the failing tests**
  - `test_login_with_mfa_returns_challenge_not_tokens`;
  - `test_verify_issues_otp_amr`;
  - `test_code_replay_rejected`;
  - `test_recovery_code_single_use`;
  - `test_challenge_expires`;
  - `test_refresh_keeps_amr`;
  - `test_secret_stored_encrypted` (the raw column is not the base32 string);
  - `test_platform_user_cannot_disable_mfa`;
  - `test_mfa_routes_throttled`.
- [ ] **Step 2:** Commit and confirm the CI failure.
- [ ] **Step 3:** Implement and regenerate OpenAPI.
- [ ] **Step 4:** Confirm CI is green.

### Task 3: Tenant CRUD, the lifecycle state machine and `:provision`

**Files:**
- Create:
  - `apps/api/apps/platform_admin/tenants/{views,serializers,services,lifecycle,filters}.py`
    (*amended:* the viewset module is `viewset.py`, the ADR-0010 name)
  - `apps/api/apps/platform_admin/notifications.py` (`platform.tenant-suspended`, `platform.tenant-reinstated`)
- Modify:
  - `apps/api/core/tenancy/models.py`: `contact_name`, `contact_email`, `contact_phone`, `provisioned_at` and
    `deprovision_after` (entity spec), plus `current_plan` (FK, null), `subscription_status` (null) and
    `billing_provider_ref` (null, unique when set) for Alternative 2. *Amended (ruling C1):*
    `current_plan` is a `CharField` holding the plan's code, with no foreign key (`core` never
    references `apps.platform_admin`, ADR-0013); all three are NOT NULL with a `''` default (and a
    database default, so the previous release can still insert during a deploy)
  - `apps/api/core/rbac/models.py`: `InvitationKind.OWNER`, its migration, and an eligibility hook
  - `seed_e2e_data`: a platform operator with a fixed TOTP secret
- Test:
  - `apps/api/apps/platform_admin/tests/{test_lifecycle,test_tenants_api}.py`
  - `e2e/tests/live/api/platform-tenants.spec.ts` (`liveApiClient`)
- Docs:
  - module doc §12, §16 and a new §20 "Built"
  - multi-tenancy §7
  - `project-status.md`
  - `deferred-work.md` (suspended-owner billing, website notice, tenant MFA)

**Interfaces — Produces:**
- `lifecycle.transition(tenant, to, *, actor_id: UUID, reason: str = "") -> Tenant` covers exactly the Global
  Constraints table. Any other edge raises `InvalidTransition`. It sets `suspended_at` and
  `deprovision_after`, and the views audit with `record_audit(request, "<action>", tenant, before=, after=)`.
  The sweeps audit with `record_system_audit`.
- `services.create_tenant(*, name, slug, contact_name, contact_email, contact_phone, actor_id) -> Tenant`
  creates the tenant in `provisioning`.
- `services.provision_tenant(tenant, *, plan_code: str | None, actor_id) -> Tenant`, inside the bound
  tenant's transaction:
  - creates `TenantSettings`;
  - *amended (PR A final review):* seeds the school's system ledger accounts with
    `apps.fees_finance.services.ensure_system_accounts(tenant_id=...)`, so its first fee head has an
    income account;
  - creates the owner with `create_invited_user` plus the `school_owner` default role, then
    `create_invitation(kind=OWNER)`, whose link is built by `account_link(tenant, "/accept-invite", ...)`;
  - sets `trial_ends_at` (plan `trial_days`, or `PLATFORM_DEFAULT_TRIAL_DAYS`) and `provisioned_at`;
  - transitions to `trial`.

  Default staff roles already exist globally from `sync_default_roles`. PR B adds the trialing subscription
  here. *Amended (ruling A7):* in PR A a non-null `plan_code` is refused with a 422 until PR B wires it.
- Routes:
  - `GET/POST /platform/tenants`
  - `GET/PATCH /platform/tenants/{tenant_pk}`
  - `POST /platform/tenants/{tenant_pk}:provision`, `:suspend`, `:reinstate`, `:delete`, `:restore`, each
    under `run_idempotent`. *Amended:* `:restore` is gated on `platform.tenant.delete` (it undoes a
    delete; §4 has no restore key)

- [ ] **Step 1: Write the failing tests**
  - a parametrized `test_every_transition_pair` (allowed pairs pass, all others raise);
  - `test_reinstate_trial_requires_future_trial_end`;
  - `test_restore_only_within_retention`;
  - `test_create_refuses_reserved_slug`;
  - `test_reserved_labels_match_website`;
  - `test_slug_immutable_after_provision`;
  - `test_provision_seeds_settings_owner_invitation_once`;
  - `test_provision_replays_under_same_key` and `test_second_provision_is_409` (Review Focus 3);
  - `test_delete_without_export_or_waiver_is_409`;
  - `test_provisioning_tenant_delete_needs_no_export`;
  - `test_suspend_audit_has_actor_and_tenant`;
  - `test_owner_invite_link_on_tenant_host`.
- [ ] **Step 2:** Commit and confirm the CI failure.
- [ ] **Step 3:** Implement, regenerate OpenAPI, and write the live spec: create → provision → suspend →
  reinstate → a tenant token gets 404.
- [ ] **Step 4:** Confirm CI is green, dispatch `change-reviewer` with this plan, then open PR A (ELI5
  section, `--assignee @me`, `--label "needs review"`).

---

## PR B — plans, subscriptions, flags, billing (`feat/platform-admin-plans`)

### Task 4: Plans, subscriptions and plan-based feature enablement

**Files:**
- Create:
  - `apps/api/apps/platform_admin/{plans,subscriptions}/{models,views,serializers,services}.py`. `Subscription`
    is a `TenantOwnedModel` with `rls_operations("subscriptions")`.
  - `apps/api/apps/platform_admin/hooks.py`
- Modify:
  - `apps/api/core/tenancy/features.py`: `register_plan_resolver(fn: Callable[[UUID], frozenset[str] | None])`
    consulted at `:178`, and a public `bump_feature_generation()`
  - `provision_tenant`: a trialing subscription when `plan_code` is given
- Test:
  - `apps/api/apps/platform_admin/tests/{test_plans,test_subscriptions}.py`
  - `core/tenancy/tests/test_features.py`

**Interfaces — Produces:**
- `subscriptions.services`, every write a single transaction that updates `Subscription`, then
  `Tenant.current_plan`/`subscription_status`/`billing_provider_ref`, drives `lifecycle.transition`, then
  calls `bump_feature_generation()`:
  - `live_subscription(tenant_id) -> Subscription | None` and `effective_limits(tenant_id) -> dict[str, int | None]`;
  - `start_trial(tenant, plan, *, actor_id)`;
  - `activate(sub, *, period_start, period_end, actor_id)`;
  - `record_payment(sub, *, paid_through, actor_id)`;
  - `mark_payment_failed(sub, *, actor_id)`;
  - `change_plan(sub, plan, *, actor_id)`.
- Routes:
  - `GET/POST/PATCH/DELETE /platform/plans`
  - `GET/PATCH /platform/tenants/{tenant_pk}/subscription`, plus `:activate`, `:record-payment`,
    `:mark-payment-failed` and `:change-plan` (nested, bound)
  - tenant `GET /api/v1/subscription` (`school.subscription.view`)

  §16's `/platform/subscriptions/{id}` becomes nested under the tenant, and the module doc is updated.

- [ ] **Step 1: Write the failing tests**
  - `test_plan_enables_module_without_override`;
  - `test_override_beats_plan`;
  - `test_kill_switch_beats_plan`;
  - `test_plan_module_removal_disables_feature` and `test_change_plan_refreshes_features` (Review Focus 4);
  - `test_lowering_limit_below_usage_is_409`, then the acknowledged version is 200;
  - `test_delete_plan_in_use_is_409`;
  - `test_one_live_subscription_per_tenant`;
  - `test_tenant_columns_follow_subscription`;
  - `test_record_payment_recovers_past_due`;
  - `test_nested_subscription_of_other_tenant_404`;
  - `test_plan_code_immutable`.
- [ ] **Step 2:** Commit and confirm the CI failure.
- [ ] **Step 3:** Implement and regenerate OpenAPI.
- [ ] **Step 4:** Confirm CI is green.

### Task 5: Feature-flag console, toggle guards, sweeps and the billing webhook

**Files:**
- Create:
  - `apps/api/apps/platform_admin/flags/{views,serializers}.py`
  - `apps/api/apps/platform_admin/billing/{base,registry,manual,fake,models,views}.py`
    (`BillingEventReceipt`, a platform table with unique `(provider, event_id)`)
  - `apps/api/apps/platform_admin/tasks.py`
- Modify:
  - `apps/api/core/tenancy/features.py`: `register_disable_guard(key, fn: Callable[[UUID], str | None])` and
    `disable_refusal(key, tenant_id) -> str | None`
  - `apps/api/apps/attendance/apps.py`: the `module.timetable` guard while in period mode, closing
    `deferred-work.md:284-290`
  - `CELERY_BEAT_SCHEDULE`
  - `notifications.py` (`platform.trial-expiring`, `platform.payment-failed`)
- Test: `apps/api/apps/platform_admin/tests/{test_flags,test_sweeps,test_billing_webhook}.py`

**Interfaces — Produces:**
- Flag routes:
  - `GET/PATCH /platform/feature-flags`; `PATCH` covers only `default_enabled` and `is_kill_switch`, and
    bumps the generation
  - `GET/POST/DELETE /platform/tenants/{tenant_pk}/feature-overrides` (nested, bound); a guarded disable is
    409 `toggle_refused`
- `BillingAdapter` Protocol: `verify_event(headers, body: bytes) -> BillingEvent(event_id, kind:
  Literal["payment_succeeded","payment_failed"], provider_ref, paid_through)`. `fake` uses HMAC-SHA256 over
  `timestamp.body`, as `core/integrations/payments/fake.py:38-44` does.
- `POST /api/v1/platform/billing-events/{provider}` is unauthenticated, HMAC-verified and throttled:
  1. It resolves the tenant through `Tenant.objects.get(billing_provider_ref=...)`, a platform column.
  2. It binds that tenant and applies `record_payment` or `mark_payment_failed`.
  3. It writes the receipt.

  A replay is a 200 no-op; an unknown ref is a 200 no-op, logged.
- Beat tasks (`bulk`): `trial_reminders`, `expire_trials`, `dunning_sweep` and `lapse_overrides`. Each reads
  `tenants` (platform) to pick candidates, then works under `tenant_atomic`, checking the notification
  exists before sending it.

- [ ] **Step 1: Write the failing tests**
  - `test_override_refused_by_guard`;
  - `test_kill_switch_override_refused`;
  - `test_override_of_other_tenant_404`;
  - `test_webhook_bad_signature_401`;
  - `test_webhook_finds_tenant_with_nothing_bound`;
  - `test_webhook_replay_is_noop`;
  - `test_payment_failed_event_moves_to_past_due`;
  - `test_dunning_suspends_after_grace`;
  - `test_trial_reminder_sent_once_per_threshold`;
  - `test_expired_override_lapses`.
- [ ] **Step 2:** Commit, implement, regenerate OpenAPI, and confirm CI is green.
- [ ] **Step 3:** Update the docs (module §17, `deferred-work.md`: the real provider and the platform-ops
  channel), run `change-reviewer`, then open PR B.

---

## PR C — usage, quotas, reports, export (`feat/platform-admin-usage`)

### Task 6: Usage snapshots

**Files:**
- Create: `apps/api/apps/platform_admin/usage/{models,services,views}.py`
- Modify: `apps/api/core/tenancy/grants.py` / `tests/test_append_only_coverage.py`, so coverage includes
  platform tables registered through an explicit `PLATFORM_APPEND_ONLY_TABLES` list
- Test: `apps/api/apps/platform_admin/tests/test_usage.py`

**Interfaces — Produces:**
- `TenantUsageSnapshot` is a platform table, append-only, with an FK to `Tenant`. Fields:
  - `taken_at`, `status` and `plan_code`;
  - `mrr_amount` (`Decimal`, the price normalised to monthly) and `currency`;
  - `students`, `staff` and `storage_bytes`;
  - `impersonations_30d` (null until Task 10);
  - `modules_enabled: list[str]`.
- `snapshot_all()` is the nightly `bulk` task over `for_each_tenant`. `snapshot_tenant(tenant_id)` runs
  inside that tenant's context. `POST /platform/tenants/{tenant_pk}:refresh-usage` (`platform.tenant.view`)
  triggers one tenant, and `GET /platform/tenants/{tenant_pk}/usage` returns the latest snapshot plus
  `effective_limits`.

- [ ] **Step 1: Write the failing tests**
  - `test_snapshot_fields_are_aggregates_only` (the field names against an allow-list);
  - `test_snapshot_all_visits_suspended_tenants`;
  - `test_snapshot_is_append_only`;
  - `test_counters_match_definitions` (withdrawn and soft-deleted students are excluded).
- [ ] **Step 2:** Commit, implement, regenerate OpenAPI, and confirm CI is green.

### Task 7: Quota enforcement

**Files:**
- Create: `apps/api/core/tenancy/quotas.py`
- Modify:
  - `apps/api/core/tenancy/locks.py` (`AdvisoryLockNamespace.QUOTA = 2`)
  - `apps/api/apps/student_management/services.py` (`create_student`), plus the import upload view, before the
    job is created
  - `apps/api/apps/staff_management/staff/services/{create,import_staff}.py`
  - the `core/files` upload service
  - `docs/02-architecture/api-architecture.md` §2 (`meta.warnings`)
- Test: `apps/api/apps/platform_admin/tests/test_quotas.py`

**Interfaces — Produces:**
- `quotas.py` exposes `register_quota_resolver(fn)`, `register_usage_counter(metric, fn)` and
  `check_quota(tenant_id, metric, *, adding=1) -> QuotaWarning | None`.
- `check_quota` takes `advisory_xact_lock(QUOTA, uuid5(tenant_id, metric))` before counting, so concurrent
  creates serialise. It raises `QuotaExceeded` (409 `quota_exceeded`, `details={metric, limit, usage}`), and
  returns a warning at `PLATFORM_QUOTA_WARN_RATIO` or above.
- The import upload view counts the parsed rows (`parse_rows`) and calls `check_quota(adding=len(rows))`
  before `create_job`.
- A crossing into the warn band or the limit sends `platform.quota-threshold`, once per metric and band.

- [ ] **Step 1: Write the failing tests** (Review Focus 5)
  - `test_create_at_limit_is_409`;
  - `test_concurrent_creates_at_limit_minus_one` (`TransactionTestCase` with two threads; exactly one
    succeeds);
  - `test_import_over_remaining_refused_at_upload` (no `BackgroundJob` is created);
  - `test_warn_band_adds_meta_warning`;
  - `test_null_limit_is_unlimited`;
  - `test_threshold_notice_sent_once`.
- [ ] **Step 2:** Commit, implement, and confirm CI is green.

### Task 8: Platform reports and `:export`

**Files:**
- Create:
  - `apps/api/apps/platform_admin/reports/{registry,views}.py`
  - `apps/api/apps/platform_admin/export/{services,tasks}.py`
- Test: `apps/api/apps/platform_admin/tests/{test_reports,test_export}.py`

**Interfaces — Produces:**
- `GET /platform/reports/{key}?format=json|csv|xlsx` (`platform.report.view`) reads only `Tenant` and
  `TenantUsageSnapshot`, rendered through `core/exports/tabular.render`. The keys:
  - `tenant-overview`: counts by status, and signups and churn per month;
  - `revenue`: MRR/ARR per plan and currency, never summed across currencies, plus a past-due count;
  - `usage`: the distribution per metric, the quota-pressure list and module adoption per plan.
- `POST /platform/tenants/{tenant_pk}:export` (`platform.tenant.export`) returns 202 with a job
  (`job_type="tenant_export"`, owned by the target tenant). The task:
  1. writes one CSV per model in `tenant_owned_tables()`, plus the tenant's `users` and `user_roles`,
     streamed with `iterator()`;
  2. leaves out every column in an `EXPORT_DENIED_FIELDS` set, which extends `core/audit/services.py:22`'s
     `_REDACTED_FIELDS` with `password`, `token_hash`, `mfa_secret`, `code_hash` and the encrypted
     integration credential columns;
  3. adds `files/`;
  4. zips the result into storage under the tenant prefix, as a `files` row with purpose `tenant_export`.

  `GET /platform/tenants/{tenant_pk}/jobs/{job_id}` polls the job (nested, bound).

  *Amended (PR C):*
  - `EXPORT_DENIED_FIELDS` is a standalone list of credentials and secrets (passwords, tokens, MFA
    secrets, recovery-code hashes, integration credentials) plus any binary column. It does not extend
    `_REDACTED_FIELDS`: by user ruling the school's personal records (`national_id`, `medical_notes`,
    bank fields) stay in its export.
  - The purpose is `platform.tenant-export`, since the purpose registry requires `<module>.<thing>`;
    the job type stays `tenant_export`. Archives do not count toward the school's `storage_gb`.
  - The poll carries no link. `POST .../jobs/{job_id}:download` (`platform.tenant.export`) mints a
    short-lived signed link and writes an `export_download` audit row per call; a succeeded export
    writes a system audit row with `{tables, rows, files, missing_files}` (SEC-17.5).
  - The task has soft and hard time limits (`PLATFORM_EXPORT_TIME_LIMIT_SECONDS`). `:export` locks the
    school's row, answers an export in flight, and fails and replaces one older than the limit.

- [ ] **Step 1: Write the failing tests**
  - `test_revenue_never_sums_across_currencies`;
  - `test_reports_read_no_tenant_owned_table` (`CaptureQueriesContext`);
  - `test_export_contains_only_target_tenant_rows`;
  - `test_export_omits_secrets`;
  - `test_job_of_other_tenant_404`;
  - `test_succeeded_export_unblocks_delete`.
- [ ] **Step 2:** Commit, implement, regenerate OpenAPI, and confirm CI is green.
- [ ] **Step 3:** Update the docs (module §13 and §20; `deferred-work.md`: purge and certificate, imports,
  SMS/AI quotas, snapshot retention), run `change-reviewer`, then open PR C.

---

## PR D — platform console (`feat/platform-admin-console`)

### Task 9: `(platform)` route group, MFA screens and console screens

**Files:**
- Create:
  - `apps/dashboard/src/app/(platform)/platform/{tenants,tenants/[id],plans,feature-flags,reports}/page.tsx`
  - `apps/dashboard/src/app/(auth)/mfa/{verify,enroll}/page.tsx`
  - `apps/dashboard/src/features/platform/**`
  - `apps/dashboard/src/services/modules/platform/` (the ADR-0019 shape)
  - `e2e/tests/dashboard/platform-console.spec.ts`
- Modify:
  - `src/lib/home-path.ts` (`is_platform` → `Paths.PLATFORM`)
  - `src/proxy.ts`: `/platform/*` only on the bare app host, else 404; `/mfa/*` public
  - `src/config/paths.ts`
  - the login form: an `mfa_required` response routes to `/mfa/verify`, and an `mfa_required` 403 on a
    platform route routes to `/mfa/enroll`
  - `messages/{en,ur}.json`

The screens follow `schoolhub-dashboard-screen`, with URL list state (ADR-0024) and theme tokens only:
- **Tenants:** list; detail tabs Overview, Subscription, Feature overrides, Usage; lifecycle dialogs with
  reason fields and an `Idempotency-Key`.
- **Plans:** list and form, with the acknowledge dialog on `limit_below_usage`.
- **Feature flags.**
- **Reports:** with CSV download.
- **MFA enrol:** shows the QR code from `otpauth_uri`, then the recovery codes, shown once.

- [ ] **Step 1: Write the failing Jest tests**
  - `homePathFor({is_platform: true})`;
  - the proxy 404s `/platform/tenants` on a tenant host;
  - the suspend dialog's submit is disabled without a reason;
  - the plan form's acknowledge dialog;
  - a login `mfa_required` response routes to `/mfa/verify`.

  Then write the mocked e2e flow: bare-host login → MFA → tenants → provision → suspend.
- [ ] **Step 2:** Commit, implement, and confirm CI is green.
- [ ] **Step 3:** Run `change-reviewer`, then open PR D.

---

## PR E — impersonation (`feat/platform-admin-impersonation`)

### Task 10: Grants, handoff exchange, grant-checking authenticator

**Files:**
- Create:
  - `apps/api/apps/platform_admin/impersonation/{models,services,views}.py`. `ImpersonationGrant` is a platform
    table with `tenant`, `target_user`, `granted_to`, `reason`, `expires_at`, `released_at`,
    `handoff_code_hash`, `handoff_expires_at` and `handoff_used_at`.
  - `apps/api/core/rbac/impersonation.py`
  - `docs/decisions/0037-impersonation-grants.md`
- Modify:
  - `DEFAULT_AUTHENTICATION_CLASSES`
  - `core/rbac/serializers.py` (`/auth/me` gains `impersonation: {by_name, expires_at} | null`)
  - `core/rbac/views.py`: `ChangePasswordView` and the Task 2 MFA views refuse impersonated requests with
    403 `impersonation_forbidden`; `LogoutView` under impersonation releases the grant instead of touching
    the refresh cookie
  - `snapshot_tenant` (`impersonations_30d`)
- Test: `apps/api/apps/platform_admin/tests/test_impersonation.py`

**Interfaces — Produces:**
- `POST /platform/tenants/{tenant_pk}:impersonate {user_id, reason, duration_minutes}`
  (`platform.tenant.impersonate`) releases the holder's previous live grant for that target. It returns
  `{grant_id, expires_at, handoff_url}`:
  - `handoff_url` is `account_link(tenant, "/impersonate", code=raw)`;
  - `raw` is `secrets.token_urlsafe(32)`, of which only its `hash_token` is stored;
  - the code expires after `PLATFORM_HANDOFF_CODE_TTL_SECONDS`.
- `POST /api/v1/auth/impersonation:exchange {code}` (`AuthEndpointThrottle`) is single-use and refused after
  `handoff_expires_at` or on a released grant. It returns `{access, expires_in}` with no refresh cookie.
  The claims are `sub=target`, `tenant_id`, `is_platform=false`, `act={"sub": operator_id}`, `grant_id`,
  `amr=["impersonation"]` and `exp=grant.expires_at` (via `set_exp`).
- `POST /api/v1/auth/impersonation:end` and `DELETE /platform/impersonation-grants/{id}` (the holder or
  `platform_super_admin`) both set `released_at`.
- `ImpersonationAwareJWTAuthentication(JWTAuthentication)`: when the token carries `grant_id`, it runs the
  registered checker. A grant that isn't live, a holder who is inactive, non-platform or no longer holds the
  key, or no registered checker all mean 401 `impersonation_ended`. Otherwise it sets
  `request.impersonated_by = act.sub`, which `record_audit` (`core/audit/services.py:102`) reads.
- Audit: `record_security_event` on grant, exchange, end and release. `notify("platform.impersonation")` goes
  in-app to the tenant's `school_owner` users.

- [ ] **Step 1: Write the failing tests**
  - `test_released_grant_rejects_token_before_exp` and `test_holder_losing_key_ends_session` (Review Focus 2);
  - `test_expired_grant_rejects_token`;
  - `test_handoff_code_single_use`;
  - `test_handoff_code_expires_before_grant`;
  - `test_new_grant_releases_previous`;
  - `test_cannot_impersonate_platform_user`;
  - `test_cannot_impersonate_user_of_suspended_tenant`;
  - `test_duration_over_max_is_422`;
  - `test_impersonated_token_cannot_reach_platform_routes` (404);
  - `test_impersonated_mutation_audit_has_impersonated_by`;
  - `test_impersonated_password_change_forbidden`;
  - `test_logout_releases_grant`;
  - `test_target_permissions_apply_not_operator`;
  - `test_grant_id_without_checker_is_401`.
- [ ] **Step 2:** Commit, implement, write ADR-0037, regenerate OpenAPI, and confirm CI is green.

### Task 11: Dashboard handoff, banner and console action

**Files:**
- Create:
  - `apps/dashboard/src/app/(auth)/impersonate/page.tsx`: reads the fragment once and clears it, then
    exchanges the code and puts the token in `accessTokenStore`
  - `src/components/impersonation-banner.tsx`, in the `(app)` and `(portal)` shells, with an "End session"
    button that calls `impersonation:end`
  - `src/features/platform/impersonation/**`
  - `e2e/tests/dashboard/impersonation.spec.ts`
- Modify:
  - `src/proxy.ts`: add `Paths.IMPERSONATE` to `LINK_PATHS`, as ADR-0033 did for accept-invite
  - `src/lib/auth.ts`:
    - an impersonated session sets the session marker with `max-age` equal to `expires_in`;
    - a 401 never attempts a refresh, and routes to `/impersonate?ended=1`;
    - logout calls `impersonation:end`
  - the tenant detail screen: an "Impersonate user" dialog (user picker, reason, duration) that opens
    `handoff_url` in a new tab

**Reload, decided:** the token lives only in memory (as for normal sessions), so a reload or hard
navigation ends the impersonated tab. The ended page explains this. The operator starts again from the
console, and the new grant releases the old one (Task 10), so there is no 409 lockout.

- [ ] **Step 1: Write the failing Jest tests**
  - the proxy lets `/impersonate` through without a session;
  - the fragment is cleared after one read;
  - the banner shows the operator and the expiry;
  - a 401 while impersonated does not call refresh;
  - the marker's `max-age` equals `expires_in`.

  Then write the mocked e2e flow: dialog → handoff → banner → End session.
- [ ] **Step 2:** Commit, implement, and confirm CI is green.
- [ ] **Step 3:** Update the docs:
  - module §7.3 and §20;
  - auth-and-rbac §1, linking ADR-0037;
  - `project-status.md`;
  - `deferred-work.md` (the tenant-visible impersonation log);
  - `agent-lessons.md` for anything caught.

  Run `change-reviewer`, then open PR E.

---

## School setup and onboarding (PRs F–H)

The Phase 2 exit depends on these PRs. The work was added to this plan after the user asked for the full module.

### Decisions

- **The wizard gets a `subjects` step.** "Configure academics" needs subjects: curriculum, timetable and
  exams all key on them, and school-organization §7.1 lists them. Contact details and address
  (`TenantContact`) are deferred to `deferred-work.md`; going live doesn't need them.
- **`Tenant.name` has two writers:** the school's `PATCH /school-settings` and the console's
  `PATCH /platform/tenants/{pk}`. The last write wins, and both are audited. A billing legal name, if one is
  ever needed, would be a separate field. This is recorded in platform-admin §20.

### Global Constraints (PRs F–H)

- **Onboarding steps,** computed from the request tenant's own rows under RLS and never stored. A step is
  **omitted** when its module flag is off.

  | Step | Done when | Skippable | Omitted when |
  | ---- | --------- | --------- | ------------ |
  | `profile` | `onboarding.profile_confirmed_at` is set (manual) | No | — |
  | `campuses` | At least one active campus | No | — |
  | `academic_session` | A non-deleted session in `planned` or `active` has at least one term, and `term_coverage_errors(session)` is empty | No | — |
  | `classes` | At least one active class with an active section | No | — |
  | `subjects` | At least one active subject | No | — |
  | `fee_structures` | At least one active fee structure | Yes | `module.fees_finance` is off |
  | `staff_invites` | At least one staff `Invitation` with `kind=STAFF` that is accepted, or sent and neither revoked nor failed (see below) | Yes | `module.staff` is off |
  | `students` | At least one non-deleted student | Yes | `module.students` is off |
  | `go_live` | A session with status `active` | No | — |

  The `staff_invites` filter, exactly: `accepted_at__isnull=False` OR (`sent_at__isnull=False`,
  `revoked_at__isnull=True`, `send_failed_at__isnull=True`). Owner invitations never count.
- **`completed`** is computed: every step that is neither omitted nor skipped is done. `completed_at` is
  written only by a conditional `UPDATE … WHERE onboarding->>'completed_at' IS NULL`, run when a `GET` finds
  `completed` true. It is idempotent under concurrency.
- **Permissions:**
  - `GET /onboarding` needs `school.settings.view`; `PATCH` needs `school.settings.update`.
  - Only the `profile` step can be confirmed by hand.
  - Only skippable steps can be skipped or unskipped.
  - Anything else is a 422.
- **Who sees what in the dashboard:**
  - each step's action is shown only to holders of that action's own key, using the exact strings from
    `school_organization/permissions.py`:
    - `school.campus.create`, `school.academic-session.create`, `school.class.create`,
      `school.section.create`, `school.subject.create`, `school.academic-session.activate`;
    - `fees.fee-structure.create`, `staff.staff.update`, `students.student.import`;
  - the card and wizard appear only for someone who can act on at least one remaining step.
- **School name:**
  - `/school-settings` gains `name`, 1–200 characters, writing `Tenant.name`;
  - `_represent` includes `name`, so the audit row's `before` and `after` show the change;
  - `slug` and `status` sent in the body are ignored, never written.
- **Logo:**
  - a new nullable FK `TenantSettings.logo_file_id` → `files`, as the entity spec defines;
  - upload purpose `school.logo`, declared in `apps/school_organization/uploads.py`: PNG, JPEG or WebP, at
    most 2 MB;
  - the `PATCH` is validated: the file is `ready`, has the `school.logo` purpose and belongs to the caller's
    tenant; any other id gets the same 422 as an unknown one;
  - `GET` returns a signed `logo_url`.
- **`branding`:** a `PATCH` **merges** keys into the stored `branding` and never replaces it. The colour key
  is `primary_color` (the `packages/types/src/tenant.ts` contract); its value is a hex string in data, never a
  class name.
- **`/auth/me`** keeps `tenant` (UUID) unchanged and adds a separate read-only `tenant_summary: {name, slug}`.

### PR F — `feat/school-setup`

#### Task 12: Settings backend fixes, and the Profile, Campuses, Departments, Houses and Calendar screens.

- **Backend:**
  - the `TenantSettings.logo_file_id` migration (`core/tenancy`, the only one in this stack);
  - `apps/school_organization/uploads.py` (`school.logo`);
  - `school_settings/{serializers,view}.py`: `name`, the logo, `logo_url`, and the branding merge;
  - `core/rbac/serializers.py`: `tenant_summary`;
  - regenerate OpenAPI and the client, and update every `User` fixture in the same commit (L41).
- **Backend tests:**
  - `test_patch_name_updates_tenant_and_audits_name`;
  - `test_patch_ignores_slug_and_status`;
  - `test_logo_other_tenants_file_same_422_as_unknown`;
  - `test_logo_wrong_purpose_422`;
  - `test_branding_patch_merges_primary_color_survives_logo`;
  - `test_me_has_tenant_summary_and_tenant_uuid_unchanged`.
- **Dashboard:**
  - delete `services/modules/tenant`, `endpoints.tenant`, e2e `tenantModule` and its uses
    (`e2e/src/fixtures/index.ts:237`, `tests/dashboard/login.spec.ts:51,65`) and
    `services/__tests__/index.test.ts:131`;
  - new five-file `services/modules/school-settings`, plus `endpoints.schoolSettings`,
    `queryKeys.schoolSettings` and write calls added to `services/modules/school-organization`;
  - new module **"School"**:
    - `Paths.SCHOOL_*`
    - `features/school/school-sections.ts` (permission prefix `school`)
    - a `config/menu-config.ts` group
    - `app/(app)/school/{layout,page}.tsx` (`ModuleSectionNav`, `ModuleLanding`)
  - each section is built as a self-contained table + toolbar + form dialog unit, the shape of
    `features/timetable/rooms/*`, so PR H can embed it: `FormDialogLayout`, `useFormDialogSubmit`,
    `useDataGridUrlState`, `RowEditRemoveActions`, and a delete dialog that shows the 422 "referenced"
    message;
  - the calendar section edits `/holiday-calendar`: working-day toggles plus a holidays list with an
    optional campus;
  - a `school` message namespace in `en.json`/`ur.json`.
- **Tests:**
  - Jest per dialog, including the 422 field errors;
  - mocked e2e `e2e/tests/dashboard/school-setup.spec.ts`, with write, settings and calendar handlers added
    to `schoolOrganizationModule`.
- **Docs:**
  - `school-organization.md` §20 "Built (dashboard)";
  - `project-status.md`;
  - the stale five-file note in `deferred-work.md:171-176` corrected.

### PR G — `feat/school-setup-structure`

#### Task 13: Sessions & terms.

- **Backend:**
  - split `term_coverage_errors(session) -> list[str]` out of
    `academic_sessions/services/validate.py`, and have `session_completeness_errors` call it;
  - re-export it from `apps/school_organization/services.py` (ADR-0013 entry point) and fix the "only this
    package uses it" docstring (L12);
  - test `test_completeness_still_reports_terms_through_split`.
- **Dashboard:**
  - a cursor list (`use-cursor-list`, `CursorDataGridCard`) with create and edit;
  - a terms list inside each session;
  - `:activate` (a 422 `{structure: [...]}` is shown as a checklist), `:close`, and a `:clone` dialog, all
    through `useConfirmAction`.
- **Jest:**
  - `activate_shows_structure_errors_as_list`;
  - `clone_dialog_posts_dates`;
  - `term_overlap_error_names_term`.

#### Task 14: Classes & sections, and Subjects.

- Classes are ordered by `level`, with sections inside each class row. Subjects can be filtered by department
  and type.
- **Jest:**
  - `inactive_class_hidden_from_section_form`;
  - `duplicate_level_shows_field_error`.
- **Mocked e2e** `school-structure.spec.ts`: create a session, add terms, add a class and section, add a
  subject, activate.
- **Docs**, then `change-reviewer`, then PR G.

### PR H — `feat/onboarding-wizard` (rebased onto `main` once PR A merges)

#### Task 15: The onboarding API, the wizard and the home card.

- **Backend, in `apps/platform_admin/onboarding/{services,views,serializers}.py`:**
  - reads the other apps' models (ADR-0013 allows it) and `school_organization.services.term_coverage_errors`;
  - a new `TenantSettings.onboarding` JSON field (`{profile_confirmed_at, skipped: [], completed_at}`), in its
    own `core/tenancy` migration, numbered after PR A's;
  - `GET /api/v1/onboarding` returns `{steps: [{key, done, skipped, skippable, count}], completed, completed_at}`;
  - `PATCH /api/v1/onboarding` takes `{"confirm": "profile"}`, `{"skip": k}` or `{"unskip": k}`.
- **Backend tests:**
  - `test_fresh_tenant_no_steps_done`;
  - `test_session_step_done_before_classes_exist`;
  - `test_session_step_needs_term_coverage`;
  - `test_owner_invitation_does_not_complete_staff_step`;
  - `test_failed_or_revoked_staff_invite_not_done`;
  - `test_steps_omitted_when_module_off` (fees, staff, students);
  - `test_skip_only_skippable`;
  - `test_completed_at_stamped_once_concurrently` (`TransactionTestCase`, two threads);
  - `test_other_tenants_rows_never_counted`;
  - `test_patch_requires_settings_update`.
- **Dashboard:**
  - `endpoints.onboarding`, `queryKeys.onboarding`, and a five-file `services/modules/onboarding`;
  - `app/(app)/setup/page.tsx`: a stepper with `?step=` in the URL;
  - embedded steps reuse PR F/G's units: profile, campuses, session and terms, classes and sections,
    subjects;
  - linked steps: fee structures (`/fees/structures`), staff invites (`/staff`), and students
    (`/students?import=1`);
  - `go_live` runs `:activate`;
  - every mutation in the wizard invalidates `queryKeys.onboarding`;
  - in `features/students/student-toolbar.tsx`, `?import=1` opens `BulkImportDialog` only for
    `students.student.import` holders, then removes itself from the URL;
  - `shell/dashboard/dashboard-page-content.tsx` gets a "Finish setting up" card with a progress bar,
    following the visibility rule above. It is noted in platform-admin §20 so a home-page rebuild keeps it;
  - an `onboarding` message namespace.
- **Jest:**
  - `card_hidden_when_completed`;
  - `card_hidden_for_it_admin_with_no_actionable_step`;
  - `school_admin_sees_session_and_activate_actions`;
  - `skip_button_only_on_skippable`;
  - `import_param_opens_dialog_and_clears`;
  - `import_param_ignored_without_import_key`;
  - `campus_create_invalidates_onboarding` (`renderWithClient` with a spy, L35).
- **Mocked e2e** `onboarding-wizard.spec.ts`.
- **Live lane:**
  - `seed_e2e_data` seeds a third, empty tenant (`fresh-school`) whose owner has an email used nowhere else;
  - `e2e/tests/live/onboarding-journey.spec.ts` walks the Phase 2 exit journey with run-unique record
    names: profile → campus → session and terms → class and section → subject → fee structure → skip staff
    → import 3 students → go live → the card is gone;
  - the import wait uses `LIVE_JOB_TIMEOUT_MS` (L6);
  - the spec header states that it needs a fresh database, because go-live is permanent.
- **Docs:**
  - platform-admin §5.6, §16 (`GET`/`PATCH /onboarding`) and §20, which records the computed-progress and
    embedded-forms decisions; these are module-local, so no ADR;
  - `school-organization.md` §7.1;
  - `project-status.md`;
  - `deferred-work.md` (`AI-PLA-03`, contact/address, website logo).

Then `change-reviewer`, then PR H.

### Reused, not rebuilt

- `session_completeness_errors`, refactored to call the new `term_coverage_errors`
- `useDataGridUrlState`
- `use-cursor-list` / `CursorDataGridCard`
- `FormDialogLayout` / `useFormDialogSubmit`
- `useConfirmAction`
- `ModuleSectionNav` / `ModuleLanding` / `permittedSections`
- `BulkImportDialog`
- `useCurrentUser`, `hasPermission`
- the `schoolOrganizationModule` mock builders
- the upload-purpose registry and the signed display URLs

### Alternatives considered (why not)

- **Store a progress record per step.** Rejected: it drifts from the real data, for example when a campus
  is deleted after its step was ticked. Computing from data makes the wizard resumable for free. Only the
  profile confirmation and the skips are stored.
- **A wizard with its own forms.** Rejected: it duplicates PR F/G's validation and error handling. The
  wizard embeds the same table, toolbar and dialog units.
- **Setup screens in the platform console.** Rejected: school-organization §7.1 has the school run its own
  setup.
- **Logo as a `branding.logo_file_id` JSON key.** Rejected: no foreign key, so a deleted file leaves a
  dangling id, and it contradicts the entity spec's column.

---

## Verification

- **CI on each PR:** `api` (tests, the RLS, append-only, Celery-routing and role-scope contract suites, OpenAPI
  freshness), `frontend` (Jest, typecheck, mocked e2e for D/E) and `repo-hygiene`.
- **Live lane (`e2e-live`, dispatched after PR C):** the platform operator logs in with TOTP, provisions a
  tenant and subscribes it to a plan without `module.transport`. Expected:
  - a transport route is 403 `module_disabled`;
  - an override enables it;
  - suspend refuses login, and reinstate restores it;
  - the owner invite accepts, and the owner can assign the `teacher` default role to an invited staff member.
- **After PR E, by hand in compose:** run `create_platform_admin`, sign in on `app.localhost` and enrol MFA.
  Impersonate the demo school admin, edit a campus, then release the grant. Check:
  - the open tab's next request lands on the ended page;
  - `audit_logs.impersonated_by` is set on the edit;
  - the owner has the in-app notice.
- **Phase 2 exit (`e2e-live`, fresh database, after PR H):** `e2e/tests/live/onboarding-journey.spec.ts` passes.
  Once PR A has merged, it is re-run once from a tenant provisioned in the console.

## Independent review

- **Reviewer:** plan-reviewer agent, 2026-11-15
- **Verdict:** REVISE. Per-tenant binding with no BYPASSRLS is right. But subscriptions were unreadable on
  platform-wide paths, `school_owner` would have received every console key, production tenants got no
  default roles, and the impersonation handoff broke on the proxy and on reload.
- **Findings addressed:** all 25 are addressed in this revision.
  - **Findings 1-6:**
    - 1: scope filter in `ensure_school_owner_role` plus a contract test over every `RolePermission`;
    - 2: platform-scope `tenants.current_plan`/`subscription_status`/`billing_provider_ref` (Alternative 2);
    - 3: `PlatformTenantNestedMixin` binds the tenant on reads too, with cross-tenant 404 tests per nested
      route;
    - 4: production `sync_default_roles()` on `post_migrate`, closing deferred-work:1571;
    - 5: `Paths.IMPERSONATE` in `LINK_PATHS`;
    - 6: reload ends the tab, a new grant releases the old one, and the marker gets `max-age`.
  - **Findings 7-15:**
    - 7: TOTP MFA is built in Task 2 (user decision) and required for platform routes; references to views
      that don't exist are removed;
    - 8: ADRs renumbered 0036/0037;
    - 9: the test filters on `module == "platform"`;
    - 10: names corrected (`PermissionSpec`, `ValueError`, the staff service paths, `InvitationKind.OWNER`,
      `TestCase` style);
    - 11: `bulk`/`transactional` queues and the `apps.platform_admin.tasks.*` pattern;
    - 12: the `EXEMPT_PREFIXES` step dropped;
    - 13: `request.tenant` set, and `record_audit` with the actor;
    - 14: a 2-minute single-use code, throttled exchange, holder re-check, fail-closed checker, `act` claim
      and `account_link`;
    - 15: every subscription write bumps the generation.
  - **Findings 16-25:**
    - 16: an advisory lock per tenant and metric, the import refused at upload, fixed counter definitions,
      and `meta.warnings` documented;
    - 17: the `provisioning → deprovisioned` and `:restore` edges, and the `:reinstate` rules;
    - 18: `e2e/tests/live/api/` plus a seeded operator;
    - 19: the export deny-list, with users and roles included;
    - 20: platform append-only coverage, and retention deferred;
    - 21: the platform-ops channel deferred, with an explicit dedupe check;
    - 22: the onboarding deferral names its plan and the Phase 2 exit dependency;
    - 23: regeneration in every endpoint task;
    - 24: logout releases the grant;
    - 25: the one-target-tenant rule stated.
- **Unresolved:** none. The MFA decision was the user's (build it in this plan). The reload behaviour and the
  subscription index were decided above with their reasons.

### Independent review (PRs F–H addendum)

- **Reviewer:** plan-reviewer agent, 2026-11-15
- **Verdict:** REVISE. The computed-checklist and embedded-forms approach is right. The plan needed fixes to:
  - the session step rule and the private `validate.py` import;
  - the `school_logo` key, which the registry rejects, and the logo storage, which contradicted the entity
    spec;
  - the collision between the two parallel stacks;
  - the `/auth/me` contract break;
  - per-step permission gating (`it_admin`);
  - the staff-invite query;
  - a live-lane journey with no fresh tenant to start from.
- **Findings addressed:** all 16.
  - 1: `term_coverage_errors` split out and re-exported through `services.py`, with a step test for "done
    before classes";
  - 2: the purpose key is `school.logo`, declared in `apps/school_organization/uploads.py`;
  - 3: a real `logo_file_id` FK, ready/purpose/tenant validation, `logo_url`, and the website gap deferred;
  - 4: PR H is based on PR A's merge, and F/G add only one `core/tenancy` migration, with the
    rebase-and-renumber rule stated;
  - 5: `branding` is merged on PATCH, with a test;
  - 6: `tenant_summary` is a new field and `tenant` is unchanged, with fixtures updated (L41);
  - 7: `completed_at` uses a conditional `UPDATE`, with a concurrency test;
  - 8: each step is gated on its own key, and the card shows only when some step is actionable;
  - 9: the staff-invite filter is written out, and owner invitations are excluded;
  - 10: a third `fresh-school` tenant is seeded, with run-unique names, the fresh-database note and
    `LIVE_JOB_TIMEOUT_MS`;
  - 11: a `subjects` step is added, and contact/address are deferred;
  - 12: the keys and endpoints are named, whole units are embedded, and onboarding invalidation is tested;
  - 13: the decisions are recorded in §20 (module-local, so no ADR), and the base Task 3 line is amended;
  - 14: every `tenantModule` use is deleted, with no stubs;
  - 15: the staff and student steps are omitted when their modules are off, `?import=1` clears itself and is
    permission-gated, an `onboarding` namespace is added, `_represent` includes `name`, and `slug`/`status`
    are ignored;
  - 16: the card placement is noted in §20.
- **Unresolved:** none. The reviewer's three user questions were decided by the author, with the reasons
  under "Decisions taken": PR H waits for PR A, subjects become a step while contact/address are deferred,
  and the tenant name has two audited writers.
