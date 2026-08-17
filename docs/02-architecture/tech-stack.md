# Technology Stack Evaluation & Recommendation

> **Agent Context**
> **Summary:** Fresh evaluation of frontend, backend, database, and infrastructure options for the multi-tenant School Management SaaS, with clearly-marked recommendations. All choices here are **recommendations, not client-confirmed requirements**, selected for long-term maintainability, scalability, developer productivity, cost, performance, and future mobile support.
> **Co-load with:** `api-architecture.md` · `multi-tenancy.md` · `hosting-deployment.md`

## 1. Selection Criteria

Every candidate is scored against: (a) long-term maintainability, (b) scalability to hundreds of tenant schools, (c) developer productivity and hiring pool, (d) infrastructure and licensing cost, (e) performance under reporting/bulk workloads, (f) readiness for the future mobile apps (§20 of the scope), and (g) ecosystem fit for the AI feature set.

## 2. Backend

| Option | Strengths | Weaknesses | Fit |
| ------ | --------- | ---------- | --- |
| **Python + Django 5 / DRF** | Batteries-included (auth, admin, ORM, migrations), mature RBAC ecosystem, first-class Postgres support, Celery for jobs, largest AI/ML ecosystem (native SDKs for LLM providers), fast CRUD-heavy development | Slower raw throughput than Go/Node; async story still maturing | **Excellent** — the system is CRUD + reporting + AI orchestration, exactly Django's sweet spot |
| Node.js + NestJS (TypeScript) | Single language across stack, strong typing, good async I/O | ORM options (Prisma/TypeORM) weaker than Django ORM for complex reporting; more assembly required (auth, admin) | Good |
| Java/Kotlin + Spring Boot | Enterprise-grade, strong typing, great performance | Slowest iteration speed for a small product team; heavier operational footprint | Moderate |
| Go + Gin/Echo | Best raw performance, small footprint | Minimal batteries; every SaaS primitive (RBAC, admin, ORM migrations) is hand-built; slows a doc-driven, module-heavy build | Moderate |
| Laravel (PHP) | Very fast CRUD development, big SMS ecosystem | Weaker AI ecosystem; typing optional; fewer senior hires in target market segments | Good |

**Recommendation: Python 3.12 + Django 5 + Django REST Framework.** The platform is dominated by relational CRUD, approval workflows, reporting, and AI orchestration — Django delivers all four with the least custom code, and Python is the strongest ecosystem for the AI layer (§ [`ai-architecture.md`](ai-architecture.md)).

- **Background jobs / queue:** Celery + Redis (scheduled reports, notification fan-out, imports, AI batch jobs). Alternatives considered: Dramatiq (lighter, smaller community), RQ (too minimal for workflow chains).
- **Authentication:** JWT (short-lived access + rotating refresh) via `djangorestframework-simplejwt`, mobile-ready from day one. See [`auth-and-rbac.md`](auth-and-rbac.md).
- **File processing:** Pillow (images), WeasyPrint (PDF generation for report cards/certificates/receipts), openpyxl (Excel import/export).
- **Notification services:** provider-agnostic adapter layer — see [`notifications.md`](notifications.md).

## 3. Frontend (Admin Dashboard)

| Option | Strengths | Weaknesses | Fit |
| ------ | --------- | ---------- | --- |
| **Next.js 15 (React, App Router)** | SSR/ISR for the public school websites, one framework for dashboard + websites, huge hiring pool, first-class Vercel/self-host options | React churn; server-components learning curve | **Excellent** — one framework serves both the dashboard and the tenant websites |
| Nuxt 3 (Vue) | Gentler learning curve, good DX | Smaller ecosystem for admin-grade component libraries | Good |
| Angular 18 | Strong typing, opinionated structure | Heavy for a small team; slower feature velocity | Moderate |
| SvelteKit | Small bundles, fast | Smallest hiring pool; fewer mature enterprise UI kits | Moderate |

**Recommendation: Next.js 15 + TypeScript** for both the admin dashboard and the public school website renderer (two apps, shared UI packages).

- **UI library / design system:** Tailwind CSS + shadcn/ui (owned code, themeable per-tenant branding). Alternative: MUI (faster start, harder deep theming).
- **State management:** TanStack Query for server state (the majority), Zustand for the little true client state. Redux is not recommended — server-state libraries eliminate most of its use cases here.
- **Forms & validation:** React Hook Form + Zod (schemas shared between client validation and API-contract types).
- **Internationalization:** `next-intl` — English + Urdu (RTL-ready) initially; tenant-selectable locale. See localization requirements in [`../07-quality/non-functional.md`](../07-quality/non-functional.md).
- **Testing:** Vitest + React Testing Library (unit/component), Playwright (E2E).
- **Build tooling:** Turborepo monorepo for `dashboard`, `website`, and shared `ui`/`types` packages. See [`repo-structure.md`](repo-structure.md).

## 4. Database & Data Services

| Option | Strengths | Weaknesses | Fit |
| ------ | --------- | ---------- | --- |
| **PostgreSQL 16** | Row-Level Security (native tenant isolation), JSONB for configurable fields, mature backups/replication, full-text search built in | — | **Excellent** |
| MySQL 8 | Familiar, fast reads | No RLS; weaker JSON and CTE story | Good |
| MongoDB | Flexible schema | The domain is deeply relational (fees ↔ students ↔ classes); weak fit | Poor |

**Recommendation: PostgreSQL 16** — its Row-Level Security is the backbone of the tenant-isolation strategy (see [`multi-tenancy.md`](multi-tenancy.md) and [`database-architecture.md`](database-architecture.md)).

- **Caching:** Redis 7 (sessions, hot config, rate limiting, Celery broker).
- **Search:** Postgres full-text search initially; OpenSearch/Meilisearch only if cross-module global search outgrows it (flagged as a future decision, not a day-one dependency).
- **File/object storage:** S3-compatible object storage (AWS S3 or Cloudflare R2), presigned-URL uploads. See [`api-architecture.md`](api-architecture.md) §File Uploads.

## 5. Infrastructure & Tooling

| Concern | Recommendation | Notes |
| ------- | -------------- | ----- |
| Containerization | Docker + Docker Compose (dev), containers in production | See [`hosting-deployment.md`](hosting-deployment.md) for platform comparison |
| CI/CD | GitHub Actions | Lint, tests, build, migrate, deploy per environment |
| Monitoring | Grafana + Prometheus (self-host) or a hosted APM | Cost-tiered options compared in hosting doc |
| Logging | Structured JSON logs → Loki or CloudWatch | Correlation/request IDs mandatory |
| Error tracking | Sentry | Frontend + backend + Celery |
| Security tooling | Dependabot, gitleaks (pre-commit), OWASP ZAP in CI for staging | See [`../06-security/security.md`](../06-security/security.md) |

## 6. AI Layer (summary — full detail in `ai-architecture.md`)

- **Provider:** Anthropic Claude API as primary LLM provider, behind an internal provider-agnostic gateway so models can be swapped per feature.
- **Pattern:** all AI features run server-side through the backend (never browser → provider directly); per-tenant token budgets and audit logging.

## 7. Decision Summary

| Layer | Choice |
| ----- | ------ |
| Backend | Python 3.12 · Django 5 · DRF · Celery · Redis |
| API style | REST (OpenAPI), versioned — see [`api-architecture.md`](api-architecture.md) |
| Dashboard | Next.js 15 · TypeScript · Tailwind + shadcn/ui · TanStack Query · RHF + Zod |
| Public websites | Next.js 15 multi-tenant renderer (same monorepo) |
| Database | PostgreSQL 16 (RLS) · Redis 7 |
| Storage | S3-compatible object storage |
| PDF/Docs | WeasyPrint |
| Mobile (future) | Flutter (single codebase, consumes the same REST API) — future phase only |

All of the above are **recommendations**; any item can be swapped during Phase 0 sign-off without invalidating the module documentation, which is written stack-neutral except where a section explicitly says otherwise.
