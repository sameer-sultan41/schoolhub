# AGENTS.md — SchoolHub

Instructions for AI assistants working in this repository.

## What This Is

**SchoolHub** is an AI-powered, multi-tenant School Management SaaS. One platform
serves many schools; each school (a *tenant*) has its own users, branding,
configuration, workflows and public website, isolated by PostgreSQL Row-Level
Security. AI is a core product layer, not a bolt-on.

Everything lives in one repository: the specification, the backend, both
frontends, and the infrastructure. A change that spans them is **one pull
request** — which is the point, because the contract between backend and frontend
had already drifted silently while they lived apart.

## Layout

```
docs/              The specification. It is the requirement, not commentary.
  03-modules/      One doc per module — behaviour, permissions, endpoints
  05-database/     Column-level entity specs
  02-architecture/ Cross-cutting mechanics (tenancy, API, RBAC, AI, …)
apps/api/          Django 6 + DRF backend
apps/dashboard/    Next.js 16 admin dashboard
apps/website/      Next.js 16 multi-tenant public school website renderer
packages/          Shared TS: ui, types, api-client, config
infra/             Local stack, PostgreSQL roles, Terraform, runbooks
```

## Before Coding

0. **Look up library documentation through Context7**, registered in `.mcp.json`.
   Resolve the library, read its version-matched docs, and follow them — do not
   write setup steps, config or non-trivial API usage from recall. If Context7 is
   unavailable in your session, say so rather than silently guessing, then fall
   back to the vendor's official docs. Requires `CONTEXT7_API_KEY` exported.
0b. **Load the matching skill before writing frontend code.** These are Vercel's
   own guidance and are installed on this machine; they outrank generic advice on
   framework questions.

   | Working on | Load |
   | ---------- | ---- |
   | React/Next performance — waterfalls, bundle size, re-renders | `react-best-practices` |
   | Route/file conventions, RSC boundaries, data fetching | `next-best-practices` |
   | Caching, PPR, `use cache` / `cacheLife` / `cacheTag` | `next-cache-components` |
   | `turbo.json`, workspace layout, task graph, caching | `turborepo` |
   | UI review, accessibility | `web-design-guidelines` |
   | Bumping the Next.js major | `next-upgrade` |

   Precedence when they conflict: this repository's own conventions first (they are
   product decisions no vendor has an opinion on), then the vendor skill, then any
   in-house generic guidance.

1. Read `docs/AGENTS.md` for locked vocabulary and invariants.
2. `docs/context/context-map.md` maps a task type to the 3–6 docs worth loading.
   Do not read the whole specification.
3. Building a module means reading `docs/03-modules/<module>.md` — it defines the
   features, permission keys (§4), validations (§11) and endpoints (§16) — plus
   its entity file under `docs/05-database/entities/`.
4. Per-area rules live next to the code: `apps/api/AGENTS.md`,
   `apps/api/docs/ENGINEERING_STANDARDS.md`, `apps/dashboard/AGENTS.md`,
   `apps/website/AGENTS.md`, `infra/AGENTS.md`.

## Invariants

1. **Tenant isolation is enforced by the database.** Every tenant-owned table has
   `tenant_id` and an RLS policy; the app role has neither `BYPASSRLS` nor table
   ownership. Tenant context is bound per transaction with `SET LOCAL`.
2. **Cross-tenant access returns 404**, never 403 — a 403 confirms the record exists.
3. **Every endpoint declares a `module.resource.action` permission key.** The
   permission class fails closed without one.
4. **Money is append-only.** Ledger entries are never updated or deleted.
5. **AI drafts, humans publish.** No AI output reaches a student, parent or the
   public without a permission-gated human approval.
6. **The API contract is generated, not hand-written.** Backend and client change
   together, in one commit.

## Working Here

- A change spanning backend and frontend belongs in **one PR**. That is why these
  are in one repository.
- CI is path-filtered: touching `apps/api/**` runs the backend jobs only. The
  workflows are `.github/workflows/{api,frontend,infra-compose,infra-terraform}.yml`.
- **Do not run tests, linters or typechecks locally.** Commit, push, and read CI —
  CI is the source of truth for pass/fail.
- **Never add a `Co-Authored-By` trailer or any AI attribution** to a commit or PR.
- When behaviour changes, update the module doc in the same PR. The docs are the
  review baseline.

## Toolchains

Python 3.14 / Django 6.1 in `apps/api` (its own `pyproject.toml`), and a pnpm +
Turborepo workspace covering `apps/dashboard`, `apps/website` and `packages/*`.
The workspace list is explicit rather than `apps/*`, because `apps/api` is not a
pnpm package.
