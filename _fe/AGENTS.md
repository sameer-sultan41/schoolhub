# AGENTS.md — schoolhub-frontend (monorepo root)

Instructions for AI assistants working in this repository. Read this file first, then the
app-level `AGENTS.md` for whichever app you are touching (`apps/dashboard/AGENTS.md`,
`apps/website/AGENTS.md`).

## What This Repo Is

The frontend Turborepo for **SchoolHub**, an AI-powered multi-tenant School Management SaaS.
Two Next.js App Router apps and four shared packages:

| Workspace | Purpose |
| --------- | ------- |
| `apps/dashboard` | Admin dashboard (authenticated, per-tenant, one route group per module) |
| `apps/website` | Public multi-tenant school website renderer (Host-header tenant resolution, ISR) |
| `packages/ui` | shadcn-based shared components + the Tailwind v4 theme layer and token contract |
| `packages/types` | Shared TS types: API envelope, errors, pagination, tenant, auth, CMS content |
| `packages/api-client` | Typed REST client — **regenerated from the API's OpenAPI spec**, not hand-edited |
| `packages/config` | Shared ESLint flat config |

## Where the Work Stands

[`docs/STATUS.md`](docs/STATUS.md) is the hand-off note: what is built, what is deliberately
missing, and the ordered next steps. **Read it before starting, and update it in the same PR
as your change** — the next session relies on it.

## The Specification Lives in Another Repo

`DOCS = https://github.com/sameer-sultan41/schoolhub-srd`

That doc set is the source of truth for behaviour, vocabulary, and invariants — this repo is
an implementation of it.

**The context-map rule: never load the whole doc set.** Open `DOCS/context/context-map.md`,
find the row matching your task type, and read only the 3–6 files it lists. Always also read
`DOCS/AGENTS.md`. Most frontend work lands on one of these rows:

| Task | Row to load |
| ---- | ----------- |
| Dashboard UI for a module | "Build dashboard UI for a module" → `docs/03-modules/<module>.md` · `api-architecture.md` · `tech-stack.md` §3 · `users-and-roles.md` |
| Public website / theme work | "Public school website / theme work" → `website-builder.md` · `website-cms.md` · `entities/website-cms.md` |
| Auth, roles, permissions | "Tenancy, auth, roles, permissions" |
| Tests | "Write or review tests" → `docs/07-quality/testing-strategy.md` |

If a doc's `> **Agent Context**` header says the doc is not the one you need, stop reading it.

## Locked Vocabulary (never invent alternatives)

- **Permission keys** — `module.resource.action` (`fees.invoice.create`, `exams.result.approve`).
- **Role slugs** — only those in `DOCS/docs/00-overview/users-and-roles.md`.
- **API** — versioned REST `/api/v1/…`, plural kebab-case resources, colon-actions (`:publish`).
- **Envelope** — success `{ data, meta }`; error `{ error: { code, message, details, request_id } }`.

## Stack (fixed — see `DOCS/docs/02-architecture/tech-stack.md` §3)

Next.js 16 App Router · React 19 · TypeScript 7 for `tsc` / 6 for tooling (strict) ·
Tailwind CSS 4 + shadcn/ui ·
TanStack Query v5 (server state) · Zustand v5 (the little true client state) · React Hook Form
+ Zod v4 · next-intl v4 · **Jest** + React Testing Library · Node 24.

Deviations from the spec doc, decided by the team and authoritative here:

- **Jest, not Vitest** (the doc names Vitest). Apps configure it through `next/jest`; packages
  use `@swc/jest`. Test files are co-located as `*.test.ts(x)`.
- **No Playwright / no E2E layer yet.** Do not add one without asking.

The spec doc also names Next.js 15 / Tailwind 3; this repo runs the current majors of the same
choices. Two consequences worth knowing:

- **Tailwind 4 is CSS-first.** There is no `tailwind.config.ts`. Design tokens live in
  `@theme` blocks — the shared layer is `packages/ui/src/styles/theme.css`, imported by each
  app's `globals.css`. PostCSS uses `@tailwindcss/postcss`.
- **ESLint is flat-config only** — `eslint.config.mjs`, extending
  `@schoolhub/config/eslint`. No `.eslintrc`.
- **ESLint is pinned to 9.x, not 10.** ESLint 10
  ([migration guide](https://eslint.org/docs/latest/use/migrate-to-10.0.0)) removed the
  deprecated `context.getFilename()`; `eslint-plugin-react` 7.37.5 still calls it, ships inside
  `eslint-config-next`, and has no ESLint 10-compatible release. On ESLint 10 every app lint
  task dies with `Error while loading rule 'react/display-name'`. ESLint's own guidance offers
  a codemod for *first-party* rules only — for third-party plugins the answer is to stay on 9
  until they migrate. Bump ESLint once `eslint-plugin-react` supports 10.
- **Two TypeScripts, on purpose — this is the setup TypeScript 7 documents.** TypeScript 7.0
  is the native (Go) port and ships **no stable programmatic API**; 7.1 will introduce a new
  one. So every tool that consumes the compiler API — typescript-eslint, `eslint-config-next`
  (which requires typescript-eslint at module load), Next's own type checking, your editor —
  needs the TS 6 API, while `tsc` itself can be the fast native 7. Hence the aliases in every
  `package.json`:

  ```json
  "typescript": "npm:@typescript/typescript6@^6.0.2",   // what tools resolve → TS 6 API
  "@typescript/native": "npm:typescript@^7.0.2"          // provides the `tsc` binary → TS 7
  ```

  `pnpm typecheck` therefore runs TS 7 (`tsc --noEmit`), and the lockfile records the linter
  bound to the TS 6 API: `typescript-eslint@8.67.0(@typescript/typescript6@6.0.2)`. TS 6 also
  exposes `tsc6` if you need the old compiler directly.

  Do **not** "simplify" this by pointing `typescript` at 7.x: the lint layer dies instantly
  with `typescript-eslint does not support TS 7.0`, and Next loses its type checking. Collapse
  back to a single TypeScript once typescript-eslint supports the 7.1 API
  ([typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)) —
  the maintainers describe that as months away, gated on an async ESLint parser.
  Reference: [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
  § running side-by-side with TypeScript 6.0.

## Repo-Wide Hard Rules

1. **TypeScript strict everywhere.** No `any` in committed code, no `@ts-expect-error` without
   a one-line reason.
2. **No hardcoded brand colours.** Tenant branding drives theming through CSS custom
   properties (`--sh-color-*`) fed from tenant settings. Tailwind classes reference the token
   names declared in `packages/ui/src/styles/theme.css`, never a literal hex or a
   `blue-600`-style brand colour.
3. **RBAC is server-side.** `hasPermission()` in the dashboard hides and disables UI — it is UX,
   never enforcement. The API is the authority.
4. **`apps/website` never writes tenant data.** It holds a read-only machine token; only read
   functions are exported from its `src/lib`. Public form submissions POST from the browser
   straight to the rate-limited public API endpoints.
5. **`packages/api-client` is generated.** Structural changes belong in the generator/OpenAPI
   spec, not in hand edits — see its README.
6. **Sharing follows the rule of three.** A component graduates to `packages/ui` only when
   ≥ 2 apps use it.
7. **Never commit secrets.** Every new variable goes into `.env.example` with a dummy value and
   a one-line comment.
8. **Errors render from the envelope** — surface `error.code` and field `details`; do not invent
   messages for known codes.

## Conventions

- `kebab-case` file names, `PascalCase` components, `use*` hooks.
- Tests co-located as `*.test.ts(x)` (Jest + React Testing Library).
- `next build` no longer runs ESLint (Next 16) — lint is its own script and its own CI step.
- Dashboard module code lives in `src/features/<module>/` with routes in
  `src/app/(app)/<module>/`, mirroring the module docs one-to-one.
- Commands run through Turborepo from the root: `pnpm dev|build|lint|test|typecheck`.

## Verification

CI (`.github/workflows/ci.yml`) runs lint, typecheck, test, and a per-app build matrix. CI is
the source of truth for pass/fail.
