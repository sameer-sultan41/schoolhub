# Glossary (Locked Terms)

> **Agent Context**
> **Summary:** Canonical definitions for every domain and platform term used across the SRD. Module and architecture docs must use these terms with exactly these meanings; if a doc needs a new term, add it here first. Role names live in `users-and-roles.md`, not here.
> **Co-load with:** [`users-and-roles.md`](users-and-roles.md) · [`../02-architecture/multi-tenancy.md`](../02-architecture/multi-tenancy.md) · [`../02-architecture/auth-and-rbac.md`](../02-architecture/auth-and-rbac.md)

## Tenancy & Platform

- **Tenant** — One school organization on the platform (may contain multiple campuses). Owns all its data; isolated from every other tenant. See multi-tenancy.md §1.
- **Platform** — The SaaS operator layer above all tenants; home of platform roles and the platform console ([`../03-modules/platform-admin.md`](../03-modules/platform-admin.md)).
- **Tenant Member** — Any user account belonging to one tenant: staff, student, or guardian.
- **Campus** — A physical branch of a tenant school. Records and roles can be campus-scoped; one tenant has one or more campuses.
- **Plan** — Subscription tier (e.g. Basic/Standard/Premium — recommendation) controlling enabled modules, usage limits, and support tier.
- **Feature Flag** — Server-side switch enabling/disabling a module or feature per plan with per-tenant overrides; kill-switch capable. Checked before any permission check.
- **Provisioning** — The idempotent transaction that creates a new tenant with seed data (default roles, templates, sample structure). See multi-tenancy.md §7.
- **Onboarding Wizard** — Guided first-run setup: school profile → campuses → session → classes/sections → fees → staff invites → student import.
- **RLS (Row-Level Security)** — PostgreSQL feature enforcing `tenant_id` filtering in the database itself; the authoritative isolation layer (multi-tenancy.md §3).

## Academic Structure

- **Academic Session** — The school year (e.g. 2026–27) that scopes enrollments, fees, timetables, and results. Tenant-configurable start/end.
- **Term** — A subdivision of an academic session (semester/trimester/quarter) used for exams, report cards, and fee cycles.
- **Class** — A grade level (e.g. Grade 6). Contains sections; owns subjects via the curriculum.
- **Section** — A named group of students within a class (e.g. 6-B); the unit of attendance marking and timetabling.
- **Subject** — A course of study attached to classes via curriculum and to teachers via allocation.
- **House** — A cross-class student grouping (e.g. for sports/competitions); optional per tenant.
- **Enrollment** — The record binding one student to one class/section for one academic session. Exactly one active enrollment per student per session (requirements.md BR-02).
- **Promotion** — The session-end workflow closing enrollments and creating next-session enrollments (with pass/fail/retain decisions).
- **Curriculum** — The tenant's mapping of subjects (and syllabus content) to classes for a session.

## People

- **Guardian** — A parent or other responsible adult linked to one or more students; holds a `guardian` account with visibility/actions over their children only.
- **Emergency Contact** — A person recorded on a student profile for urgent contact; not necessarily an account holder.
- **Staff** — Any tenant employee (teaching or non-teaching) with an employee record in staff-management/hr-leave.

## Money

- **Fee Head** — A named charge type (tuition, transport, lab, admission). The atomic unit fee structures are built from.
- **Fee Structure** — A tenant-defined composition of fee heads, amounts, and schedule (monthly/term/annual) applied to a class, program, or student group for a session.
- **Invoice** — An immutable bill issued to a student/guardian from a fee structure (plus fines/discounts); settled by payments, never edited (BR-03).
- **Payment** — An append-only record of money received against an invoice, with method, reference, and receipt.
- **Receipt** — The numbered, PDF-generatable proof of a payment.
- **Discount / Scholarship / Fine / Refund / Waiver** — Append-only adjustment entries linked to invoices or student ledgers; refunds capped by collected amounts (BR-04).
- **Ledger** — The append-only running account of a party (student, or a GL account); every ledger must sum to its balance (BR-03).
- **General Ledger (GL)** — The tenant-level chart of accounts aggregating income, expenses, and fees for financial reporting.
- **Payslip** — The generated per-employee output of a payroll run (salary structure + allowances − deductions).

## Examinations & Documents

- **Admit Card** — The per-student, per-exam entry pass generated after eligibility checks (BR-14); PDF output.
- **Report Card** — The per-student, per-term/session result document produced from approved results using a tenant template.
- **Transcript** — The cumulative academic record across sessions.
- **Question Bank** — The tenant's repository of exam questions (manually authored or AI-generated, human-approved).
- **Document Template** — A tenant-configurable layout (certificates, report cards, receipts, admit cards) rendered to PDF with merge fields.

## Access Control & Audit

- **Permission Key** — A static code-defined string `module.resource.action` (e.g. `fees.invoice.create`); tenants combine keys into roles but never invent keys (auth-and-rbac.md §2.1).
- **Role** — A named set of permission keys; **default** (platform-seeded) or **custom** (tenant-created). Users hold roles, never direct permissions.
- **Record Scope** — An optional constraint on a user-role limiting *which rows* a permission applies to: `own`, `assigned`, `campus:<id>`, or `all` (auth-and-rbac.md §2.3).
- **Approval Workflow** — A tenant-configurable chain of approval steps (leave, results, refunds, certificates, admissions), each requiring a named permission; initiators cannot approve their own requests.
- **Audit Log** — The immutable, append-only record of every mutation and security event, tenant-visible with filters (auth-and-rbac.md §4).
- **Activity Log** — The user-facing rendering of audit events ("who did what when") per record or per user.
- **Impersonation** — Audited, time-boxed platform-support access acting as a tenant user, with visible banner and `impersonated_by` tagging.

## Web, API & AI

- **Theme** — A website design package for tenant public sites; one ships initially, the theme system is extensible ([`../03-modules/website-cms.md`](../03-modules/website-cms.md)).
- **Custom Domain** — A tenant-owned domain (CNAME-verified, auto-TLS) serving that tenant's public website in place of the default `<slug>.<platform-domain>` subdomain.
- **Idempotency Key** — Client-supplied header on money/side-effect mutations letting retries replay the stored response instead of double-executing (api-architecture.md §2.5).
- **Job** — An asynchronous background operation exposed as a `202 Accepted` + pollable resource (imports, reports, blasts, AI batches).
- **Webhook** — Signed, at-least-once outbound event delivery to tenant-configured endpoints (e.g. `fee.paid`).
- **AI Gateway** — The internal server-side layer through which all AI features call LLM providers: provider-agnostic, budgeted, redacting, audited ([`../04-ai/ai-governance.md`](../04-ai/ai-governance.md)).
