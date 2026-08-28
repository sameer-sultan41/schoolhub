<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — schoolhub-frontend / apps/dashboard

Instructions for AI assistants working on the **SchoolHub admin dashboard** — Next.js 16 +
TypeScript in the Turborepo monorepo (`apps/dashboard`, shared `packages/ui`,
`packages/api-client`, `packages/types`).

Read the monorepo root [`../../AGENTS.md`](../../AGENTS.md) first — it holds the repo-wide rules.

## Required Reading, In Order

`DOCS = <repo root>/docs`

1. `DOCS/AGENTS.md` — project summary, locked vocabulary, invariants. Always.
2. `DOCS/context/context-map.md` — row "Build dashboard UI for a module".
3. The module doc `DOCS/docs/03-modules/<module>.md` for the screen you are building: §5–§8 define
   the features/workflows/journeys, §11 the validations to mirror client-side, §13 the reports,
   §16 the endpoints you consume.

## Stack Rules (see `DOCS/docs/02-architecture/tech-stack.md` §3)

- Server state via TanStack Query against the generated API client (`packages/api-client`,
  regenerated from OpenAPI — never hand-write fetch types). Minimal client state via Zustand.
- Forms: React Hook Form + Zod; Zod schemas mirror the module doc §11 validations.
- UI: Tailwind + shadcn/ui components from `packages/ui`; tenant branding comes from tenant
  settings — no hardcoded colors.
- i18n via `next-intl`; every user-facing string goes through messages, RTL-safe layout.

## Hard Rules

1. **Permission-aware UI:** hide/disable by the user's permission keys (module doc §4), but never
   treat that as security — the API enforces.
2. **Roles:** only slugs from `DOCS/docs/00-overview/users-and-roles.md`.
3. **Async jobs:** long operations return `202` + job resource — build polling/progress UI, don't
   block.
4. **Errors:** render the API error envelope (`error.code`, field `details`) — don't invent
   messages for known codes.
5. **Accessibility:** WCAG 2.1 AA per `DOCS/docs/07-quality/non-functional.md`.
6. Component tests per `DOCS/docs/07-quality/testing-strategy.md` — **Jest + React Testing
   Library** in this repo (the doc says Vitest; the team chose Jest). There is no E2E layer yet.

## How This App Is Wired

| Concern | Where |
| ------- | ----- |
| Auth guard (routing only, cookie presence) | `src/proxy.ts` (Next 16's rename of `middleware`) |
| Access token in memory + refresh-on-401 | `src/lib/auth.ts` → `@schoolhub/api-client` |
| Permission helpers (`hasPermission`, `<Can>`) | `src/lib/permissions.ts`, `src/components/can.tsx` |
| TanStack Query client + key factory | `src/lib/query-client.ts` |
| Validated public env | `src/lib/env.ts` |
| Tenant branding → CSS variables | `src/components/tenant-theme.tsx` |
| Locale resolution (no locale routing) | `src/i18n/request.ts`, `messages/*.json` |
| Route groups | `src/app/(auth)/…` unauthenticated · `src/app/(app)/…` authenticated |

**Never** put the access token in `localStorage` or a readable cookie, and never add a
`tenant_id` request parameter — the tenant always comes from the authenticated context.

## Adding a Module Screen

1. Route: `src/app/(app)/<module>/page.tsx` (async server component for chrome).
2. Feature code: `src/features/<module>/` — components, hooks, query definitions.
3. Query keys via `queryKeys.list("<module>", "<resource>", params)`.
4. Gate every action with `<Can permission="module.resource.action">`.
5. Strings into `messages/en.json` **and** `messages/ur.json`.
6. Co-locate tests as `*.test.tsx`.

## Guidance To Load First

Before writing or reviewing code here, load the Vercel skill that matches the work:
`react-best-practices` for performance (waterfalls, bundle size, re-renders),
`next-best-practices` for route conventions, RSC boundaries and data fetching,
`next-cache-components` for caching and PPR, and `web-design-guidelines` for
accessibility review. They are installed on this machine and outrank generic
advice on framework questions; this app's own conventions still win over both.
