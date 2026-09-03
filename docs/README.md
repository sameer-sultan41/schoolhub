# SchoolHub — Software Requirements Documentation

Professional engineering specification for an **AI-powered, multi-tenant School Management SaaS**: one platform sold to many schools, each with its own users, branding, configuration, workflows, and public website, on a shared application isolated by PostgreSQL Row-Level Security. AI is a core product layer — assistants, content generation, and risk analytics — not a bolt-on.

68 documents, ~10,400 lines. Written so a development team can build from it, and so AI coding agents can load exactly the context a task needs (see [AGENTS.md](AGENTS.md)).

## Start Here

| If you are… | Read |
| ----------- | ---- |
| New to the project | [`00-overview/vision.md`](00-overview/vision.md) → [`00-overview/requirements.md`](00-overview/requirements.md) → [`02-architecture/system-architecture.md`](02-architecture/system-architecture.md) |
| Picking up the build | [`project-status.md`](project-status.md) — what's implemented, what's in progress, where to start |
| Planning the build | [`01-phases/phase-plan.md`](01-phases/phase-plan.md), then the individual phase docs |
| Implementing a feature | [`AGENTS.md`](AGENTS.md) → [`context/context-map.md`](context/context-map.md) → your module doc |
| Reviewing architecture | [`02-architecture/`](02-architecture/) — start with `system-architecture.md`, `multi-tenancy.md`, `api-architecture.md` |
| Designing the schema | [`05-database/erd-overview.md`](05-database/erd-overview.md) → [`05-database/entities/`](05-database/entities/) |
| Assessing AI scope | [`04-ai/ai-features.md`](04-ai/ai-features.md) + [`04-ai/ai-governance.md`](04-ai/ai-governance.md) |

## Structure

```
AGENTS.md                  AI-agent entry point: vocabulary, invariants, the "load only what you need" rule
project-status.md          Living hand-off note: what's built, what's in progress, where to start
context/
  context-map.md           task type → exact files to load (the routing table)
  agents-template-*.md     ready-to-copy AGENTS.md for the api / dashboard / website repos
docs/
  00-overview/             vision · requirements + feature matrix · users & roles · glossary
  01-phases/               master phase plan + phases 0–7 (discovery → operate)
  02-architecture/         system · multi-tenancy · API · database · auth/RBAC · AI ·
                           notifications · website builder · tech stack · repos · hosting
  03-modules/              19 module specs, one file each, fixed 19-section template
  04-ai/                   AI feature registry (AI-XXX-NN) + governance policy
  05-database/             ERD overview + column-level entity specs by domain
  06-security/             numbered security requirements (SEC-01…)
  07-quality/              non-functional requirements · testing strategy
  08-future/               mobile apps · extensibility roadmap
```

## The 19 Modules

School & organization · Student management · Staff management · Attendance & leave · Academics · Timetable · Examinations · Fees, finance & payroll · HR & leave · Admissions · Parent/student portal · Communication · Library · Transport · Inventory & assets · Certificates & documents · Website/CMS · Reporting & analytics · Platform admin

Each module doc covers: purpose, business objective, users, permissions, features, workflows (with diagrams), user journeys, inputs/outputs, validations, notifications, reports, AI capabilities, database entities, API requirements, integrations, and dependencies.

## Recommended Stack

Django 6 + DRF + Celery/Redis · Next.js 16 (dashboard + website renderer) · PostgreSQL 18 with RLS · S3-compatible storage · versioned REST + OpenAPI · Flutter for the future mobile phase. Every choice is evaluated with alternatives in [`02-architecture/tech-stack.md`](02-architecture/tech-stack.md), which also records the versions the implementation actually pinned and why a few could not be the newest release.

## Reading Conventions

- Each doc opens with an **Agent Context** block: a short summary and the sibling docs to load alongside it.
- Items marked **(recommendation)** are proposed industry-standard solutions, not client-confirmed requirements — they are the ones to review first with the client.
- Locked vocabulary (role slugs, permission keys, table names, API shapes, template codes, AI feature IDs) is defined once and reused everywhere; see [`AGENTS.md`](AGENTS.md).
- Diagrams are Mermaid and render on GitHub.

## Where This Is Implemented

The docs here are the specification; these directories implement it.

| Directory | Implements |
| --------- | ---------- |
| [`apps/api`](../apps/api) | Backend — Django 6 + DRF, tenancy, RBAC, module apps |
| [`apps/dashboard`](../apps/dashboard) | Next.js 16 admin dashboard |
| [`apps/website`](../apps/website) | Next.js 16 multi-tenant public school website renderer |
| [`packages/`](../packages) | Shared TypeScript: ui, types, api-client, config |
| [`infra`](../infra) | Local stack, PostgreSQL roles, Terraform, runbooks |

The architecture documents refer to these by logical names (`schoolhub-api`,
`schoolhub-frontend`, `schoolhub-infra`); that naming describes a component's role
and is unaffected by where it sits in the tree.

## Status

Phase 0 deliverable — the specification itself. Open items are collected in each module doc's §19 (Open Questions / Recommendations) and should be resolved at Phase 0 sign-off before Phase 1 design begins.
