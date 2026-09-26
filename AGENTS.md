# AGENTS.md — SchoolHub

Instructions for AI assistants working in this repository. `CLAUDE.md` imports this file, so
it is in every session's context — and every subagent's. Keep it short: rules and routing
only. Detail lives in the files it points to; read those **when the task touches them**.

## What This Is

**SchoolHub** is an AI-powered, multi-tenant School Management SaaS. One platform serves many
schools; each school (a *tenant*) has its own users, branding, configuration, workflows and
public website, isolated by PostgreSQL Row-Level Security. AI is a core product layer, not a
bolt-on.

Everything lives in one repository — specification, backend, both frontends, infrastructure —
so a change that spans them is **one pull request**
([ADR-0002](docs/decisions/0002-single-monorepo.md)).

## Layout

```
docs/              The specification. It is the requirement, not commentary.
  03-modules/      One doc per module — behaviour, permissions (§4), validations (§11), endpoints (§16)
  05-database/     Column-level entity specs
  02-architecture/ Cross-cutting mechanics; repo-structure.md says where new code goes
  decisions/       Architecture decision records — why things are the way they are
apps/api/          Django 6.1 + DRF backend (uv-managed)
apps/dashboard/    Next.js 16 admin dashboard
apps/website/      Next.js 16 multi-tenant public website renderer
packages/          Shared TS: ui, types, api-client, config
e2e/               Playwright browser suite (dashboard + website + live lane)
infra/             Local stack, PostgreSQL roles, Terraform, runbooks
```

## Precedence

In this repository, **this file, `docs/decisions/` and `.claude/` override the organisation
sourcebook** injected at session start. Its LinkedUnion conventions — `LU-` ticket branches,
US spelling, `app_id` query scoping, migrations in their own PR, the `g-flow` tiers and the
`lu-*` agents — do not apply here. `.claude/settings.json` switches off `g-flow`,
`g-python-skill`, `g-typescript-skill` and the three `g-*-testing-skill` skills, and denies the
`lu-*` agents. When guidance conflicts: this repo's docs and ADRs first (product decisions no
vendor has an opinion on), then the vendor skills below, then generic guidance.

## Before Coding

1. **Route, don't crawl.** Read [`docs/AGENTS.md`](docs/AGENTS.md) (locked vocabulary), then find
   your task type in [`docs/context/context-map.md`](docs/context/context-map.md) and load only
   the 3–6 files it lists. Building a module means its `docs/03-modules/<module>.md` plus its
   entity file under `docs/05-database/entities/`. Picking up in-flight work means
   [`docs/project-status.md`](docs/project-status.md).
2. **Know why before changing how.** Before proposing to change a convention, read its record in
   [`docs/decisions/`](docs/decisions/README.md). Where new code belongs is
   [`docs/02-architecture/repo-structure.md`](docs/02-architecture/repo-structure.md) §2.
3. **Per-area rules load themselves.** Each of `apps/api`, `apps/dashboard`, `apps/website`,
   `packages/ui`, `e2e`, `infra` and `docs` has a `CLAUDE.md` importing its own `AGENTS.md`,
   which loads when you open files there. Follow it.
4. **Library docs come from Context7** (the `context7` plugin): resolve the library, read its
   version-matched docs, and follow them — never write setup, config or non-trivial API usage
   from recall. If Context7 is unavailable, say so, then use the vendor's official docs.
5. **Load the matching skill first:**

   | Working on | Load |
   | ---------- | ---- |
   | Any test, in any layer | `schoolhub-testing` |
   | A dashboard API call | `schoolhub-api-services` |
   | A backend module or resource, or splitting a flat app | `schoolhub-backend-module` |
   | A new or ported primitive in `packages/ui` | `schoolhub-ui-port` |
   | React/Next performance — waterfalls, bundle size, re-renders | `react-best-practices` |
   | Route/file conventions, RSC boundaries, data fetching | `next-best-practices` |
   | Caching, PPR, `use cache` / `cacheLife` / `cacheTag` | `next-cache-components` |
   | `turbo.json`, workspace layout, task graph | `turborepo` |
   | UI review, accessibility | `web-design-guidelines` |
   | Bumping the Next.js major | `next-upgrade` |

6. **graphify.** If `graphify-out/graph.json` exists, `CLAUDE.md`'s graphify rules apply —
   prefer the graph over grep for cross-module questions.

## Invariants

Every change is checked against these. This is the single list; other docs link here.

1. **Tenant isolation is enforced by the database.** Every tenant-owned table has `tenant_id`
   and an RLS policy; the app role has neither `BYPASSRLS` nor table ownership. Tenant context
   is bound per transaction with `SET LOCAL` ([ADR-0003](docs/decisions/0003-tenant-isolation-rls.md)).
2. **Cross-tenant access returns 404**, never 403 — a 403 confirms the record exists
   ([ADR-0004](docs/decisions/0004-cross-tenant-404.md)).
3. **Every endpoint declares a `module.resource.action` permission key.** The permission class
   fails closed without one. RBAC is server-side; UI hiding is UX, never enforcement.
4. **Money is append-only.** Ledger entries are never updated or deleted; corrections are new
   entries.
5. **AI drafts, humans publish.** No AI output reaches a student, parent or the public without a
   permission-gated human approval ([`docs/04-ai/ai-governance.md`](docs/04-ai/ai-governance.md)).
6. **The API contract is generated, not hand-written.** Backend and client change together, in
   one commit ([ADR-0005](docs/decisions/0005-generated-api-contract.md)).
7. **Mobile-readiness.** No web-only shortcut (cookie-bound auth, HTML-only flows); the same API
   must serve future mobile apps.

## Working Here

- **`main` only moves through a reviewed, CI-green pull request.** Branch (`feat/…`, `fix/…`,
  `chore/…`, `refactor/…`), push, `gh pr create --base main`. The **human** merges, with a merge
  commit ([ADR-0006](docs/decisions/0006-merge-commits.md)); an agent stops at "PR open, CI
  green". Never commit or push without the user's go-ahead.
- **CI is the source of truth** ([ADR-0007](docs/decisions/0007-ci-source-of-truth.md)). Agents
  never run test suites, linters or typechecks by hand: commit, push, and read
  `gh pr checks <n> --watch` / `gh run view <id> --log-failed`. Git hooks run automatically as
  gates — fix what they reject; never `--no-verify` or `SKIP_HOOKS=1`. Hook details, Prettier,
  cspell and blame setup: [`docs/07-quality/tooling.md`](docs/07-quality/tooling.md).
- **Never add a `Co-Authored-By` trailer or any AI attribution** to a commit or PR.
- **Docs change in the same PR as the behaviour.** A changed flow updates its module doc; a new
  module, endpoint or user-facing flow gets its own doc or section in the PR that ships it, not
  a follow-up; project state updates `docs/project-status.md`; anything deferred goes in
  `docs/deferred-work.md`; a choice between real alternatives adds an ADR.
- **Two test layers, not interchangeable.** Jest covers units and components in jsdom; `e2e/`
  drives a real browser. An assertion that needs a real database (RLS, cross-tenant isolation)
  belongs in the E2E `live` lane or backend tests — a stubbed API proves nothing.
- **CI workflows** (`.github/workflows/`): `api`, `frontend`, `infra-compose` and
  `infra-terraform` are path-filtered to their area; `repo-hygiene` (links, spelling, formatting,
  secrets, doc-sync) has no path filter and runs on PRs to `main` and the branch prefixes above;
  `e2e-live` runs nightly and on manual dispatch, not on PRs.
- **A repeated multi-step task becomes a skill**, not muscle memory: a scoped
  `.claude/skills/<name>/SKILL.md` with the exact commands, paths and gotchas (see `CLAUDE.md`).

## Toolchains

`apps/api` is Python 3.14 / Django 6.1, managed by [uv](https://docs.astral.sh/uv/) (`uv sync`,
`uv run`; the uv version pin is explained in [`apps/api/AGENTS.md`](apps/api/AGENTS.md)).
Everything else is a pnpm + Turborepo workspace — `apps/dashboard`, `apps/website`, `packages/*`
and `e2e`, listed explicitly because `apps/api` is not a pnpm package.
