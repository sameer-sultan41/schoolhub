# AGENTS.md — schoolhub-frontend-v2 / apps/dashboard (template)

> Copy this file to the frontend monorepo (or the dashboard app root) as `AGENTS.md` when the repo is created, and fix the `DOCS` path/URL.

Instructions for AI assistants working on the **SchoolHub admin dashboard** — Next.js 16 + TypeScript in the Turborepo monorepo (`apps/dashboard`, shared `packages/ui`, `packages/api-client`, `packages/types`).

## Required Reading, In Order

`DOCS = <path or URL of the schoolhub-srd docs repo>`

1. `DOCS/AGENTS.md` — project summary, locked vocabulary, invariants. Always.
2. `DOCS/context/context-map.md` — row "Build dashboard UI for a module".
3. The module doc `DOCS/docs/03-modules/<module>.md` for the screen you are building: §5–§8 define the features/workflows/journeys, §11 the validations to mirror client-side, §13 the reports, §16 the endpoints you consume.

## Stack Rules (see `DOCS/docs/02-architecture/tech-stack.md` §3)

- Server state via TanStack Query against the generated API client (`packages/api-client`, regenerated from OpenAPI — never hand-write fetch types). Minimal client state via Zustand.
- Forms: React Hook Form + Zod; Zod schemas mirror the module doc §11 validations.
- UI: Tailwind + shadcn/ui components from `packages/ui`; tenant branding comes from tenant settings — no hardcoded colors.
- i18n via `next-intl`; every user-facing string goes through messages, RTL-safe layout.

## Hard Rules

1. **Permission-aware UI:** hide/disable by the user's permission keys (module doc §4), but never treat that as security — the API enforces.
2. **Roles:** only slugs from `DOCS/docs/00-overview/users-and-roles.md`.
3. **Async jobs:** long operations return `202` + job resource — build polling/progress UI, don't block.
4. **Errors:** render the API error envelope (`error.code`, field `details`) — don't invent messages for known codes.
5. **Accessibility:** WCAG 2.1 AA per `DOCS/docs/07-quality/non-functional.md`.
6. Component/E2E tests per `DOCS/docs/07-quality/testing-strategy.md` (Vitest + RTL, Playwright).
