# AGENTS.md — SchoolHub Documentation Repo

Instructions for AI assistants working with this documentation set (and for coding agents in the SchoolHub code repos that reference it).

## What SchoolHub Is

SchoolHub is an **AI-powered, multi-tenant School Management SaaS**: one platform sold to many schools. Each school (a **tenant**) gets its own users, branding, configuration, workflows, and a public website, on a shared application with PostgreSQL Row-Level-Security isolation. AI is a core product layer (assistants, generation, analytics), not a bolt-on. Recommended stack: Django 5 + DRF + Celery/Redis backend, Next.js 15 dashboard + website renderer, PostgreSQL 16, S3-compatible storage.

## The One Rule

**Never load the whole doc set.** Open [`context/context-map.md`](context/context-map.md), find your task type, and read only the 3–6 files it lists. Every doc is single-topic and cross-linked so partial loading always works. Each doc opens with an `> **Agent Context**` block — read it first to confirm the doc is the one you need.

## Doc Map

| Directory | Contents |
| --------- | -------- |
| `docs/00-overview/` | vision, requirements + feature matrix, users & roles (locked role slugs), glossary (locked terms) |
| `docs/01-phases/` | master phase plan + one doc per phase (0 discovery … 7 operate) |
| `docs/02-architecture/` | system, multi-tenancy, API, database, auth/RBAC, AI, notifications, website builder, tech stack, repo structure, hosting |
| `docs/03-modules/` | **one doc per module** (19) — the functional source of truth; `_template.md` defines their fixed 19-section shape |
| `docs/04-ai/` | AI feature catalog (the `AI-XXX-NN` registry) + AI governance policy |
| `docs/05-database/` | ERD overview + `entities/` column-level table specs per domain |
| `docs/06-security/` | numbered security requirements (SEC-01…) |
| `docs/07-quality/` | non-functional requirements, testing strategy |
| `docs/08-future/` | mobile apps, extensibility roadmap |
| `context/` | the context map + ready-to-copy AGENTS.md templates for the code repos |

## Locked Vocabulary (do not invent alternatives)

- **Role slugs** — only those in [`docs/00-overview/users-and-roles.md`](docs/00-overview/users-and-roles.md) (e.g. `school_admin`, `teacher`, `guardian`, `platform_super_admin`).
- **Permission keys** — `module.resource.action` (e.g. `fees.invoice.create`), defined per module in its doc's §4; model in [`docs/02-architecture/auth-and-rbac.md`](docs/02-architecture/auth-and-rbac.md).
- **Table names** — plural snake_case, column-level specs only in `docs/05-database/entities/`. Every tenant-owned table implicitly has `id` (UUID PK), `tenant_id`, `created_at/updated_at`, `created_by/updated_by`, `deleted_at`.
- **API** — versioned REST `/api/v1/…`, plural kebab-case resources, colon-actions (`:promote`, `:publish`); conventions in [`docs/02-architecture/api-architecture.md`](docs/02-architecture/api-architecture.md).
- **Notification template codes** — dotted `module.event-name` (e.g. `attendance.absence-alert`).
- **AI feature IDs** — `AI-<MODULE PREFIX>-NN`, registered in [`docs/04-ai/ai-features.md`](docs/04-ai/ai-features.md).
- **Terms** — Tenant, Campus, Academic Session, Term, Section, Fee Head, etc. per [`docs/00-overview/glossary.md`](docs/00-overview/glossary.md).

## Non-Negotiable Invariants (every change is checked against these)

1. **Tenant isolation** — cross-tenant access is impossible by construction (RLS + scoped managers + 404-not-403). See `docs/02-architecture/multi-tenancy.md`.
2. **Money is append-only** — ledger entries are never updated or deleted; corrections are new entries.
3. **AI drafts, humans publish** — no AI output reaches students, parents, or the public without a permission-gated human approval. See `docs/04-ai/ai-governance.md`.
4. **RBAC is server-side** — UI hiding is UX, never enforcement.
5. **Mobile-readiness** — no web-only shortcut (cookie-bound auth, HTML-only flows) may be introduced; the same API must serve future mobile apps.

## How to Use These Docs When Coding

1. Find your task type in `context/context-map.md`; load its file list.
2. The module doc defines *behavior* (features, workflows, validations, permissions); the entity file defines *storage*; the architecture docs define *cross-cutting mechanics*. Conflicts resolve in that order of specificity — and flag the conflict rather than silently picking.
3. Anything marked "(recommendation)" is not client-confirmed; implementing it is fine, but changing it is also fine with a doc update in the same change.
4. If you change behavior, update the module doc in the same PR — these docs are the review baseline.

## Editing This Doc Set

- Keep every doc single-topic; new content goes in the most specific existing doc or a new one linked from the map.
- Preserve each doc's `> **Agent Context**` header and the module docs' 19-section template.
- All relative links must resolve; run a link check after edits.
