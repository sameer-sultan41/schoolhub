# Users & Roles

> **Agent Context**
> **Summary:** Canonical list of every user role, its scope, responsibilities, and primary modules. Role *names and slugs defined here are the locked vocabulary* used by every module doc's §3–§4 and by `auth-and-rbac.md`. Tenants can additionally create custom roles.
> **Co-load with:** `../02-architecture/auth-and-rbac.md`

## 1. Scopes

| Scope | Who lives here |
| ----- | -------------- |
| **Platform** | SaaS operator staff — cross-tenant, never mixed with school data roles |
| **Tenant** | Everyone belonging to one school: staff, students, parents |

## 2. Platform Roles

| Role (slug) | Responsibilities | Primary modules |
| ----------- | ---------------- | --------------- |
| Super Admin (`platform_super_admin`) | Tenant lifecycle, plans, billing, feature flags, platform config, platform staff management | platform-admin, reporting-analytics |
| Platform Support (`platform_support`) | Audited, time-boxed tenant impersonation for support; read-mostly | platform-admin |

## 3. Tenant Roles (defaults, all configurable)

| Role (slug) | Responsibilities | Primary modules |
| ----------- | ---------------- | --------------- |
| School Owner (`school_owner`) | Legal/commercial owner; subscription, top-level settings, all reports; can hold every permission | all |
| School Administrator (`school_admin`) | Day-to-day operational admin: users, roles, configuration, workflows | school-organization, staff-management, communication |
| Principal (`principal`) | Academic leadership: approvals (results, leave, certificates), oversight dashboards | academics, examinations, attendance, reporting-analytics |
| Vice Principal (`vice_principal`) | Delegated subset of principal approvals; discipline & timetable oversight | academics, timetable, attendance |
| Teacher (`teacher`) | Teaching workload: attendance marking, marks entry, lesson content, parent communication | attendance, examinations, academics, communication |
| Class Teacher (`class_teacher`) | Teacher + homeroom duties for one section: promotions input, report-card remarks, parent liaison | student-management, examinations |
| Student (`student`) | Self-service: timetable, results, attendance view, library, fees view, AI study assistant | parent-portal (student view), library, examinations |
| Parent / Guardian (`guardian`) | Visibility + actions across their children: attendance, fees payment, results, communication | parent-portal, fees-finance, communication |
| Accountant (`accountant`) | Fee collection, invoicing, refunds, ledgers, financial reports | fees-finance |
| Finance Staff (`finance_staff`) | Data-entry subset of accountant (no refund/waiver approval) | fees-finance |
| HR Staff (`hr_staff`) | Employee records, leave policies, payroll inputs | hr-leave, staff-management |
| Reception Staff (`reception`) | Enquiries, visitor handling, front-desk admissions intake | admissions, communication |
| Admission Staff (`admission_staff`) | Applications, interviews, document verification, enrollment | admissions |
| Examination Staff (`exam_staff`) | Exam setup, schedules, admit cards, result processing (not approval) | examinations |
| Librarian (`librarian`) | Catalog, issue/return, fines, member management | library |
| Transport Manager (`transport_manager`) | Routes, vehicles, drivers, student transport assignment, transport fees | transport |
| Driver / Transport Staff (`transport_staff`) | Own route/vehicle view, trip status | transport |
| Inventory / Store Keeper (`store_keeper`) | Assets, stock, purchases, maintenance | inventory-assets |
| IT / System Administrator (`it_admin`) | Tenant technical settings: domains, integrations, imports/exports, audit logs | school-organization, platform integrations |

## 4. Custom Roles

Tenants may create additional roles (e.g. "Coordinator", "Hostel Warden") by composing permission keys — no code change required. Custom roles:
- are tenant-scoped, never visible to other tenants;
- can be cloned from a default role and adjusted;
- may be granted **approval** authority per workflow (see module docs §7) and **record-level** scopes (e.g. a teacher restricted to assigned sections) per [`../02-architecture/auth-and-rbac.md`](../02-architecture/auth-and-rbac.md).

## 5. Journey Summaries (detail lives in each module doc §8)

- **Owner/Admin:** onboard school → configure academics & fees → invite staff → import students → operate via dashboards and approvals.
- **Teacher:** daily — mark attendance, enter marks, respond to parents, use AI lesson/quiz generators.
- **Student:** check timetable/homework, view results and attendance, ask the AI study assistant.
- **Guardian:** monitor children, pay fees, receive notifications, message the school.
- **Accountant:** run fee cycles — generate invoices, record collections, chase outstanding, close ledgers.
- **Super Admin:** onboard tenants, watch platform health/usage, manage plans and flags.

## 6. Role Design Rules

1. Module docs must reference roles **only** by the slugs above (or "custom roles").
2. No permission is ever granted to a user directly — always through a role (see RBAC doc).
3. One user can hold multiple roles (e.g. `teacher` + `exam_staff`); permissions are the union.
4. Student and guardian accounts are **restricted principals**: they can never hold staff permission keys, even via custom roles.
