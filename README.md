# SchoolHub — Software Requirements Documentation

Professional engineering specification for an **AI-powered, multi-tenant School Management SaaS**: one platform sold to many schools, each with its own users, branding, configuration, workflows, and public website, on a shared application isolated by PostgreSQL Row-Level Security. AI is a core product layer — assistants, content generation, and risk analytics — not a bolt-on.

68 documents, ~10,400 lines. Written so a development team can build from it, and so AI coding agents can load exactly the context a task needs (see [AGENTS.md](AGENTS.md)).

## Start Here

| If you are… | Read |
| ----------- | ---- |
| New to the project | [`docs/00-overview/vision.md`](docs/00-overview/vision.md) → [`docs/00-overview/requirements.md`](docs/00-overview/requirements.md) → [`docs/02-architecture/system-architecture.md`](docs/02-architecture/system-architecture.md) |
| Planning the build | [`docs/01-phases/phase-plan.md`](docs/01-phases/phase-plan.md), then the individual phase docs |
| Implementing a feature | [`AGENTS.md`](AGENTS.md) → [`context/context-map.md`](context/context-map.md) → your module doc |
| Reviewing architecture | [`docs/02-architecture/`](docs/02-architecture/) — start with `system-architecture.md`, `multi-tenancy.md`, `api-architecture.md` |
| Designing the schema | [`docs/05-database/erd-overview.md`](docs/05-database/erd-overview.md) → [`docs/05-database/entities/`](docs/05-database/entities/) |
| Assessing AI scope | [`docs/04-ai/ai-features.md`](docs/04-ai/ai-features.md) + [`docs/04-ai/ai-governance.md`](docs/04-ai/ai-governance.md) |

## Structure

```
AGENTS.md                  AI-agent entry point: vocabulary, invariants, the "load only what you need" rule
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

Django 5 + DRF + Celery/Redis · Next.js 15 (dashboard + website renderer) · PostgreSQL 16 with RLS · S3-compatible storage · versioned REST + OpenAPI · Flutter for the future mobile phase. Every choice is evaluated with alternatives in [`docs/02-architecture/tech-stack.md`](docs/02-architecture/tech-stack.md).

## Reading Conventions

- Each doc opens with an **Agent Context** block: a short summary and the sibling docs to load alongside it.
- Items marked **(recommendation)** are proposed industry-standard solutions, not client-confirmed requirements — they are the ones to review first with the client.
- Locked vocabulary (role slugs, permission keys, table names, API shapes, template codes, AI feature IDs) is defined once and reused everywhere; see [`AGENTS.md`](AGENTS.md).
- Diagrams are Mermaid and render on GitHub.

## Status

Phase 0 deliverable — the specification itself. Open items are collected in each module doc's §19 (Open Questions / Recommendations) and should be resolved at Phase 0 sign-off before Phase 1 design begins.
