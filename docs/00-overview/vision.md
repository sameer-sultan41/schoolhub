# Vision & Objectives

> **Agent Context**
> **Summary:** Why SchoolHub exists: business and product objectives, the AI-first differentiation thesis (AI as a core capability, not a bolt-on), target users and target schools, and the core / school-configurable / future feature philosophy that every other doc classifies against. Success metrics here are recommendations pending Phase 0 sign-off.
> **Co-load with:** [`requirements.md`](requirements.md) · [`users-and-roles.md`](users-and-roles.md) · [`../01-phases/phase-plan.md`](../01-phases/phase-plan.md)

## 1. Product Statement

SchoolHub is a **multi-tenant, AI-powered School Management SaaS**: one core application sold to and configured for many schools, where each school (tenant) operates its own data, users, branding, workflows, public website, and settings in full isolation from every other school. AI is designed in as a core capability of every major module rather than added as a marketing feature.

## 2. Business Objectives

1. **Build once, sell many:** a reusable, configurable product deployable to a new school in hours (onboarding wizard + provisioning), not weeks of custom work — see [`../02-architecture/multi-tenancy.md`](../02-architecture/multi-tenancy.md) §7.
2. **Recurring revenue:** subscription plans (Basic/Standard/Premium — recommendation) with per-plan module enablement and usage limits, managed in [`../03-modules/platform-admin.md`](../03-modules/platform-admin.md).
3. **Differentiate on AI:** compete against established SMS incumbents on intelligence — automation, insight, and productivity — not on feature-list parity alone.
4. **Low marginal cost per tenant:** shared-schema architecture keeps infrastructure cost per additional school near zero (see multi-tenancy doc §2).
5. **Expandable footprint:** each tenant is a beachhead for upsells — additional campuses, website themes, mobile apps, integrations (see [`../08-future/extensibility.md`](../08-future/extensibility.md)).

## 3. Product Objectives

1. **Complete daily operations:** a school runs admissions, enrollment, attendance, academics, examinations, fees, HR, communication, library, transport, and inventory in SchoolHub without spreadsheets (Phase 2 exit criterion in [`../01-phases/phase-plan.md`](../01-phases/phase-plan.md)).
2. **Configurable, not customized:** schools differ by configuration (roles, workflows, fee structures, grading scales, calendars, branding), never by code forks.
3. **Two surfaces per tenant:** an internal admin dashboard and a public school website ([`../03-modules/website-cms.md`](../03-modules/website-cms.md)) sharing tenant data behind proper security boundaries.
4. **Mobile-ready backend:** the versioned REST API and JWT auth are designed so future Flutter apps require no core backend rework ([`../08-future/mobile-apps.md`](../08-future/mobile-apps.md)).
5. **Trustworthy by construction:** tenant isolation enforced in the database (RLS), full audit trail, children's-data privacy posture ([`../06-security/security.md`](../06-security/security.md)).

## 4. AI-First Differentiation Thesis

Most school management systems in the market are CRUD record-keepers; where they offer "AI", it is typically a detached chatbot with no access to school context. SchoolHub's thesis:

- **AI is embedded in workflows, not beside them.** Marks entry offers grading assistance; timetabling offers conflict-aware recommendations; admissions scores leads; communication drafts announcements — each inside the module where the work happens (each module doc's §"AI capabilities").
- **AI is role-aware and permission-bound.** Assistants for administrators, teachers, students, and parents answer only from data the asking user could see anyway — AI runs with the initiating user's permission context, never a superuser context ([`../02-architecture/auth-and-rbac.md`](../02-architecture/auth-and-rbac.md) §3).
- **AI produces drafts, humans decide.** Generated report cards, announcements, and risk flags require human review/approval per [`../04-ai/ai-governance.md`](../04-ai/ai-governance.md).
- **AI value is measurable.** Every AI feature ships with a value metric (time saved, at-risk students surfaced, collection-rate lift) — features that do not move a metric are candidates for removal, not marketing.
- **Cost and privacy are governed.** Per-tenant token budgets, provider-agnostic gateway, PII redaction before any provider call — see [`../02-architecture/tech-stack.md`](../02-architecture/tech-stack.md) §6 and the AI governance doc.

Representative capabilities: natural-language search across school data, AI-generated lesson plans/quizzes/exam questions, at-risk student and dropout-risk detection, attendance anomaly detection, fee-payment prediction, admission lead scoring, natural-language dashboard queries, document OCR/summarization.

## 5. Target Users

The full role catalog is locked in [`users-and-roles.md`](users-and-roles.md). In vision terms:

| Audience | What SchoolHub must be for them |
| -------- | ------------------------------ |
| School owners & administrators | A single operational system with dashboards, approvals, and configuration control |
| Principals / academic leadership | Oversight, approvals, and AI-surfaced insight (performance, risk, anomalies) |
| Teachers | Less admin drudgery: fast attendance/marks entry, AI lesson/quiz/question generation |
| Students & parents/guardians | Transparent self-service: timetable, attendance, results, fees, communication, AI study help |
| Operational staff (accounts, HR, library, transport, admissions, inventory) | Purpose-built module workflows replacing paper and spreadsheets |
| Platform operator (SaaS team) | Tenant lifecycle, plans, flags, usage, and platform health from one console |

## 6. Target Schools

- **Primary:** small-to-mid private schools (~100–3,000 students) that currently run on spreadsheets, paper, or aging legacy SMS products — price-sensitive, need fast onboarding and low training overhead.
- **Secondary:** multi-campus school groups — one tenant with multiple campuses/branches, campus-scoped roles and reporting ([`../03-modules/school-organization.md`](../03-modules/school-organization.md)).
- **No country is assumed:** currency, timezone, locale, calendar, and tax-related configuration are tenant-configurable ([`../07-quality/non-functional.md`](../07-quality/non-functional.md)); go-to-market ordering of markets is a Phase 0 business decision.

## 7. Feature Philosophy: Core / Configurable / Future

Every capability in this doc set is classified into exactly one of three tiers (the full matrix is in [`requirements.md`](requirements.md) §6):

1. **Core platform** — shipped to all tenants, non-optional foundations: tenancy, auth/RBAC, audit, the operational modules, notifications, the platform console. Core features may still have configurable *behavior*.
2. **School-configurable** — the same feature behaving differently per tenant via configuration, plans, and feature flags: custom roles, approval chains, fee structures, grading scales, branding, website content, notification preferences, locale/timezone/currency. Configuration must never require code changes.
3. **Future** — architecturally provided for but explicitly not built initially: mobile apps, additional website themes, biometric/RFID attendance, IoT transport tracking, marketplace integrations ([`../08-future/`](../08-future/mobile-apps.md)). Present-day design must not block them (mobile-readiness reviews, adapter patterns).

## 8. Success Metrics (recommendations)

To be baselined at Phase 0 and reviewed quarterly:

| Category | Metric | Initial target |
| -------- | ------ | -------------- |
| Adoption | Pilot schools live in production | 2–3 at launch (Phase 6) |
| Adoption | Time from signup to first operational day | < 5 business days |
| Engagement | Weekly active staff users per tenant | > 70% of invited staff |
| Engagement | Parent portal activation | > 50% of guardians within one term |
| AI value | Teachers using ≥1 AI generation feature weekly | > 40% |
| AI value | At-risk flags reviewed (accepted or dismissed) by staff | > 80% within 7 days |
| Operations | Fee collection recorded in-system (vs off-system) | > 95% of receipts |
| Reliability | Monthly availability | ≥ 99.5% ([`../07-quality/non-functional.md`](../07-quality/non-functional.md)) |
| Commercial | Tenant churn (annual) | < 10% |
| Support | Onboarding completed via wizard without support escalation | > 80% of tenants |

Metrics are instrumented via the usage-tracking requirements in [`../03-modules/platform-admin.md`](../03-modules/platform-admin.md) and the observability stack in [`../07-quality/non-functional.md`](../07-quality/non-functional.md).
