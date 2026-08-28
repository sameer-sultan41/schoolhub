# Business & Functional Requirements

> **Agent Context**
> **Summary:** The master requirements register (scope §2): functional requirements grouped by module (one line each — detail lives in the module docs), non-functional requirement targets, cross-module business rules, assumptions, constraints, dependencies, the acceptance-criteria approach, and the **core / school-configurable / future** feature classification matrix.
> **Co-load with:** [`vision.md`](vision.md) · [`users-and-roles.md`](users-and-roles.md) · [`../01-phases/phase-plan.md`](../01-phases/phase-plan.md)

## 1. Functional Requirements (by module)

Each requirement below is a one-line summary; the referenced module doc is the authoritative detail source (purpose, features, workflows, validations, notifications, reports, AI capabilities, entities, APIs).

### Foundation & organization
- **FR-ORG** — Tenant-configurable school setup: campuses/branches, departments, academic sessions, terms, classes, sections, subjects, houses, and academic configuration → [`../03-modules/school-organization.md`](../03-modules/school-organization.md).
- **FR-PLAT** — Platform console: tenant lifecycle, provisioning, onboarding wizard, plans/subscriptions, feature flags, usage tracking, platform staff → [`../03-modules/platform-admin.md`](../03-modules/platform-admin.md).

### People
- **FR-STU** — Student lifecycle: registration, profiles, ID generation, enrollment, class/section allocation, transfers, promotion, withdrawal, documents, guardian and emergency contacts, history → [`../03-modules/student-management.md`](../03-modules/student-management.md).
- **FR-STF** — Staff/teacher management: profiles, departments, designations, qualifications, documents, performance tracking → [`../03-modules/staff-management.md`](../03-modules/staff-management.md).
- **FR-PAR** — Parent/guardian accounts spanning multiple children: attendance, fees, results, notices, communication → [`../03-modules/parent-portal.md`](../03-modules/parent-portal.md).

### Academic operations
- **FR-ATT** — Student/teacher/staff attendance with late arrival, early departure, corrections, reports, and parent notifications → [`../03-modules/attendance.md`](../03-modules/attendance.md).
- **FR-ACA** — Curriculum, subject and teacher allocation, academic planning, and student promotion across sessions → [`../03-modules/academics.md`](../03-modules/academics.md).
- **FR-TT** — Class/teacher timetables, room allocation, period management, conflict detection, substitutes, publishing → [`../03-modules/timetable.md`](../03-modules/timetable.md).
- **FR-EXM** — Examination setup through result publishing: schedules, marks entry, grading/GPA, report cards, approval, admit cards, transcripts, question banks → [`../03-modules/examinations.md`](../03-modules/examinations.md).

### Money
- **FR-FEE** — Fee structures, invoicing, collection, discounts/scholarships, fines, refunds, receipts, outstanding tracking, ledgers, expenses/income, budgeting, payroll (structures, allowances, deductions, processing, payslips), financial reports → [`../03-modules/fees-finance.md`](../03-modules/fees-finance.md).

### Staff operations
- **FR-HRL** — Employee records, leave policies/balances/requests, approval workflows, attendance and payroll integration → [`../03-modules/hr-leave.md`](../03-modules/hr-leave.md).

### Growth & engagement
- **FR-ADM** — Admissions funnel: campaigns, enquiries/leads, applications, review, interviews, document verification, approval, enrollment → [`../03-modules/admissions.md`](../03-modules/admissions.md).
- **FR-COM** — Announcements, notices, and configurable notifications over email/SMS/push/in-app (WhatsApp where appropriate), including emergency broadcasts → [`../03-modules/communication.md`](../03-modules/communication.md).
- **FR-WEB** — Per-tenant public school website: CMS pages (home, about, admissions, events, news, gallery, contact, forms), branding, navigation, SEO, custom domain; one theme initially, theme system extensible → [`../03-modules/website-cms.md`](../03-modules/website-cms.md).

### Support services
- **FR-LIB** — Library catalog, members, issue/return, fines, availability tracking → [`../03-modules/library.md`](../03-modules/library.md).
- **FR-TRN** — Vehicles, drivers, routes/stops, student/driver assignments, maintenance, transport fees, tracking-integration readiness → [`../03-modules/transport.md`](../03-modules/transport.md).
- **FR-INV** — Assets, equipment, stock, suppliers, purchases, stock movements, maintenance, asset assignment → [`../03-modules/inventory-assets.md`](../03-modules/inventory-assets.md).
- **FR-CRT** — Certificate and document generation from templates (bonafide, transfer, character; staff documents), PDF output, digital records → [`../03-modules/certificates-documents.md`](../03-modules/certificates-documents.md).

### Insight
- **FR-RPT** — Configurable reports and dashboards across all modules with filters, charts, exports, scheduling, and role-based visibility → [`../03-modules/reporting-analytics.md`](../03-modules/reporting-analytics.md).
- **FR-AI** — AI capabilities embedded per module (assistants, NL search, content generation, grading assistance, risk analytics, predictions) under governance → [`../04-ai/ai-features.md`](../04-ai/ai-features.md) and [`../04-ai/ai-governance.md`](../04-ai/ai-governance.md).

### Cross-cutting functional requirements
- **FR-X1** — RBAC with configurable roles, module/feature/record-level permissions → [`../02-architecture/auth-and-rbac.md`](../02-architecture/auth-and-rbac.md).
- **FR-X2** — Tenant isolation, configuration, branding, plans, lifecycle → [`../02-architecture/multi-tenancy.md`](../02-architecture/multi-tenancy.md).
- **FR-X3** — Audit trail and activity logs on every mutation → auth-and-rbac.md §4.
- **FR-X4** — Excel/CSV import/export and bulk operations on all major entities → [`../07-quality/non-functional.md`](../07-quality/non-functional.md) §10.
- **FR-X5** — Search and advanced filtering per module plus tenant-wide search → non-functional.md §11.
- **FR-X6** — Configurable approval workflows (leave, results, refunds, certificates, admissions) → non-functional.md §13 and module docs §7.
- **FR-X7** — Document/PDF generation (report cards, receipts, certificates, admit cards) → non-functional.md §14.
- **FR-X8** — Data migration/import from legacy school systems at onboarding → platform-admin.md.

## 2. Non-Functional Requirements (targets — recommendations)

Authoritative detail: [`../07-quality/non-functional.md`](../07-quality/non-functional.md) and [`../06-security/security.md`](../06-security/security.md).

| Attribute | Target |
| --------- | ------ |
| Availability | 99.5% monthly initially; suspension-free maintenance windows announced ≥48 h ahead |
| Performance | p95 API reads < 400 ms, writes < 800 ms; report generation asynchronous (job pattern) |
| Scalability | 200 tenants / 200k students on the initial shared-schema deployment without re-architecture; scale-out path documented in [`../02-architecture/system-architecture.md`](../02-architecture/system-architecture.md) |
| Security | Tenant isolation DB-enforced (RLS); OWASP ASVS-aligned controls; full audit trail — see security.md |
| Usability | Onboarding wizard completable by non-technical school admin; WCAG 2.1 AA; dashboard usable on tablet-width screens |
| Localization | Per-tenant locale, timezone, currency; i18n with RTL support |
| Maintainability | Module docs are review contracts; ≥80% backend coverage on money/tenancy paths (see [`../07-quality/testing-strategy.md`](../07-quality/testing-strategy.md)); OpenAPI generated from code |
| Recoverability | RPO 15 min / RTO 4 h; restore drills each release cycle |

## 3. Business Rules (cross-module invariants)

These hold across every module and are enforced server-side; module docs may add module-local rules but never relax these.

- **BR-01** Every tenant-owned row carries `tenant_id`; no query crosses tenants except audited platform-admin paths (multi-tenancy.md §3).
- **BR-02** A student has **exactly one active enrollment per academic session**; transfers and promotions close the old enrollment and open a new one atomically.
- **BR-03** Money mutations are **append-only**: invoices, payments, refunds, waivers, and payroll postings are never edited or deleted — corrections are compensating entries; every ledger must sum to its account balance.
- **BR-04** A refund cannot exceed the amount actually collected against the invoice it refunds.
- **BR-05** Results, certificates, refunds, and admissions are **approval-gated**: no publication or issuance without the configured approval chain completing; an initiator can never approve their own request (segregation of duties, auth-and-rbac.md §2.4).
- **BR-06** Published artifacts (results, report cards, timetables, notices) are versioned; re-publication supersedes, never silently overwrites.
- **BR-07** Attendance can only be recorded for dates within the active academic session and not for future dates; corrections require the correction permission and are audited.
- **BR-08** A user account belongs to exactly one tenant; student/guardian accounts can never hold staff permission keys (users-and-roles.md §6).
- **BR-09** Deletions of student, staff, and financial records are soft deletes within retention windows; hard purge only via the tenant-deletion lifecycle (multi-tenancy.md §7).
- **BR-10** Every mutation produces an audit-log row; audit logs are immutable.
- **BR-11** Feature-flag and plan checks are server-side; a disabled module rejects API calls regardless of UI state.
- **BR-12** AI outputs that face students/parents or mutate records require human approval before taking effect ([`../04-ai/ai-governance.md`](../04-ai/ai-governance.md)).
- **BR-13** Timetable publishing requires zero hard conflicts (teacher/room/section double-booking).
- **BR-14** An admit card can only be generated for a student with an active enrollment and per-tenant-configurable fee-clearance rules satisfied.

## 4. Assumptions

- **A-01** Schools have at least intermittent internet connectivity; the initial web product is online-first (offline support is a mobile-phase consideration).
- **A-02** Each school designates at least one owner/administrator to complete onboarding and own configuration.
- **A-03** Client will nominate 2–3 pilot schools for UAT (phase-plan.md, Phase 5).
- **A-04** Third-party providers (payment gateway, SMS, email, WhatsApp, LLM) offer service in target markets; final selection at Phase 0/4.
- **A-05** No country/jurisdiction is fixed; regulatory specifics are configured per tenant, with a compliance placeholder reviewed per market (non-functional.md §9).
- **A-06** The stack recommendations in [`../02-architecture/tech-stack.md`](../02-architecture/tech-stack.md) are accepted or re-decided at Phase 0 exit without changing module requirements.

## 5. Constraints

- **C-01** Mobile applications are explicitly out of the initial scope (scope §20) — architecture must remain mobile-ready.
- **C-02** One website theme initially; the theme system must be designed for later multi-theme support (scope §11).
- **C-03** Small product team (3–5 engineers + 1 designer assumed) — favors the batteries-included stack and shared-schema tenancy over microservices.
- **C-04** Configuration over code: no per-tenant code forks, ever.
- **C-05** Children are data subjects: privacy controls in security.md §PII are non-negotiable and constrain AI, analytics, and export features.
- **C-06** AI features must degrade gracefully (fallbacks, kill switches); no core workflow may hard-depend on an LLM provider being up.

## 6. Feature Classification Matrix

Classification per [`vision.md`](vision.md) §7. "Configurable dimension" names what tenants can vary without code.

| # | Capability | Tier | Configurable dimension (per tenant) |
| - | ---------- | ---- | ----------------------------------- |
| 1 | school-organization | Core | Campuses, sessions/terms, classes/sections/subjects, houses, calendar |
| 2 | student-management | Core | ID formats, admission-number schemes, custom profile fields, document checklists |
| 3 | staff-management | Core | Departments, designations, document checklists |
| 4 | attendance | Core | Marking modes, period vs day, lateness rules, notification triggers |
| 5 | academics | Core | Curriculum structure, grading scales, promotion rules |
| 6 | timetable | Core | Periods, working days, rooms, substitution policy |
| 7 | examinations | Core | Exam types, grade boundaries, report-card templates, approval chain |
| 8 | fees-finance | Core | Fee heads/structures, discounts, fines, currency, payroll components, tax fields |
| 9 | hr-leave | Core | Leave policies/balances, approval chains |
| 10 | admissions | Core | Campaigns, form fields, workflow stages, interview steps |
| 11 | parent-portal | Core | Visible sections, payment enablement |
| 12 | communication | Core | Channels enabled, templates, preferences, quiet hours |
| 13 | library | School-configurable (plan-gated module) | Fine rules, loan periods, categories |
| 14 | transport | School-configurable (plan-gated module) | Routes, stops, fee linkage |
| 15 | inventory-assets | School-configurable (plan-gated module) | Categories, suppliers, approval thresholds |
| 16 | certificates-documents | Core | Templates, signatories, numbering |
| 17 | website-cms | Core (single theme) | All content, branding, navigation, SEO, custom domain |
| 18 | reporting-analytics | Core | Saved reports, schedules, role visibility |
| 19 | platform-admin | Core (platform-scope) | — (operates tenants; not tenant-configurable) |
| 20 | AI capabilities | Core differentiator (plan/flag-gated per feature) | Enabled features, token budget, approval strictness |
| 21 | Public website — additional themes | Future | Theme choice, theme-level options |
| 22 | Mobile apps (student/parent/teacher/staff) | Future | Branding, enabled modules — see [`../08-future/mobile-apps.md`](../08-future/mobile-apps.md) |
| 23 | Biometric/RFID attendance, IoT transport, marketplace, extra gateways/channels | Future | — see [`../08-future/extensibility.md`](../08-future/extensibility.md) |

Plan-gated modules (13–15) ship in the core codebase but are enabled per plan/flag; "Future" rows are designed-for but not built initially.

## 7. Dependencies

| Dependency | Needed by | Notes |
| ---------- | --------- | ----- |
| Payment gateway(s) | fees-finance, parent-portal | Phase 4; sandbox before UAT; adapter layer for gateway plurality |
| SMS / email / WhatsApp providers | communication, auth (OTP reset) | Provider-agnostic adapters (tech-stack.md) |
| LLM provider (Anthropic Claude — recommendation) | all AI features | Behind internal gateway with fallback/kill switch |
| S3-compatible object storage | uploads, documents, exports | Presigned URL flows (api-architecture.md §2.8) |
| DNS/TLS automation at the edge | website-cms custom domains | Wildcard subdomains + CNAME verification |
| Legacy-system data (CSV/Excel) | onboarding imports | Pilot schools supply samples in Phase 0 |
| App store accounts | mobile (future) | Not required initially |

## 8. Acceptance Criteria Approach

1. **Module docs are the contract.** Each module doc's features, validations, workflows, and API sections convert into Given/When/Then acceptance criteria on implementation tickets; reviewers check code against the doc (phase-plan.md §4.3).
2. **Definition of Done per module:** migrations + seeds, RBAC rows, feature flag, OpenAPI docs, unit/integration tests **including cross-tenant access tests**, and passing CI gates ([`../07-quality/testing-strategy.md`](../07-quality/testing-strategy.md)).
3. **Business rules BR-01…BR-14 have dedicated automated tests** — a release cannot ship with a failing invariant test.
4. **NFR verification:** performance targets validated by load-test profiles, availability by monitoring SLOs, security by the Phase 5 pen test.
5. **UAT sign-off:** pilot schools execute role-based scenario scripts (per users-and-roles.md journeys); Phase 6 entry requires zero critical and zero high defects open.
