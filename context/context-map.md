# Context Map — What to Load for Which Task

> **Agent Context**
> **Summary:** The routing table for AI agents (and humans): find your task type, load only the listed files. Every row is designed to fit comfortably in a small context window — root `AGENTS.md` + 3–6 docs. Start every task by reading [`../AGENTS.md`](../AGENTS.md) (always) plus your row below.
> **Co-load with:** nothing — this file is the router.

## Module Index

Every module has exactly one behavior doc and one storage doc. `M(x)` and `E(x)` below refer to this table.

| Module | Behavior doc `M` (docs/03-modules/) | Storage doc `E` (docs/05-database/entities/) |
| ------ | ----------------------------------- | -------------------------------------------- |
| School & organization | `school-organization.md` | `academics.md` |
| Student management | `student-management.md` | `people.md` |
| Staff management | `staff-management.md` | `people.md` |
| Attendance & leave | `attendance.md` | `attendance.md` |
| Academics | `academics.md` | `academics.md` |
| Timetable | `timetable.md` | `academics.md` |
| Examinations | `examinations.md` | `examinations.md` |
| Fees, finance & payroll | `fees-finance.md` | `finance.md` |
| HR & leave | `hr-leave.md` | `attendance.md` (leave) + `people.md` (staff) |
| Admissions | `admissions.md` | `admissions.md` |
| Parent/student portal | `parent-portal.md` | — (reads other domains) |
| Communication | `communication.md` | `communication.md` |
| Library | `library.md` | `library-transport-inventory.md` |
| Transport | `transport.md` | `library-transport-inventory.md` |
| Inventory & assets | `inventory-assets.md` | `library-transport-inventory.md` |
| Certificates & documents | `certificates-documents.md` | `documents.md` |
| Website / CMS | `website-cms.md` | `website-cms.md` |
| Reporting & analytics | `reporting-analytics.md` | `tenancy.md` (saved_reports) |
| Platform admin | `platform-admin.md` | `tenancy.md` |

## Task Types

Paths are relative to the repo root. **Always** also load `AGENTS.md`.

| Task type | Load these files |
| --------- | ---------------- |
| **Implement/change a module's backend API** | `M(x)` · `E(x)` · `docs/02-architecture/api-architecture.md` · `docs/02-architecture/auth-and-rbac.md` |
| **Build dashboard UI for a module** | `M(x)` · `docs/02-architecture/api-architecture.md` · `docs/02-architecture/tech-stack.md` §3 · `docs/00-overview/users-and-roles.md` |
| **Design or migrate DB schema** | `E(x)` · `docs/02-architecture/database-architecture.md` · `docs/05-database/erd-overview.md` |
| **Add/modify an AI feature** | `docs/04-ai/ai-features.md` (find the `AI-XXX-NN` entry) · `docs/02-architecture/ai-architecture.md` · `docs/04-ai/ai-governance.md` · `M(owning module)` |
| **Public school website / theme work** | `docs/02-architecture/website-builder.md` · `docs/03-modules/website-cms.md` · `docs/05-database/entities/website-cms.md` |
| **Notifications / messaging work** | `docs/02-architecture/notifications.md` · `docs/03-modules/communication.md` · `docs/05-database/entities/communication.md` · `M(emitting module)` §12 |
| **Tenancy, auth, roles, permissions** | `docs/02-architecture/multi-tenancy.md` · `docs/02-architecture/auth-and-rbac.md` · `docs/05-database/entities/tenancy.md` · `docs/00-overview/users-and-roles.md` |
| **Money: fees, payments, payroll, refunds** | `docs/03-modules/fees-finance.md` · `docs/05-database/entities/finance.md` · `docs/02-architecture/api-architecture.md` §2.5 · `docs/06-security/security.md` (financial SEC items) |
| **Reports & dashboards** | `docs/03-modules/reporting-analytics.md` · `M(subject module)` §13 · `docs/07-quality/non-functional.md` |
| **Security review / hardening** | `docs/06-security/security.md` · `docs/02-architecture/auth-and-rbac.md` · `docs/02-architecture/multi-tenancy.md` |
| **Write or review tests** | `docs/07-quality/testing-strategy.md` · `M(x)` §11 (validations) · `E(x)` |
| **Infra, CI/CD, deploy, environments** | `docs/02-architecture/hosting-deployment.md` · `docs/02-architecture/repo-structure.md` · `docs/02-architecture/database-architecture.md` (migrations/backup) |
| **Tenant onboarding / plans / platform console** | `docs/03-modules/platform-admin.md` · `docs/02-architecture/multi-tenancy.md` · `docs/05-database/entities/tenancy.md` |
| **Project planning / estimating a phase** | `docs/01-phases/phase-plan.md` · the specific `docs/01-phases/phase-N-*.md` |
| **Requirements / scope question** | `docs/00-overview/requirements.md` · `docs/00-overview/vision.md` · `M(x)` if module-specific |
| **Future mobile app design** | `docs/08-future/mobile-apps.md` · `docs/02-architecture/api-architecture.md` · `docs/02-architecture/auth-and-rbac.md` |
| **Extending the platform (integrations, IoT, themes…)** | `docs/08-future/extensibility.md` · the architecture doc of the extension point it names |

## Rules of Thumb

1. A task touching two modules loads both `M` docs but usually still one architecture doc — pick the most specific.
2. If after loading your row something is still unclear, follow the **Co-load with** links in the loaded docs' Agent Context headers — one hop, not a crawl.
3. Cross-cutting glossary questions: `docs/00-overview/glossary.md` is 1 page — cheap to add.
4. Word-count budget: each row above totals roughly 8–15k words. If your context is tight, read the Agent Context headers first and drop the least relevant file.
