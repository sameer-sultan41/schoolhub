# Phase 6 — Launch (Deployment, Production Configuration, Go-Live)

> **Agent Context**
> **Summary:** Covers lifecycle activities 14–16 (deployment, production configuration, monitoring & logging go-live). Stands up production infrastructure, works through an auditable configuration checklist, turns instrumentation into live alerting with an on-call rota, proves backup/DR by drill, onboards the pilot tenants, and executes a rehearsed launch-day runbook with a tested rollback plan. ~2 weeks is a **recommendation**.
> **Co-load with:** [`phase-plan.md`](phase-plan.md) · [`../02-architecture/hosting-deployment.md`](../02-architecture/hosting-deployment.md) · [`../02-architecture/multi-tenancy.md`](../02-architecture/multi-tenancy.md) · [`phase-5-testing.md`](phase-5-testing.md)

## Objective

Take the signed-off release candidate live: production infrastructure provisioned and hardened, pilot tenants onboarded with their real data, monitoring and alerting active with an on-call rota, and a rollback path proven before — not after — real schools depend on the system.

## Entry Criteria

- Phase 5 exit criteria met: release candidate tagged, zero criticals, UAT signed, capacity model delivered.
- Hosting platform and cost tier confirmed per [`hosting-deployment.md`](../02-architecture/hosting-deployment.md); production accounts and billing in place.
- Production provider credentials issued (payment gateway live keys, SMS/WhatsApp/email production senders) — kept out of staging until this phase.
- On-call rota drafted and support process agreed with [`phase-7-operate.md`](phase-7-operate.md) owners.

## Activities

### 1. Production infrastructure

- Provision per the deployment architecture: containerized app + workers, PostgreSQL (HA per hosting doc), Redis, object storage, CDN/edge for wildcard subdomains and custom-domain TLS automation ([`multi-tenancy.md`](../02-architecture/multi-tenancy.md) §4).
- Environment separation enforced: production secrets in the secrets manager only, distinct keys per environment, least-privilege service accounts; no human write access to the production DB outside break-glass.
- CI/CD promotion path: staging artifact → manual approval → production deploy with automated migrations and health-check-gated rollout.
- Sizing from the Phase 5 capacity model, with headroom ≥ 2× pilot peak (recommendation).

### 2. Production configuration checklist (auditable, two-person verified)

| Area | Items (abridged) |
| ---- | ---------------- |
| Domains & TLS | Platform/app/API domains, wildcard tenant subdomains, custom-domain automation, HSTS |
| Security | Debug off, allowed hosts, CORS/CSRF config, security headers, rate-limit tiers, admin surface IP/SSO restrictions per [`../06-security/security.md`](../06-security/security.md) |
| Database | RLS verified on prod (scripted check on every tenant-owned table), connection pooling, statement timeouts |
| Providers | Live payment/SMS/WhatsApp/email credentials, webhook endpoints re-registered for prod URLs, sender identities verified |
| AI gateway | Production provider keys, tenant budgets set per plan, kill switch tested ([`phase-3-ai.md`](phase-3-ai.md)) |
| Email deliverability | SPF/DKIM/DMARC on platform sender domains |
| Feature flags | Launch configuration applied per tenant plan; non-launch modules off |
| Jobs & schedules | Celery beat schedules (reports, reconciliation, backups verification) enabled |

Every line is checked, dated, and initialed by two people; the completed checklist is a launch artifact.

### 3. Monitoring, logging, alerting go-live

- Instrumentation has existed since Phase 2; this phase turns on **paging**: uptime probes on app/API/website/webhooks, error-rate and latency SLO alerts (thresholds from the Phase 5 capacity model), queue-depth and worker-health alerts, DB replication/disk alerts, payment-callback failure alerts, AI budget/failure-rate alerts.
- Structured logs centralized with request-ID correlation; log retention and access controls configured per data-privacy policy.
- Dashboards: platform health, per-tenant activity, payment and notification delivery, AI usage. On-call rota activated with escalation policy and alert-runbook links.

### 4. Backup + DR drill (proven, not assumed)

- Automated encrypted backups: continuous WAL archiving + nightly snapshots (recommendation), object-storage versioning, off-site copy; RPO ≤ 15 min, RTO ≤ 4 h (recommendations to confirm with client).
- **Drill before go-live:** restore production backup into an isolated environment, verify integrity (row counts, a tenant's ledgers reconcile, files retrievable), and time the full restore against RTO. A tenant-scoped restore/export is exercised too ([`multi-tenancy.md`](../02-architecture/multi-tenancy.md) §7). Results recorded; the drill repeats on a cadence in [`phase-7-operate.md`](phase-7-operate.md).

### 5. Pilot tenant onboarding

- Provision each pilot tenant through the real onboarding wizard (dogfooding it), apply branding/domain, run the **production** legacy-data import (rehearsed in Phase 4), verify with the school's champion, and issue staff credentials via invitation flow.
- Staggered go-live (recommendation): tenant 1 → 2–3 days observation → remaining pilots. Parents invited only after staff have run the system for several days.

### 6. Rollback plan

- App rollback: redeploy previous artifact (minutes); migrations are backward-compatible for one release (expand/contract pattern) so rollback never requires a down-migration under pressure.
- Data rollback: point-in-time recovery per the DR drill; tenant-scoped incident → tenant suspension + targeted restore rather than platform rollback.
- Defined triggers (sustained SLO breach, payment integrity fault, isolation incident) and the named decision-maker; rollback rehearsed once on staging as part of runbook prep.

### 7. Launch-day runbook

Timed, owner-assigned script: pre-flight checks → deploy window → smoke suite (scripted E2E: login, attendance, invoice, payment sandbox-to-live canary, notification, website render) → tenant activation order → hourly health reviews → comms plan (school champions, internal channel, status page) → end-of-day review. Includes "stop" criteria referencing the rollback triggers.

## Deliverables

- Production environment live and hardened; completed two-person configuration checklist.
- Active alerting + on-call rota + alert runbooks; dashboards published.
- DR drill report with measured RPO/RTO; backup schedule live.
- Pilot tenants live on production with imported data and verified branding/domains.
- Rollback plan (tested) and executed launch-day runbook with sign-offs.

## Roles Involved

- **DevOps/infra engineer** (lead: infra, CI/CD, monitoring, backups) · **Tech lead** (launch decision-maker, rollback authority) · **Backend/frontend engineers** (smoke fixes, on-call) · **QA** (production smoke suite) · **PM** (runbook coordination, school comms) · **Pilot-school champions** (data verification, go-live confirmation) · **Client sponsor** (go/no-go).

## Exit Criteria

Matches [`phase-plan.md`](phase-plan.md) §3: **pilots live on production, on-call rota active**, specifically:

1. All pilot tenants operating daily on production (staff active; parents invited).
2. Configuration checklist 100% complete and archived; smoke suite green in production.
3. Alerting live with at least one full on-call handover completed.
4. DR drill passed within RPO/RTO targets; backup jobs verified running.
5. One week of production operation without a Critical incident (or incidents resolved within SLO with post-incident reviews written).

## Risks & Mitigations

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| Config drift between staging and production | "Worked on staging" failures | Infra as code; two-person checklist; production smoke suite before tenant activation |
| Production import surprises despite rehearsal | Bad data at go-live | Same tooling + dry-run in production; champion verification before staff invites |
| Alert storm or dead-silent monitoring | Missed or drowned incidents | Alert thresholds from measured Phase 5 data; alert review in the first-week hyper-care |
| Rollback impossible due to irreversible migration | Stuck on a bad release | Expand/contract migration policy enforced from Phase 2; verified at release tagging |
| Custom-domain/TLS automation fails for a tenant | School website down at launch | Wildcard subdomain always available as fallback; custom domains cut over post-stabilization |
| Team burnout during launch week | Slow incident response | Staggered go-live, defined hyper-care rota, no feature work during launch window |
