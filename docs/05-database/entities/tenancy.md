# Entities: Tenancy, Identity & Platform Core

> **Agent Context** — Load this block first.
> **Summary:** Column-level specs for the platform core: tenants, settings, plans/subscriptions, feature flags, custom domains, identity & RBAC (`users`, `roles`, `permissions`, junctions), `audit_logs`, `files`, webhooks, background jobs, and the reporting configuration tables (`saved_reports`, `report_schedules`). These tables underpin every other entity file — their names are the locked vocabulary for all FKs into the platform core.
> **Co-load with:** `../../02-architecture/multi-tenancy.md` · `../../02-architecture/auth-and-rbac.md` · `../../03-modules/platform-admin.md`

**Conventions (locked, per [`database-architecture.md`](../../02-architecture/database-architecture.md)):** every **tenant-owned** table implicitly has `id UUID PK`, `tenant_id UUID NOT NULL FK → tenants(id)` (RLS-enforced), `created_at`/`updated_at`, `created_by`/`updated_by` (FK → users), and `deleted_at` (soft delete). These are **not repeated** below; only exceptions are stated. Tables marked **Platform scope** have **no `tenant_id`** (and no RLS policy); they retain `id`, timestamps, actor, and soft-delete columns unless noted.

---

### tenants
**Platform scope — no `tenant_id`.** One row per school organization; the root of all tenant isolation.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| name | varchar(200) | no | — | Legal/display name |
| slug | varchar(63) | no | — | Unique, DNS-safe; becomes `<slug>.<platform-domain>`; immutable after provisioning |
| status | varchar(20) | no | `'provisioning'` | Enum: `provisioning` `trial` `active` `past_due` `suspended` `deprovisioned` (multi-tenancy §7) |
| contact_name | varchar(200) | yes | — | Primary commercial contact |
| contact_email | varchar(254) | no | — | Owner invite target |
| contact_phone | varchar(30) | yes | — | |
| trial_ends_at | timestamptz | yes | — | Set at provisioning |
| provisioned_at | timestamptz | yes | — | Seed transaction completed |
| suspended_at | timestamptz | yes | — | With reason in `audit_logs` |
| deprovision_after | timestamptz | yes | — | End of 90-day retention window |

Indexes: unique(slug); (status).
Relationships: 1:1 `tenant_settings`; 1:N `subscriptions`, `custom_domains`, `users`, and every tenant-owned table platform-wide.

### tenant_settings
Per-tenant configuration and branding; exactly one row per tenant (multi-tenancy §5).

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| locale | varchar(10) | no | `'en'` | Default tenant locale; additional locales in `settings` |
| timezone | varchar(50) | no | `'UTC'` | Tenant-configurable, no country assumed |
| currency | char(3) | no | — | ISO 4217, tenant-configurable |
| logo_file_id | uuid | yes | — | FK → files |
| favicon_file_id | uuid | yes | — | FK → files |
| branding | jsonb | no | `'{}'` | Colors, fonts — consumed by dashboard theming and website theme |
| workflow_settings | jsonb | no | `'{}'` | Approval-chain configuration per module (module docs §7) |
| settings | jsonb | no | `'{}'` | Remaining typed-later configuration (JSONB per multi-tenancy §5) |

Indexes: unique(tenant_id).
Relationships: 1:1 `tenants`; referenced by website-cms and all modules for branding/workflow config.

The implementation splits the spec's single `settings` column into named namespaces on the same
row — `branding`, `academic`, `features` and `hr` — so each module reads a key it owns rather than
one shared bag. `academic` carries the school calendar: `working_days` (weekday numbers, 0=Monday),
`holidays` (`[{start_date, end_date, name, campus_id}]`, null `campus_id` = every campus) and `day_window`
(`{start, end, grace_minutes}`). `apps/school_organization/calendar.py` is the only reader;
`attendance` refuses to mark on a non-working day and computes `late_minutes` from the window.

### plans
**Platform scope — no `tenant_id`.** Subscription tier catalog controlling modules and limits (multi-tenancy §6).

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| name | varchar(100) | no | — | e.g. Basic / Standard / Premium |
| code | varchar(50) | no | — | Unique, stable key |
| description | text | yes | — | |
| price_amount | numeric(12,2) | no | — | Per billing period |
| currency | char(3) | no | — | Per-plan billing currency, none assumed |
| billing_period | varchar(10) | no | `'monthly'` | Enum: `monthly` `annual` |
| trial_days | integer | no | `14` | *(default is a recommendation)* |
| enabled_modules | jsonb | no | `'[]'` | Module keys enabled at this tier |
| limits | jsonb | no | `'{}'` | Quotas: `students`, `staff`, `storage_gb`, `sms_credits`, `ai_tokens`, … |
| is_active | boolean | no | `true` | Inactive plans hidden from new subscriptions |

Indexes: unique(code); (is_active).
Relationships: 1:N `subscriptions`.

### subscriptions
A tenant's subscription to a plan; billing state drives the tenant lifecycle.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| plan_id | uuid | no | — | FK → plans |
| status | varchar(20) | no | `'trialing'` | Enum: `trialing` `active` `past_due` `canceled` |
| current_period_start | timestamptz | no | — | |
| current_period_end | timestamptz | no | — | |
| canceled_at | timestamptz | yes | — | |
| billing_provider | varchar(30) | yes | — | Adapter key (provider-agnostic, platform-admin §17) |
| billing_provider_ref | varchar(120) | yes | — | External subscription/customer id |
| limits_override | jsonb | yes | — | Negotiated per-tenant limit overrides *(recommendation)* |

Indexes: (tenant_id, status); unique(tenant_id) where status in (`trialing`,`active`,`past_due`) — one live subscription per tenant.
Relationships: N:1 `tenants`, `plans`.

### feature_flags
**Platform scope — no `tenant_id`.** Registry of feature flags with per-plan defaults; kill-switch capable.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| key | varchar(100) | no | — | Unique, e.g. `module.transport`, `ai.nl-queries` |
| description | text | no | — | |
| default_enabled | boolean | no | `false` | Fallback when neither plan nor override applies |
| is_kill_switch | boolean | no | `false` | Kill switches cannot be overridden per tenant |

Indexes: unique(key).
Relationships: 1:N `tenant_feature_overrides`; referenced by plan `enabled_modules` resolution.

### tenant_feature_overrides
Per-tenant flag override on top of plan defaults.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| feature_flag_id | uuid | no | — | FK → feature_flags |
| enabled | boolean | no | — | Override value |
| reason | text | no | — | Why the override exists (pilot, support, commercial) |
| expires_at | timestamptz | yes | — | Auto-lapse back to plan default |

Indexes: unique(tenant_id, feature_flag_id).
Relationships: N:1 `tenants`, `feature_flags`.

### custom_domains
A tenant's custom domain(s) for its public website (multi-tenancy §4; bound via website-cms).

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| domain | varchar(253) | no | — | Globally unique FQDN across all tenants |
| status | varchar(20) | no | `'pending_dns'` | Enum: `pending_dns` `verifying` `active` `failed` `disabled` |
| verification_token | varchar(64) | no | — | DNS TXT/CNAME challenge value |
| verified_at | timestamptz | yes | — | |
| tls_status | varchar(20) | no | `'pending'` | Enum: `pending` `issued` `failed` (edge-automated) |
| is_primary | boolean | no | `false` | One primary per tenant |

Indexes: unique(domain); (tenant_id, is_primary).
Relationships: N:1 `tenants`; consumed by the website renderer for domain→tenant resolution.

### users
All user accounts — tenant members **and** platform staff. **Exception:** `tenant_id` is **nullable**; `NULL` = platform-scope account (auth-and-rbac §1).

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| email | varchar(254) | yes | — | Unique per tenant; young students may have none |
| phone | varchar(30) | yes | — | Alternate credential |
| username | varchar(100) | yes | — | School-issued (`{tenant-slug}\{admission-no}` style), unique per tenant |
| password_hash | varchar(255) | no | — | Argon2id |
| first_name | varchar(100) | no | — | |
| last_name | varchar(100) | yes | — | |
| avatar_file_id | uuid | yes | — | FK → files |
| status | varchar(20) | no | `'invited'` | Enum: `invited` `active` `disabled` `locked` |
| locale | varchar(10) | yes | — | Falls back to tenant locale |
| timezone | varchar(50) | yes | — | Falls back to tenant timezone |
| mfa_enabled | boolean | no | `false` | TOTP (auth-and-rbac §1) |
| mfa_secret | varchar(255) | yes | — | Encrypted at rest |
| last_login_at | timestamptz | yes | — | |
| password_changed_at | timestamptz | yes | — | |

Indexes: unique(tenant_id, email) [partial: email not null]; unique(tenant_id, username) [partial]; partial unique(email) where tenant_id is null (platform staff); (tenant_id, status).
Relationships: 1:N `user_roles`, `audit_logs` (as actor); 1:1 optional links from `students`/`staff`/guardians in [`people.md`](people.md).

### roles
Named permission sets. **Exception:** `tenant_id` nullable — `NULL` = platform-seeded default role (visible to all tenants, release-managed); non-null = tenant custom role.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| slug | varchar(60) | no | — | Locked vocabulary from [`users-and-roles.md`](../../00-overview/users-and-roles.md) for defaults |
| name | varchar(100) | no | — | Display name |
| description | text | yes | — | |
| scope | varchar(10) | no | `'tenant'` | Enum: `platform` `tenant` — platform roles never assignable to tenant users |
| is_default | boolean | no | `false` | True for platform-seeded roles |
| is_restricted | boolean | no | `false` | True for `student`/`guardian` (can never receive staff permission keys) |

Indexes: unique(tenant_id, slug) [defaults: partial unique(slug) where tenant_id is null].
Relationships: 1:N `role_permissions`, `user_roles`.

### permissions
**Platform scope — no `tenant_id`.** Code-defined permission keys, migration-seeded; tenants never create rows. **Exception:** no soft delete (`deleted_at` absent) — keys are only ever added.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| key | varchar(120) | no | — | Unique, `module.resource.action` (auth-and-rbac §2.1) |
| module | varchar(40) | no | — | e.g. `fees`, `website`, `platform` |
| description | text | no | — | |
| is_financial | boolean | no | `false` | Extra audit requirements (RBAC §2.4) |
| is_staff_only | boolean | no | `false` | Never grantable to restricted roles |

Indexes: unique(key); (module).
Relationships: 1:N `role_permissions`.

### role_permissions
Junction: which permissions a role contains. **Exception:** `tenant_id` nullable, always mirrors `roles.tenant_id`.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| role_id | uuid | no | — | FK → roles |
| permission_id | uuid | no | — | FK → permissions |

Indexes: unique(role_id, permission_id).
Relationships: N:1 `roles`, `permissions`.

### user_roles
Junction: role assignment to a user, with optional record-level scope (auth-and-rbac §2.3).

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| user_id | uuid | no | — | FK → users |
| role_id | uuid | no | — | FK → roles; role scope must match user scope |
| record_scope | varchar(20) | no | `'all'` | Enum: `own` `assigned` `campus` `all` |
| scope_ref | uuid | yes | — | e.g. campus id when record_scope = `campus` |

Indexes: unique(user_id, role_id); (role_id).
Relationships: N:1 `users`, `roles`.

### audit_logs
Immutable audit trail of every mutation and security event (auth-and-rbac §4). **Exceptions:** append-only — no `updated_at`/`updated_by`/`deleted_at`; `tenant_id` nullable (platform-scope actions); `created_by` replaced by explicit `actor_id`.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| actor_id | uuid | yes | — | FK → users; null for system jobs |
| impersonated_by | uuid | yes | — | FK → users (platform support) when acting under a grant |
| action | varchar(60) | no | — | e.g. `update`, `approve`, `export`, `login_failed` |
| resource_type | varchar(80) | no | — | Table/entity name |
| resource_id | uuid | yes | — | |
| before | jsonb | yes | — | PII-minimized snapshot |
| after | jsonb | yes | — | PII-minimized snapshot |
| request_id | varchar(64) | yes | — | Correlates with `X-Request-ID` |
| ip | inet | yes | — | |
| user_agent | varchar(400) | yes | — | |

Indexes: (tenant_id, created_at); (tenant_id, resource_type, resource_id); (actor_id, created_at).
Relationships: N:1 `users` (actor, impersonator). App DB role has INSERT/SELECT only.

### files
Registry of every uploaded/generated object in storage (api-architecture §2.8). **Exception:** `tenant_id` nullable (platform assets, e.g. theme previews).

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| storage_key | varchar(512) | no | — | Unique; prefixed `tenants/{tenant_id}/…` (multi-tenancy §3) |
| original_name | varchar(255) | no | — | |
| mime_type | varchar(120) | no | — | Whitelist-validated |
| size_bytes | bigint | no | — | Counted against storage quota |
| checksum | varchar(64) | yes | — | SHA-256 |
| status | varchar(20) | no | `'pending'` | Enum: `pending` `ready` `quarantined` (AV scan) |
| visibility | varchar(20) | no | `'private'` | Enum: `private` `public` (public-website media) |
| av_scanned_at | timestamptz | yes | — | |

Indexes: unique(storage_key); (tenant_id, status).
Relationships: referenced by every module storing documents/media (FK columns named `*_file_id`).

### webhooks
Tenant-configured outbound webhook endpoints (api-architecture §2.6).

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| url | varchar(500) | no | — | HTTPS only |
| secret | varchar(255) | no | — | Encrypted; HMAC-SHA256 signing key |
| events | jsonb | no | `'[]'` | Subscribed event types, e.g. `["fee.paid","result.published"]` |
| description | varchar(200) | yes | — | |
| is_active | boolean | no | `true` | Auto-disabled after sustained dead-lettering *(recommendation)* |

Indexes: (tenant_id, is_active).
Relationships: 1:N `webhook_deliveries`.

### webhook_deliveries
Delivery attempts per webhook event. **Exceptions:** no soft delete; no `updated_by` (system-written); pruned by retention policy.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| webhook_id | uuid | no | — | FK → webhooks |
| event_type | varchar(80) | no | — | |
| payload | jsonb | no | — | Signed body as sent |
| status | varchar(20) | no | `'pending'` | Enum: `pending` `delivered` `failed` `dead_letter` |
| attempt_count | integer | no | `0` | Max 8, exponential backoff |
| last_response_status | integer | yes | — | HTTP status of last attempt |
| next_retry_at | timestamptz | yes | — | |
| delivered_at | timestamptz | yes | — | |

Indexes: (webhook_id, status); (status, next_retry_at).
Relationships: N:1 `webhooks`.

### background_jobs
Tracked long-running operations surfaced at `GET /api/v1/jobs/{id}` (api-architecture §2.7). **Exceptions:** `tenant_id` nullable (platform jobs); no soft delete — pruned by retention policy.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| job_type | varchar(60) | no | — | e.g. `report.export`, `import.students`, `documents.bulk-generate` |
| status | varchar(20) | no | `'queued'` | Enum: `queued` `running` `succeeded` `failed` |
| progress | integer | no | `0` | 0–100 |
| payload | jsonb | no | `'{}'` | Input parameters (PII-minimized) |
| result | jsonb | yes | — | Result summary / link (e.g. `result_file_id`) |
| error | text | yes | — | Failure detail |
| idempotency_key | varchar(64) | yes | — | Unique per tenant when present |
| celery_task_id | varchar(64) | yes | — | Broker correlation |
| started_at | timestamptz | yes | — | |
| finished_at | timestamptz | yes | — | |

Indexes: (tenant_id, status, created_at); unique(tenant_id, idempotency_key) [partial].
Relationships: initiator = `created_by`; permission context is the initiator's (RBAC §3).

### saved_reports
*(recommendation)* Named report + filter configuration owned by [`reporting-analytics.md`](../../03-modules/reporting-analytics.md).

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| name | varchar(150) | no | — | Unique per owner (`created_by`) |
| report_key | varchar(80) | no | — | Catalog report identifier |
| config | jsonb | no | `'{}'` | Filters, columns, grouping, chart prefs |
| visibility | varchar(20) | no | `'private'` | Enum: `private` `role` `tenant`; viewers re-checked against source permissions at run time |
| shared_role_id | uuid | yes | — | FK → roles, when visibility = `role` |

Indexes: unique(tenant_id, created_by, name); (tenant_id, report_key).
Relationships: 1:N `report_schedules`; N:1 `roles`.

### report_schedules
*(recommendation)* Recurring delivery of a saved report (reporting-analytics §5).

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| saved_report_id | uuid | no | — | FK → saved_reports |
| frequency | varchar(20) | no | — | Enum: `daily` `weekly` `monthly` `term_end` |
| run_at | jsonb | no | `'{}'` | Frequency detail (weekday, day-of-month, time) in tenant timezone |
| format | varchar(10) | no | `'pdf'` | Enum: `pdf` `xlsx` `csv` |
| recipients | jsonb | no | `'[]'` | User ids and/or role slugs |
| is_active | boolean | no | `true` | Auto-paused if owner loses permissions |
| last_run_at | timestamptz | yes | — | |
| last_run_status | varchar(20) | yes | — | Enum: `succeeded` `failed` |
| next_run_at | timestamptz | yes | — | Celery beat cursor |

Indexes: (tenant_id, is_active, next_run_at); (saved_report_id).
Relationships: N:1 `saved_reports`; executions recorded as `background_jobs`.

---

## Relationship overview

- `tenants` 1:1 `tenant_settings`; 1:N `subscriptions` (one live), `custom_domains`, `tenant_feature_overrides`, `users` (nullable for platform staff).
- Identity: `users` N:M `roles` via `user_roles` (with record scope); `roles` N:M `permissions` via `role_permissions`.
- Platform-scope tables (`tenants`, `plans`, `feature_flags`, `permissions`, plus `themes` in [`website-cms.md`](website-cms.md)) carry no `tenant_id` and are exempt from RLS; every other table here participates in the RLS policy from [`multi-tenancy.md`](../../02-architecture/multi-tenancy.md) §3.
