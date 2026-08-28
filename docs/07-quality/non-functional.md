# Non-Functional Requirements

> **Agent Context**
> **Summary:** Quality attributes and cross-cutting production requirements: performance and capacity targets, availability, observability, accessibility, localization/timezone, data retention, compliance, import/export and bulk operations, search, activity logs, configurable workflows, PDF generation, SEO, and disaster recovery. Numeric targets are **recommendations** to be baselined at Phase 0. Section numbers here are referenced by other docs — renumber with care.
> **Co-load with:** [`../00-overview/requirements.md`](../00-overview/requirements.md) · [`../06-security/security.md`](../06-security/security.md) · [`testing-strategy.md`](testing-strategy.md)

## 1. Performance (recommendations)

| Operation class | Target |
| --------------- | ------ |
| API reads (lists, detail, dashboards) | p95 < 400 ms, p99 < 1 s |
| API writes (single-record mutations) | p95 < 800 ms |
| Bulk operations & report generation | Always asynchronous (job pattern, [`../02-architecture/api-architecture.md`](../02-architecture/api-architecture.md) §2.7); job pickup < 5 s; user sees progress |
| Public website pages | LCP < 2.5 s on mid-range mobile over 4G (SSR/ISR cached at the CDN) |
| Dashboard first load | Interactive < 3 s on broadband; subsequent navigations < 1 s (client cache) |
| Notification fan-out | 10k recipients enqueued < 60 s (delivery is provider-bound) |

Budgets are enforced by the load-test profiles in [`testing-strategy.md`](testing-strategy.md) §7 and monitored as SLOs (§4).

## 2. Capacity Model (recommendation)

Initial deployment sizing assumptions — re-baselined from real telemetry each quarter:

- **Tenants:** 200 schools, median 600 students each → ~120k students, ~15k staff, ~150k guardian accounts.
- **Traffic shape:** sharp morning attendance spike (most sections marked within 60 min), fee-day peaks at month boundaries, result-publish bursts per term. Peak design point: 300 requests/s sustained, 1,000 requests/s burst.
- **Data volume:** attendance dominates rows (~120k students × ~200 school days ≈ 24M rows/session/year) — partitioning strategy in [`../02-architecture/database-architecture.md`](../02-architecture/database-architecture.md).
- **Scale path:** the shared-schema design scales vertically first, then read replicas for reporting, then table partitioning; no re-architecture below ~1,000 tenants (see [`../02-architecture/multi-tenancy.md`](../02-architecture/multi-tenancy.md) §2).

## 3. Availability (recommendation)

- **Target: 99.5% monthly** initially (≈ 3.6 h/month error budget), raising to 99.9% as paid tiers demand it.
- Planned maintenance announced ≥ 48 h ahead, scheduled outside school hours of affected tenants' timezones where possible.
- Graceful degradation: AI features, search, and notifications may degrade independently without blocking core CRUD (feature-flag kill switches).
- Public websites are CDN-cached and must survive short API outages serving cached content.

## 4. Observability

Per [`../02-architecture/tech-stack.md`](../02-architecture/tech-stack.md) §5:

- **Structured JSON logs** with mandatory `request_id` and `tenant_id` fields on every line; no PII in logs; centralized (Loki/CloudWatch) with retention per §8.
- **Metrics:** RED metrics per endpoint, queue depths, job latencies, DB/RLS health, per-tenant usage counters (feeding plan quotas), AI token spend per tenant.
- **Tracing:** distributed traces across API → Celery → DB for slow-path diagnosis (OpenTelemetry — recommendation).
- **Error tracking:** Sentry on backend, frontend, and workers, release-tagged with source maps.
- **SLO dashboards + alerting:** availability, latency, job backlog, notification delivery failure rate, and the security signals in [`../06-security/security.md`](../06-security/security.md) SEC-19.

## 5. Accessibility

- **WCAG 2.1 AA** for both the admin dashboard and public school websites: keyboard operability, visible focus, semantic landmarks, form labels/errors, contrast ≥ 4.5:1, no color-only meaning (relevant to attendance/result status indicators).
- Automated axe checks in CI on key screens + manual screen-reader pass (NVDA/VoiceOver) per release on critical flows (attendance marking, fee payment, marks entry).
- Public website theme must ship accessible by default — tenant branding choices (colors) are contrast-validated with a warning on failure.

## 6. Localization & Internationalization

- All user-facing strings externalized (`next-intl` frontend, Django i18n backend); initial languages English + Urdu (recommendation), architecture supports adding languages without code changes.
- **Full RTL support** — layouts mirror correctly; the design system is direction-aware.
- **Per-tenant:** locale(s), timezone, currency, first day of week, date/number formats. No country is assumed platform-wide.
- All timestamps stored UTC; rendered in tenant timezone; date-only academic facts (attendance date, due date) stored as dates, not timestamps.
- Notification templates localizable per tenant language; per-user language preference where a tenant enables multiple languages.

## 7. Academic-Calendar Configurability

- Tenants define sessions, terms, weekly working days, holiday calendars, and campus-specific overrides ([`../03-modules/school-organization.md`](../03-modules/school-organization.md)).
- All date-driven behavior (attendance validity, fee due dates, timetable generation, late fines) derives from the tenant calendar — never hard-coded weekend or year assumptions.

## 8. Data Retention (per data class — recommendations, tenant-adjustable within legal floors)

| Data class | Retention |
| ---------- | --------- |
| Academic records (enrollments, results, transcripts) | Life of tenant + export at offboarding |
| Financial records (invoices, payments, payroll) | ≥ 7 years (configurable per jurisdiction) |
| Attendance detail | 3 years detail, aggregates thereafter |
| Audit logs | 2 years online, archived to 7 |
| Application logs/traces | 30–90 days |
| Admissions leads (non-enrolled) | 24 months then purge |
| Notification delivery records | 12 months |
| Backups | Per DR policy (§16); deleted-tenant data ages out within 90 days |
| Deleted tenants | 90-day soft retention → hard purge ([`../02-architecture/multi-tenancy.md`](../02-architecture/multi-tenancy.md) §7) |

## 9. Compliance Considerations

- **GDPR-style subject rights** implemented product-wide regardless of market: access (self-service export), rectification, erasure (with financial/academic legal-retention carve-outs), processing records. Guardians exercise rights for minor children.
- **Children's data:** minimization, consent capture, publication flags, and AI redaction per security.md SEC-17 — treated as the strictest constraint.
- **Local education regulations: placeholder** — per-market requirements (mandated registers, board reporting formats, data-residency rules) are cataloged at market entry during Phase 0/market launch; the tenant-configurable design (templates, fields, retention) is the mechanism for absorbing them without code forks.
- Data-processing agreements with all sub-processors (LLM, SMS, email, payments, hosting) listed and kept current.

## 10. Import/Export & Bulk Operations

- **Excel/CSV import** for students, staff, guardians, marks, fee structures, library catalog, inventory, and legacy-system migration: template download → upload → server-side validation report (row-level errors, nothing partially applied on structural failure) → confirm → async job with progress and downloadable error file.
- **Export** on every major list view (CSV/Excel) respecting the viewer's permissions and record scopes; exports are audited events (security.md SEC-17.5) and run async above a size threshold.
- **Bulk operations** (promote section, assign fee structure, send notices, issue admit cards) are permission-gated, previewed (count + sample), idempotent, and audited as one logical action with per-row outcomes.

## 11. Search & Advanced Filtering

- Per-module list filtering with whitelisted fields, operators (`__gte`, `__lte`, ranges, status sets), and saved filters per user.
- Tenant-wide global search (students, staff, invoices, notices) with permission-trimmed results — a user only sees hits they could open. Postgres full-text initially (tech-stack.md §4); every index entry carries `tenant_id`.
- AI natural-language search layers on top of the same permission-trimmed query layer ([`../04-ai/ai-features.md`](../04-ai/ai-features.md)) — it can never widen visibility.

## 12. Activity Logs

- Per-record activity timeline ("who changed what, when") rendered from the audit log for staff with the record's `view` permission plus an `activity.view` key.
- Per-user activity view for `school_owner`/`it_admin`; platform-level activity for platform roles. Filters: actor, module, action, date range. Read-only, exportable (audited).

## 13. Approval & Configurable Workflows

- A generic workflow engine (recommendation) powers the approval chains referenced across modules: leave, result publishing, refunds/waivers, certificate issuance, admission acceptance, purchase approvals.
- Tenants configure per workflow: steps, required permission per step (`*.approve` keys), optional role restriction, escalation timeout, and notification triggers.
- Invariants (non-configurable): initiator ≠ approver; steps execute in order; every transition audited; rejection requires a reason; pending items surface in an approvals inbox.

## 14. Document / PDF Generation

- Server-side PDF generation (WeasyPrint — recommendation) for report cards, admit cards, certificates, receipts, payslips, ID cards, and exported reports.
- Tenant-configurable templates with merge fields, school branding, and signatory blocks ([`../03-modules/certificates-documents.md`](../03-modules/certificates-documents.md)); generated documents stored tenant-scoped with signed-URL delivery; bulk generation (a whole section's report cards) runs async as a job producing a zip.

## 15. SEO for Public Websites

- Per-tenant SEO settings: titles, meta descriptions, OpenGraph images, canonical URLs, robots directives.
- Automatic sitemap.xml and structured data (Organization/School, Event, NewsArticle) per tenant; clean crawlable SSR/ISR HTML; automatic 301s when slugs change; per-page noindex control. Detail: [`../03-modules/website-cms.md`](../03-modules/website-cms.md).

## 16. Disaster Recovery & Business Continuity (recommendations)

- **RPO 15 minutes** (continuous WAL archiving / point-in-time recovery) · **RTO 4 hours** for full-service restore.
- Nightly full backups + PITR; backups encrypted, cross-region, access-audited (security.md SEC-18).
- **Restore drills every release cycle** — a backup that hasn't been restored is not a backup; drill results logged.
- Runbooks for: database failover, region loss, object-storage loss, provider outage (SMS/LLM/payments — degrade via flags), and mass-credential rotation.
- Business continuity: status page for tenants; suspension-independent read-only owner access to billing; tenant export capability (multi-tenancy.md §7) doubles as tenant-side continuity insurance.
