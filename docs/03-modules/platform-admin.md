# Module: Platform Administration

> **Agent Context** — Load this block first.
> **Summary:** The platform (SaaS-operator) scope above all tenants: tenant lifecycle (provisioning → trial → active → suspension → deletion), plans/subscriptions and billing of schools, feature flags, usage tracking and quotas, the school onboarding wizard, legacy-data migration/import, platform-level aggregate reporting, and audited impersonation. Used only by platform roles — never by tenant users. Implements scope §10 and the platform items of §22.
> **Co-load with:** `../02-architecture/multi-tenancy.md` · `../02-architecture/auth-and-rbac.md` · `../05-database/entities/tenancy.md`
> **Owns entities:** `tenants`, `tenant_settings`, `plans`, `subscriptions`, `feature_flags`, `tenant_feature_overrides`, `custom_domains`
> **Depends on modules:** all tenant modules (flag/quota enforcement targets), reporting-analytics (boundary), website-cms (domain/suspension effects)

## 1. Purpose

The product is sold to many schools; someone has to operate the fleet. This module is the platform console where the SaaS operator provisions tenants, manages plans and subscriptions, bills schools, toggles feature flags, monitors usage against quotas, runs onboarding and legacy-data migrations, views aggregate platform reporting, and — under strict audit — impersonates tenant users for support.

Everything here runs in the **platform scope**: platform-scope JWTs, platform roles only ([`users-and-roles.md`](../00-overview/users-and-roles.md) §2), and a separate read path for reporting that never exposes row-level school data ([`multi-tenancy.md`](../02-architecture/multi-tenancy.md) §8).

## 2. Business Objective

- Make tenant acquisition cheap: provisioning is a single idempotent transaction, onboarding is self-guided — sales-to-live measured in hours, not weeks.
- Protect revenue: subscription states drive access (trial expiry, past-due dunning, suspension) automatically.
- Control margins: usage quotas (students, storage, SMS, AI tokens) enforce plan boundaries server-side.

## 3. Target Users

| Role | How they use this module |
| ---- | ------------------------ |
| `platform_super_admin` | Full platform control: tenants, plans, billing, flags, migrations, platform staff |
| `platform_support` | Tenant lookup, health/usage views, audited time-boxed impersonation; read-mostly |
| `school_owner` (touchpoint only) | Sees own subscription/billing state and the onboarding wizard inside the tenant dashboard — served by this module's tenant-facing endpoints, not the platform console |

## 4. Permissions

Permissions follow the RBAC model in [`auth-and-rbac.md`](../02-architecture/auth-and-rbac.md). Permission keys use `<module>.<resource>.<action>`. Module-specific verbs declared here: `provision`, `suspend`, `reinstate`, `impersonate`.

| Permission key | Description | Default roles |
| -------------- | ----------- | ------------- |
| `platform.tenant.view` | View tenant list, detail, health, usage | `platform_super_admin`, `platform_support` |
| `platform.tenant.provision` | Create/provision a tenant | `platform_super_admin` |
| `platform.tenant.update` | Edit tenant record, lifecycle metadata | `platform_super_admin` |
| `platform.tenant.suspend` / `platform.tenant.reinstate` | Suspend / reinstate a tenant | `platform_super_admin` |
| `platform.tenant.export` | Trigger full tenant data export | `platform_super_admin` |
| `platform.tenant.delete` | Start deprovision (retention → purge) | `platform_super_admin` |
| `platform.tenant.impersonate` | Time-boxed, reason-required impersonation | `platform_super_admin`, `platform_support` |
| `platform.plan.view` / `create` / `update` / `delete` | Manage plan catalog | `platform_super_admin` (view: + `platform_support`) |
| `platform.subscription.view` / `update` | Manage tenant subscriptions and billing state | `platform_super_admin` (view: + `platform_support`) |
| `platform.feature-flag.view` / `update` | Flag defaults and per-tenant overrides | `platform_super_admin` (view: + `platform_support`) |
| `platform.migration.import` | Run legacy-data imports into a tenant | `platform_super_admin` |
| `platform.report.view` | Platform aggregate reporting | `platform_super_admin`, `platform_support` |

Every key above is **platform-scope** ([ADR-0036](../decisions/0036-platform-scope-and-cross-tenant-access.md)): only the two platform roles hold them, and no school's role ever can. The scope, not the module name, decides it: the tenant-side `platform.file.*`, `platform.job.view` and `platform.notification.view` keys stay tenant-scope. `registry.register(..., scope="platform")` refuses a tenant default role, every grant path filters on `Permission.scope`, and only a platform user may hold a platform role (a trigger on `user_roles`). Both roles are synced as shared `tenant=None` rows on every migrate (`core.rbac.sync.sync_default_roles`), and an operator account is created with `manage.py create_platform_admin --email --first-name [--role]`.

Every operator signs in with password **and** TOTP ([auth-and-rbac §1](../02-architecture/auth-and-rbac.md), SEC-06). A new account starts with MFA off: its first password sign-in gets an `amr=["pwd"]` token, which the console refuses (403 `mfa_required`) but which can call `POST /auth/mfa:enroll` and `:confirm`; confirming returns ten recovery codes and an `amr=["pwd","otp"]` pair. From then on login answers with a challenge that `POST /auth/mfa:verify` completes. An operator cannot turn MFA off (`/auth/mfa:disable` is 403); one who lost their authenticator and recovery codes is reset with `manage.py create_platform_admin --email … --reset-mfa`, which also ends their sessions: the console refuses their existing tokens at once. One locked out by 100 consecutive wrong codes is unlocked with `--unlock-mfa`, which keeps the factor.

## 5. Main Features

1. **Tenant lifecycle management** — create, provision (idempotent seed transaction), trial, activate, suspend, reinstate, export, and delete tenants per the state machine in multi-tenancy §7. *Built:* create, edit, `:provision`, `:suspend`, `:reinstate`, `:delete` and `:restore` (§7.4, §20); export arrives with the usage PR.
2. **Plans & subscriptions** — plan catalog (modules enabled, usage limits, price, trial length); per-tenant subscription with period tracking; plan upgrades/downgrades with proration rules *(recommendation)*.
3. **Billing of schools** — invoicing tenants for their subscription via a billing provider; dunning on failed payment → `past_due` → grace → suspension. (This bills *schools*; student fee billing is the tenant-side fees-finance module.)
4. **Feature flags** — platform flag registry with per-plan defaults and per-tenant overrides, kill-switch capable; every tenant module checks its flag server-side (multi-tenancy §5).
5. **Usage tracking & quotas** — metered counters per tenant (active students, staff, storage GB, SMS credits, AI tokens, API rate) vs. plan limits; soft-warn then hard-enforce.
6. **Onboarding wizard** — guided tenant setup: school profile → campuses → academic session → classes/sections → fee structures → staff invites → student import; resumable, with progress tracking.
7. **Data migration / legacy import** — Excel/CSV import pipelines (students, guardians, staff, fee balances, marks history) with mapping templates, dry-run validation, error reports, and rollback of a failed batch.
8. **Platform-level reporting** — aggregates only: tenant counts by state, MRR/ARR, usage/adoption per module, churn, support-load; never row-level school data.
9. **Impersonation with audit** — elevation grant (≤ 1 h, reason required, banner shown); every action tagged `impersonated_by` in `audit_logs` (RBAC §1).

## 6. Sub-features

- **Tenants:** slug management, lifecycle timestamps, suspension notice shown on the public website, deprovision retention countdown (90 days) with certificate of deletion.
- **Plans:** versioned plan changes never mutate existing subscriptions retroactively; grandfathering supported *(recommendation)*.
- **Billing:** billing-provider webhooks (payment succeeded/failed) drive subscription state; manual invoicing mode for bank-transfer markets *(recommendation — payment rails vary by country; currency per plan/tenant, none assumed)*.
- **Flags:** override expiry dates; flag audit trail; percentage rollouts for gradual feature releases *(recommendation)*.
- **Quotas:** per-quota grace thresholds (AI tokens warn at 80%, ai-governance.md §5); AI token budgets enforced at the AI gateway; storage measured nightly.
- **Migration:** reusable mapping templates per source system; AI-assisted column mapping (`AI-PLA-01`); imports run as background jobs with per-row error files.

## 7. Workflows

### 7.1 Tenant provisioning & onboarding

```mermaid
flowchart TD
    A[Sales order: POST /platform/tenants] --> B[platform.tenant.provision:<br/>one idempotent tx: tenant settings, system ledger accounts,<br/>owner account with the shared school_owner role]
    B --> C[Owner invite sent → Trial starts]
    C --> D[Onboarding wizard<br/>profile → campuses → session → classes →<br/>fees → staff invites → student import]
    D --> E{Subscription started?}
    E -- yes --> F[Active]
    E -- trial expires --> G[Trial-expired hold → reminder → suspend]
```

### 7.2 Subscription dunning & suspension

```mermaid
flowchart TD
    A[Active] -- payment failed webhook --> B[PastDue: dunning emails, retry schedule]
    B -- payment recovered --> A
    B -- grace period expired --> C[Suspended: logins blocked except owner<br/>read-only billing; website shows neutral notice]
    C -- ":reinstate: active subscription" --> A
    C -- ":reinstate: past_due subscription" --> B
    C -- ":reinstate with a future trial_ends_at" --> T[Trial]
    C -- ":delete by an operator (export or waiver)" --> D[Deprovisioned: 90-day retention → hard purge]
```

### 7.3 Impersonation

Support agent requests elevation (tenant, target user, reason) → grant issued (≤ 1 h, auto-expiring) → agent operates the tenant dashboard with a persistent banner, target-user permissions apply (never superuser) → every mutation audit-tagged `impersonated_by` → grant expiry or manual release ends the session → tenant owner can view an impersonation log *(recommendation)*.

### 7.4 Tenant lifecycle, as built

`apps/platform_admin/tenants/lifecycle.py` is the only writer of `tenants.status` after creation, and it allows these edges and no others (any other is a 409 `invalid_transition`):

| From | To | Trigger |
| ---- | -- | ------- |
| `provisioning` | `trial` | `:provision` |
| `provisioning` | `deprovisioned` | `:delete` of a school created by mistake (nothing to export) |
| `trial` | `active` | Subscription activated (PR B) |
| `active` | `past_due` | Payment failed (PR B) |
| `past_due` | `active` | Payment recorded (PR B) |
| `trial`, `active`, `past_due` | `suspended` | `:suspend`, or the trial-expiry / grace sweeps (PR B) |
| `suspended` | the status the live subscription implies | `:reinstate` |
| `active`, `suspended` | `deprovisioned` | `:delete` |
| `deprovisioned` | `suspended` | `:restore`, only while `now < deprovision_after` (else 409 `retention_expired`) |

- **`:provision`** runs in one transaction with the school bound: it creates `tenant_settings` and the school's system ledger accounts (`fees_finance.services.ensure_system_accounts`, so its first fee head has an income account), creates the owner's inactive account from `contact_name` (split on the first space) and `contact_email`, gives it the shared `school_owner` default role, invites it (ADR-0033, kind `owner`, linking to `<slug>.app.<domain>`), sets `trial_ends_at` (`PLATFORM_DEFAULT_TRIAL_DAYS`) and `provisioned_at`, and moves the school to `trial`. The owner invite therefore starts the trial (§7.1), not the onboarding wizard. A second `:provision` is a 409; the same `Idempotency-Key` replays the first answer. Until plans exist (PR B), a `plan_code` is refused with a 422.
- **`:reinstate`** asks the `subscription_state` hook (`core/tenancy/subscription_state.py`, registered by PR B) for the live subscription: `active` → `active`, `past_due` → `past_due`. A `trialing` one, or none, reinstates to `trial` only with a future `trial_ends_at` in the body: a past one is a 400 on `trial_ends_at`, and so is a missing one under a `trialing` subscription; with neither a subscription nor a date it is a 409 `no_live_subscription`.
- **`:delete`** of a school that went live (`active`, `suspended`) needs a succeeded `tenant_export` job or `waive_export: true`, else a 409 `export_required`. It sets `deprovision_after = now + PLATFORM_RETENTION_DAYS`.
- **Reasons:** `:suspend`, `:delete` and `:restore` require a non-blank `reason`, stored in the audit row.
- **Timestamps:** entering `suspended` stamps `suspended_at`; leaving it for an operational status clears it. `:restore` keeps the original suspension time, and stamps one when the school was deleted without being suspended first.
- **Audit:** a person's action is audited by the view (`record_audit`, with the operator as actor and the school as tenant, before and after). The exception is `POST /platform/tenants`: its audit row has no tenant (`tenant=None`), because the school is created by that same request (deferred-work.md). A system caller (sweep, webhook) passes `actor_id=None` and the transition audits itself through `record_system_audit`.

## 8. User Journeys

- **`platform_super_admin`:** morning console review → two trials expiring this week (nudge emails) → one past-due tenant recovered via dunning → provisions a new school from a sales order → creates a per-tenant flag override to pilot the new transport module.
- **`platform_support`:** ticket "parent can't see fee invoice" → looks up tenant → requests impersonation of the school admin with reason → reproduces, finds a role misconfiguration, fixes with the tenant's consent → releases the grant; everything is in the audit log.
- **`school_owner` (touchpoint):** completes the onboarding wizard over two evenings; the checklist shows student import pending; billing page shows the trial ending date and plan options.

## 9. Inputs

- Tenant creation data (name, slug, contact, plan, trial length); lifecycle actions with reasons.
- Plan definitions (modules, limits, price, currency, billing period); subscription changes; billing-provider webhook events.
- Flag definitions and overrides; quota configurations.
- Onboarding wizard step data (tenant-side); legacy import files (Excel/CSV) + mapping selections.
- Impersonation requests (tenant, user, reason, duration).

## 10. Outputs

- Provisioned, seeded tenants; subscription invoices to schools (via billing provider); export archives; certificates of deletion.
- Usage/quota counters and platform aggregate reports.
- Events: `tenant.provisioned`, `tenant.suspended`, `subscription.updated`, `quota.threshold-reached` (internal + operator alerting).
- Import result files (accepted/rejected rows with reasons).

## 11. Validations

- Tenant slug: globally unique, DNS-safe (it becomes the subdomain), immutable after provisioning *(recommendation: rename via support process only)*.
- Lifecycle transitions restricted to the state machine (multi-tenancy §7); suspension and deletion require a reason; deletion requires a completed or explicitly-waived export.
- Plan limits must not be lowered below a tenant's current usage without an explicit override acknowledgment.
- Flag overrides must reference registered flags; kill-switch flags cannot be overridden tenant-side.
- Imports: dry-run required before commit; per-row validation mirrors the owning module's rules (e.g. student rows validate like student-management creates); batch is transactional per entity type.
- Impersonation: duration ≤ 1 h, reason mandatory, cannot impersonate platform users, cannot chain grants.

## 12. Notifications

| Event | Recipients | Channels | Template ref |
| ----- | ---------- | -------- | ------------ |
| Tenant provisioned / owner invite | School owner | Email | ADR-0033's invitation email, kind `owner` (not `notify()`) |
| Trial expiring (7/3/1 days) | School owner | Email, in-app | `platform.trial-expiring` |
| Payment failed / dunning sequence | School owner, `platform_super_admin` | Email | `platform.payment-failed` |
| Tenant suspended / reinstated | School owner; platform ops | Email, in-app | `platform.tenant-suspended` / `platform.tenant-reinstated` |
| Quota threshold reached (80% / 100%) | School owner, `it_admin`; platform ops | Email, in-app | `platform.quota-threshold` |
| Import completed / failed | Initiating admin | In-app, email | `platform.import-result` |
| Impersonation grant issued/expired | Platform ops log; tenant owner *(recommendation)* | In-app | `platform.impersonation` |

Channels and delivery behavior follow [`notifications.md`](../02-architecture/notifications.md). Codes are dotted `<module>.<event>` triggers in `apps/platform_admin/notifications.py`. *Built:* `platform.tenant-suspended` and `platform.tenant-reinstated`, sent to the school's active owners when a school leaves or returns to an operational status (a `:restore` sends neither). `notify()` is per tenant, so the platform-ops copies wait for a platform-ops channel.

## 13. Reports

Platform aggregate reports (metrics only, never row-level tenant data — multi-tenancy §8), visible per `platform.report.view`:

- **Tenant overview** — counts by lifecycle state, signups/churn per month, time-to-active.
- **Revenue** — MRR/ARR by plan, dunning recovery rate, overdue subscriptions.
- **Usage & adoption** — module adoption per plan, storage/SMS/AI-token consumption distribution, quota-pressure list.
- **Support & health** — impersonation counts, error-rate and job-failure rates per tenant (operational metrics), onboarding funnel drop-off.

Exports CSV/Excel; scheduled variants via the same job infrastructure as [`reporting-analytics.md`](reporting-analytics.md) but on the platform read path.

## 14. AI Capabilities

Cross-referenced to [`ai-features.md`](../04-ai/ai-features.md). Platform AI features never read row-level tenant data without an explicit, audited operation (imports run inside the target tenant's scope).

- **`AI-PLA-01` — AI-assisted migration mapping** *(recommendation, scope §6 "OCR/document extraction" + §22 "data migration")*: propose column-to-field mappings and data-cleanup transforms from a sample of an uploaded legacy file; human confirms the mapping before any dry run.
- **`AI-PLA-02` — Churn & health insights** *(recommendation, scope §6 "predictive analytics")*: flag tenants with declining usage or quota/dunning stress for proactive outreach; advisory only, computed from aggregate metrics.
- **`AI-PLA-03` — Onboarding assistant** *(recommendation)*: conversational helper inside the wizard that turns a school's plain-language description ("we have 3 sections per grade from KG to 10") into draft academic structure for review.

## 15. Database Entities

Full column specs in [`../05-database/entities/tenancy.md`](../05-database/entities/tenancy.md).

- **Platform-scope (no `tenant_id`):** `tenants`, `plans`, `feature_flags`.
- **Tenant-scoped:** `tenant_settings` (1:1 with tenant), `subscriptions`, `tenant_feature_overrides`, `custom_domains` (bound via website-cms UI, owned here for lifecycle/TLS).
- **Shared platform primitives referenced, not owned by this module:** `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `audit_logs`, `files`, `webhooks`, `webhook_deliveries`, `background_jobs` (defined in the same entity file; owned by the auth/platform core).

## 16. API Requirements

Conventions per [`api-architecture.md`](../02-architecture/api-architecture.md). Platform-console resources are namespaced under `/api/v1/platform/...` and built on `core.api.platform.PlatformViewSet` ([ADR-0036](../decisions/0036-platform-scope-and-cross-tenant-access.md)): an anonymous caller gets 401, any tenant principal **404**, a platform token without `"otp"` in its `amr` claim 403 `mfa_required`, and a platform user without the route's key 403. A route that touches one school's rows is nested under `tenants/{tenant_pk}/` and binds that school for the whole request (`PlatformTenantNestedMixin`). Tenant-facing touchpoints (billing view, onboarding) are normal tenant endpoints.

- `GET/POST /api/v1/platform/tenants` · `GET/PATCH /api/v1/platform/tenants/{id}` · `POST .../tenants/{id}:provision` / `:suspend` / `:reinstate` / `:export` / `:delete` / `:restore` (all with `Idempotency-Key`). *Built* (except `:export`):
  - `GET /platform/tenants` (`platform.tenant.view`): page-numbered; `?status=`, `?current_plan=`, `?subscription_status=`, `?search=` (name, slug, contact email), `?ordering=` (name, slug, status, trial_ends_at, created_at).
  - `POST /platform/tenants` (`platform.tenant.provision`): `{name, slug, contact_name, contact_email, contact_phone?}` → 201, status `provisioning`. The slug is one DNS label (`^[a-z0-9]` then `(?:[a-z0-9-]{1,61}[a-z0-9])?$`), not in `RESERVED_SLUGS` (pinned to the website's `RESERVED_LABELS`) and unused, else 400 on `slug`. Idempotent by the unique slug.
  - `GET /platform/tenants/{id}` (`.view`); `PATCH` (`.update`): name and contact fields; `slug` only while `provisioning` (else 400 on `slug`).
  - `:provision` (`.provision`, body `{plan_code?: null}`), `:suspend` (`.suspend`, `{reason}`), `:reinstate` (`.reinstate`, `{trial_ends_at?, reason?}`), `:delete` (`.delete`, `{reason, waive_export?}`), `:restore` (`.delete`, `{reason}`): each answers the tenant, and refuses with the 409 codes of §7.4.
- `POST /api/v1/platform/tenants/{id}:impersonate` — returns a time-boxed elevated token; `DELETE /api/v1/platform/impersonation-grants/{id}` releases it
- `GET/POST/PATCH /api/v1/platform/plans` · `GET/PATCH /api/v1/platform/subscriptions/{id}` · billing webhooks at `POST /api/v1/platform/billing-events` (HMAC-verified)
- `GET/POST/PATCH /api/v1/platform/feature-flags` · `GET/POST/DELETE /api/v1/platform/tenants/{id}/feature-overrides`
- `GET /api/v1/platform/tenants/{id}/usage` · `GET /api/v1/platform/reports/{key}` (aggregate read path)
- `POST /api/v1/platform/tenants/{id}/imports` (`202` + job, dry-run flag) · `GET /api/v1/platform/imports/{id}`
- Tenant-facing: `GET /api/v1/subscription` (own billing state, `school_owner`) · `GET/PATCH /api/v1/onboarding` (wizard progress).
- Operator sign-in (built, `core/rbac`, under `/api/v1/auth/`, §4): `POST /auth/login` → `{mfa_required, mfa_token}` · `POST /auth/mfa:verify` · `POST /auth/mfa:enroll` · `POST /auth/mfa:confirm` · `POST /auth/mfa:disable` (always 403 for an operator).

## 17. Integration Requirements

- **Billing provider** (e.g. Stripe or regional equivalent — *recommendation, gateway-agnostic adapter*): subscription invoicing, payment webhooks, dunning.
- **DNS/TLS edge** for subdomain wildcard + custom-domain issuance (shared with website-cms).
- **Email provider** for platform transactional mail; **object storage** for export archives and import files.
- **Observability stack** (metrics per tenant) feeding health reports; AI gateway for `AI-PLA-*` with platform-level budgets.

## 18. Dependencies on Other Modules

| Module | Direction | What is shared |
| ------ | --------- | -------------- |
| all tenant modules | outbound | Feature-flag and quota enforcement; module enablement per plan |
| website-cms | outbound | Suspension notice on public sites; custom-domain lifecycle |
| reporting-analytics | boundary | Tenant reporting stays tenant-side; platform aggregates stay here |
| fees-finance | none (namesake only) | School-side fee billing is unrelated to platform subscription billing |
| student-management / staff-management / examinations / fees-finance | outbound | Import pipelines write into these modules' entities under their validations |

## 19. Open Questions / Recommendations

- Billing provider choice, proration/grandfathering rules, manual-invoicing mode, and percentage flag rollouts are **recommendations** pending commercial decisions; pricing currency is per-plan configurable, no country assumed.
- Self-service signup vs. sales-assisted provisioning (or both) needs a client decision; the API supports both.
- Tenant-visible impersonation log and `AI-PLA-*` features are **recommendations**.
- Data residency/region pinning per tenant is out of initial scope; flagged for the compliance review (scope §22).

## 20. Implementation status

**Built (PR A — platform scope, MFA and the tenant lifecycle):**

- **Platform scope and sign-in:** scoped permission keys, the shared default roles, `PlatformViewSet` and TOTP MFA (§4, §16, [ADR-0036](../decisions/0036-platform-scope-and-cross-tenant-access.md)).
- **Tenants** (`apps/platform_admin/tenants/`, ADR-0010 layout): `viewset.py` (two viewsets: the list and create bind no tenant; `tenants/{tenant_pk}` and its colon-actions bind that school through `PlatformTenantNestedMixin`), `serializers.py`, `filters.py`, `services.py` (create, edit, provision, reinstate, delete, restore, the slug rules and the `owner` invitation's eligibility hook) and `lifecycle.py` (the state machine of §7.4: `ALLOWED_TRANSITIONS`, `transition(tenant, to, *, actor_id: UUID | None, reason="")`, `InvalidTransition`, `RetentionExpired`). `:delete` routes to the `deprovision` action, since a viewset method named `delete` would also answer the HTTP `DELETE` verb.
- **`tenants` columns** (`core/tenancy` migration `0010`): `contact_name`, `contact_email`, `contact_phone`, `provisioned_at`, `deprovision_after`, and the denormalised subscription read model `current_plan` (a plan code), `subscription_status` and `billing_provider_ref` (unique when set). They are plain columns, not a foreign key to `plans`: `core` never references this app (ADR-0013). PR B's subscription services write them with each subscription change.
- **Hooks** (`apps/platform_admin/hooks.py`, called from `PlatformAdminConfig.ready()`): every seam this app fills in `core` is registered there. PR A registers the `owner` invitation eligibility check (the account still holds `school_owner`). `core/tenancy/subscription_state.py` is the seam `:reinstate` reads; PR B registers its resolver.
- **Notifications** (`apps/platform_admin/notifications.py`): `platform.tenant-suspended` and `platform.tenant-reinstated`, in-app and email, to the school's active owners (§12).
- **Constants** (`apps/platform_admin/constants.py`): `SLUG_PATTERN`, `RESERVED_SLUGS` (pinned to `apps/website/src/lib/host.ts` by `test_reserved_labels_match_website`) and `TENANT_EXPORT_JOB_TYPE = "tenant_export"`, the job a later PR's `:export` creates.
- **Tests:** `apps/platform_admin/tests/test_lifecycle.py` (every status pair, timestamps, system audit, notices) and `test_tenants_api.py` (create, edit, provision, the lifecycle actions, gates); the live lane's `e2e/tests/live/api/platform-tenants.spec.ts` signs in as the seeded TOTP operator (`seed_e2e_data`) and runs create → provision → suspend → reinstate.

**Not yet built:** plans, subscriptions and billing (PR B); usage, quotas, reports and `:export` (PR C); the console screens (PR D); impersonation (PR E); the onboarding wizard (PR H). Deferred items are in [`deferred-work.md`](../deferred-work.md).
