# AGENTS.md — SchoolHub specification (`docs/`)

Instructions for AI assistants working with the specification in this directory. It lives in the same monorepo as the code it governs; the root [`../AGENTS.md`](../AGENTS.md) holds the repo-wide rules.

## What SchoolHub Is

SchoolHub is an **AI-powered, multi-tenant School Management SaaS**: one platform sold to many schools. Each school (a **tenant**) gets its own users, branding, configuration, workflows, and a public website, on a shared application with PostgreSQL Row-Level-Security isolation. AI is a core product layer (assistants, generation, analytics), not a bolt-on. Stack as built: Django 6.1 + DRF + Celery/Redis 8 backend, Next.js 16 dashboard + website renderer, PostgreSQL 18, S3-compatible storage (pinned versions: [`02-architecture/tech-stack.md`](02-architecture/tech-stack.md) §8).

## The One Rule

**Never load the whole doc set.** Open [`context/context-map.md`](context/context-map.md), find your task type, and read only the 3–6 files it lists. Every doc is single-topic and cross-linked so partial loading always works. Each doc opens with an `> **Agent Context**` block — read it first to confirm the doc is the one you need.

## Doc Map

| Directory | Contents |
| --------- | -------- |
| `00-overview/` | vision, requirements + feature matrix, users & roles (locked role slugs), glossary (locked terms) |
| `01-phases/` | master phase plan + one doc per phase (0 discovery … 7 operate) |
| `02-architecture/` | system, multi-tenancy, API, database, auth/RBAC, AI, notifications, website builder, tech stack, repo structure (as built: where new code goes), hosting |
| `decisions/` | architecture decision records — why each choice was made, what was rejected, and what enforces it |
| `03-modules/` | **one doc per module** (19) — the functional source of truth; `_template.md` defines their fixed 19-section shape |
| `04-ai/` | AI feature catalog (the `AI-XXX-NN` registry) + AI governance policy |
| `05-database/` | ERD overview + `entities/` column-level table specs per domain |
| `06-security/` | numbered security requirements (SEC-01…) |
| `07-quality/` | non-functional requirements, testing strategy, repo tooling (hooks, Prettier, cspell) |
| `08-future/` | mobile apps, extensibility roadmap |
| `context/` | the context map (task type → the docs to load) |

## Locked Vocabulary (do not invent alternatives)

- **Role slugs** — only those in [`00-overview/users-and-roles.md`](00-overview/users-and-roles.md) (e.g. `school_admin`, `teacher`, `guardian`, `platform_super_admin`).
- **Permission keys** — `module.resource.action` (e.g. `fees.invoice.create`), defined per module in its doc's §4; model in [`02-architecture/auth-and-rbac.md`](02-architecture/auth-and-rbac.md).
- **Table names** — plural snake_case, column-level specs only in `05-database/entities/`. Every tenant-owned table implicitly has `id` (UUID PK), `tenant_id`, `created_at/updated_at`, `created_by/updated_by`, `deleted_at`.
- **API** — versioned REST `/api/v1/…`, plural kebab-case resources, colon-actions (`:promote`, `:publish`); conventions in [`02-architecture/api-architecture.md`](02-architecture/api-architecture.md).
- **Notification template codes** — dotted `module.event-name` (e.g. `attendance.absence-alert`).
- **AI feature IDs** — `AI-<MODULE PREFIX>-NN`, registered in [`04-ai/ai-features.md`](04-ai/ai-features.md).
- **Terms** — Tenant, Campus, Academic Session, Term, Section, Fee Head, etc. per [`00-overview/glossary.md`](00-overview/glossary.md).

## Non-Negotiable Invariants

The single list lives in the root [`../AGENTS.md`](../AGENTS.md#invariants) — tenant isolation
by RLS, 404-not-403, a permission key on every endpoint with RBAC server-side, append-only money,
AI drafts / humans publish, the generated API contract, and mobile-readiness. Every change is
checked against it; this doc set is where each is specified in detail.

## How to Use These Docs When Coding

1. Find your task type in `context/context-map.md`; load its file list.
2. The module doc defines *behavior* (features, workflows, validations, permissions); the entity file defines *storage*; the architecture docs define *cross-cutting mechanics*. Conflicts resolve in that order of specificity — and flag the conflict rather than silently picking.
3. Anything marked "(recommendation)" is not client-confirmed; implementing it is fine, but changing it is also fine with a doc update in the same change.
4. If you change behavior, update the module doc in the same PR — these docs are the review baseline.

## Editing This Doc Set

- Keep every doc single-topic; new content goes in the most specific existing doc or a new one linked from the map.
- Preserve each doc's `> **Agent Context**` header and the module docs' 19-section template.
- All relative links must resolve; run a link check after edits.
