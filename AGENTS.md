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
e2e/               Playwright browser suite (dashboard + website + live lane)
infra/             Local stack, PostgreSQL roles, Terraform, runbooks
```

## Before Coding

- **If `graphify-out/graph.json` exists**, read [`CLAUDE.md`](CLAUDE.md) first —
  it has graphify's rules for using the knowledge graph instead of raw grep/find
  for architecture and cross-module questions, and a PreToolUse hook
  (`.claude/settings.json`) nudges toward it automatically. The graph is
  gitignored and local-only; regenerate with `/graphify` if it's missing or stale.


0. **Look up library documentation through Context7**, available via Anthropic's
   official `context7` plugin (`claude plugin enable context7@claude-plugins-official`
   if it is ever disabled). Resolve the library, read its version-matched docs, and
   follow them — do not write setup steps, config or non-trivial API usage from
   recall. It works anonymously; export `CONTEXT7_API_KEY` for higher rate limits.
   If Context7 is unavailable in your session, say so rather than silently
   guessing, then fall back to the vendor's official docs.
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
   | Writing or fixing a Playwright spec | `e2e/README.md` (repo-local, not a skill) |

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
   `apps/website/AGENTS.md`, `e2e/AGENTS.md`, `infra/AGENTS.md`.

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

- **`main` only moves through a reviewed, CI-green pull request.** Direct pushes
  to `main` are rejected by a repo-tracked pre-push hook (`.githooks/pre-push`).
  One-time per clone: `git config core.hooksPath .githooks`. Workflow:
  ```
  git checkout -b <branch-name>
  git push -u origin <branch-name>
  gh pr create --base main
  # wait for CI, then:
  gh pr merge --squash --delete-branch
  ```
  GitHub's own branch protection is unavailable on this private repo without
  GitHub Pro or moving it into an organization (`.github/rulesets/` has a ruleset
  ready to import if either becomes true) — the hook is the enforcement until then.
- **Local hooks catch what CI would reject, sooner.** The same
  `git config core.hooksPath .githooks` opt-in enables both:

  | Hook | Runs | Checks |
  | ---- | ---- | ------ |
  | `pre-commit` | staged files only, fast | ESLint · Prettier (`--check`) · ruff (`check` + `format --check`) · cspell |
  | `pre-push` | project-wide, slower | `main`-push block · `tsc` typecheck · mypy |

  Split by cost: `tsc` and mypy need the whole project graph and are too slow to run
  on every commit. A tool that is genuinely not installed (no Python venv, say)
  **warns and skips** rather than blocking — CI remains the authority, and a
  frontend-only contributor must still be able to commit.

  `SKIP_HOOKS=1` skips the lint/typecheck checks for one commit or push.
  **It does not bypass the `main`-push block** — that check runs before `SKIP_HOOKS`
  is even read, deliberately, since it enforces the PR-only workflow above, not code
  quality. `git push --no-verify` is the only way past it.

  Spelling is checked by **cspell** (`cspell.json`, root `pnpm spell`). Project
  vocabulary lives in `.cspell/project-words.txt` — add a genuine term there; do not
  add a word to silence a real typo. The docs are written in British English, which
  the `en-GB` locale covers, so those spellings are not listed individually.

  Formatting is **Prettier** (root `prettier.config.mjs`; `apps/dashboard` and
  `apps/website` each extend it with `prettier-plugin-tailwindcss`, since Tailwind v4
  is CSS-first and each app needs its own stylesheet entry point). `pnpm format` writes,
  `pnpm format:check` verifies — the same check CI runs in `repo-hygiene.yml`.
  `.prettierignore` deliberately excludes markdown (hand-tuned tables and mermaid
  diagrams), `apps/api/**` (ruff's territory), and
  `packages/api-client/src/schema.d.ts` (generated; reformatting it would break the
  schema-staleness gate in `frontend.yml`). `eslint-config-prettier` is wired into the
  shared ESLint base last, per Next.js's own documented integration, so ESLint's
  formatting-adjacent rules never fight Prettier's.
- A change spanning backend and frontend belongs in **one PR**. That is why these
  are in one repository.
- CI is path-filtered: touching `apps/api/**` runs the backend jobs only. The
  workflows are `.github/workflows/{api,frontend,infra-compose,infra-terraform}.yml`.
- **Two test layers, and they are not interchangeable.** Jest covers units and
  components in jsdom; `e2e/` drives a real browser. An assertion that needs a real
  database (RLS, cross-tenant isolation) belongs in the E2E `live` lane and nowhere
  else — a stubbed API returns whatever it was told to and proves nothing.
- **Do not run tests, linters or typechecks locally.** Commit, push, and read CI —
  CI is the source of truth for pass/fail.
- **Never add a `Co-Authored-By` trailer or any AI attribution** to a commit or PR.
- When behaviour changes, update the module doc in the same PR. The docs are the
  review baseline.

## Toolchains

Python 3.14 / Django 6.1 in `apps/api` (its own `pyproject.toml`), and a pnpm +
Turborepo workspace covering `apps/dashboard`, `apps/website`, `packages/*` and `e2e`.
The workspace list is explicit rather than `apps/*`, because `apps/api` is not a
pnpm package.
