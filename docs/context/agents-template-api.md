# AGENTS.md — apps/api (template)

> Copy this file to the backend repo root as `AGENTS.md` when the repo is created, and fix the `DOCS` path/URL for how the docs repo is checked out there.

Instructions for AI assistants working in **apps/api** — the Django 6 + DRF backend of SchoolHub, an AI-powered multi-tenant School Management SaaS.

## Required Reading, In Order

`DOCS = <path or URL of the docs/ docs repo>`

1. `DOCS/AGENTS.md` — project summary, locked vocabulary, invariants. Always.
2. `DOCS/context/context-map.md` — find your task type, load only its 3–6 files.
3. For module work in `apps/<module>/`: that module's doc `DOCS/docs/03-modules/<module>.md` **is the spec** — features, workflows, validations, permissions (§4), endpoints (§16). Its entity file in `DOCS/docs/05-database/entities/` is the schema spec.

## Repo Layout (see `DOCS/docs/02-architecture/repo-structure.md`)

- `config/` — settings per environment; `core/` — tenancy (RLS middleware), RBAC, notifications, AI gateway; `apps/<module>/` — one Django app per module doc, each with `models/ serializers/ views/ services/ permissions/ tests/`.
- Business logic lives in `services/`, not in views or serializers.

## Hard Rules

1. **Tenancy:** never query outside the request tenant. Default managers are tenant-scoped; the unsafe manager is for `core/platform` code only and needs a review comment. New tables: `tenant_id` + RLS policy in the same migration.
2. **RBAC:** every endpoint declares its `module.resource.action` permission key (from the module doc §4). No inline ad-hoc checks.
3. **Money:** ledger writes are append-only; monetary endpoints accept `Idempotency-Key`.
4. **AI:** all provider calls go through `core/ai` (the gateway). Never call an LLM SDK from an app. AI output that reaches users is saved as a draft pending approval.
5. **Every module PR ships:** migrations + seeds, RBAC permission rows, tests (including a cross-tenant access test per new endpoint), OpenAPI annotations, feature-flag wiring.
6. **API shape:** follow `DOCS/docs/02-architecture/api-architecture.md` — envelope, error codes, pagination, 404-for-cross-tenant.
7. If implementation must diverge from the module doc, update the doc in the same PR and say why.
