# SchoolHub engineering standards, agent context and cross-agent review

**Tier:** 2 · **Status:** Approved 2026-09-26 · Executed as PRs 1a, 1b, 1c, 2, 3, 4, 5 (stacked).

## Context

You asked for three things:

- A professional, modular architecture with conventions that stop hardcoding and hotfix-style code.
- Agent context (docs, skills, rules) that works at full strength and records *why* each approach was chosen.
- An independent agent that checks every non-trivial plan and pushes toward the real, industry-standard fix instead of drifting.

The repo already *writes down* good rules. The audit found four problems that undercut them.

**1. The agent never sees most of the rules.**
- Root `CLAUDE.md` does not import `AGENTS.md`, so a root session never loads the invariants, the PR workflow or the tooling rules.
- `apps/api`, `e2e` and `infra` have no `CLAUDE.md` shim.
- About 13 docs and skills contradict each other or the code:
  - `__tests__/` vs flat test files
  - merge style
  - coverage 80 vs 85
  - Django 5/Next 15/PG 16 vs 6.1/16/18
  - backend layout
  - Metronic vendoring
  - agent-run `gh pr merge`
- Seven referenced paths don't exist (`docs/adr/`, `/run-skill-generator`, `can.tsx`, `tenant-theme.tsx`, `core/ai`, and others).
- `repo-structure.md` still describes the old four-repo layout.
- The LinkedUnion org context is also live here. `g-flow`, the `g-python`/`g-typescript` skills and the `lu-*` agents enforce `app_id` scoping, US spelling, flake8 at 240 columns, and migrations in their own PR.

**2. The rationale is scattered.** The "why X over Y" is spread across AGENTS.md prose, module §20s, a 20k-token `project-status.md` (44 KB of "Deliberately NOT done"), and about 300 file headers. `docs/adr/` is referenced but has never existed.

**3. The enforcement is mostly not switched on.**
- Hooks aren't installed: `core.hooksPath` is unset.
- The GitHub ruleset is inactive (private repo, no Pro).
- These rules are documented but have no lint rule behind them:
  - api-client boundary
  - JSX literals: about 31 in the dashboard, 0 `t()` calls in `/staff`
  - `process.env` bypasses: 4
  - `max-lines`: `staff-form-dialog.tsx` 965; `fees_finance/services.py` 1864
  - `core` ↛ apps
  - type hints
- The "cross-tenant harness auto-enrols routes" claim is false.
- 41 commits carry the forbidden `Co-Authored-By` trailer.

**4. Written rules don't match reality.**
- "Apps talk only via `services.py`" was never true: 111 of 128 cross-app imports target another app's `models`.
- 276 permission-key literals are in views, and the inline ones aren't validated.
- The rule of three is broken by copy-paste: `_fk` in 6 apps, and the staff and student import/document pipelines are copied wholesale.
- The dashboard's `features/` holds only `auth`. `/staff` lives in its route folder and calls `Services.dashboard.*`.

The result is a `fix:feat` ratio of about 2:1: 81 vs 39 in the last 200 commits, with runs of 4–7 same-scope fixes, `diag:` commits, and "satisfy the linter" commits after CI.

**Decisions you confirmed:**
- All three sub-projects, phased, context and agents first.
- Auto-review of non-trivial plans.
- Schoolhub-specific project agents.
- A ratchet for existing debt.
- A `Root cause:` line required on `fix` commits.

**Outcome:** every session loads the right rules once. Every real decision has an ADR naming what enforces it. Every non-trivial plan, and the diff that implements it, is independently checked against the goal and against industry practice. New code can't add hardcoding, boundary violations or AI trailers, and old debt can only shrink.

## Global constraints (apply to every PR)

- **The agent never runs tests, lint or typechecks locally.** That includes generating baselines. A new `workflow_dispatch` workflow, `.github/workflows/generate-baselines.yml`, runs the tool in CI and uploads a `git diff` patch as an artifact. The agent applies it with `gh run download` + `git apply`. Examples:
  - `eslint --suppress-all` per workspace
  - `ruff check --select RUF100 --fix`
  - import-linter to list violations
  - coverage per package

  Read CI with `gh pr checks <n> --watch` and `gh run view <id> --log-failed`. Automatic git hooks are fine; fix what they reject. Never use `--no-verify` or `SKIP_HOOKS=1`.
- **Commits and PRs:**
  - No commit or push without your explicit go-ahead for each PR.
  - No `Co-Authored-By` or "Generated with" lines.
  - **You** merge, with a merge commit (ADR-0006). The agent stops at "PR open, CI green".
- **Never touch `.env*`, including `.env.example`, without asking at that moment.**
- **Branch prefixes follow the existing convention** (`chore/`, `refactor/`, `feat/`, `fix/`). The CI branch filter applies to the *base* branch, so every PR targeting `main` gets full checks.
- **Docs are British English** (cspell `en-GB`). Add genuine new terms to `.cspell/project-words.txt`.
- **Run `graphify update .` after code edits.** This is an AST index refresh, not a test.
- **Commit this plan first.** Once approved, save it, including the `## Independent review` block below, as `docs/superpowers/specs/2026-09-26-engineering-standards-and-agent-workflow-design.md`.

---

## Phase 1: Context foundation (three docs/config PRs)

### PR 1a: Decision records, the architecture doc, splitting status

**New `docs/decisions/`** (this replaces the never-created `docs/adr/`; update the three references to it).

- `README.md` holds the index (number · title · status · enforced by) and the rule: *"A change that picks between real alternatives, or reverses a past choice, adds or supersedes an ADR in the same PR."*
- `0000-template.md` is MADR-lite, with these headings:
  - Status (Proposed / Accepted / Superseded by NNNN)
  - Date
  - Context
  - Decision
  - Alternatives considered (each with *why not*)
  - Consequences
  - **Enforced by** (the tool/file/test, or `review only (planned: PR n)`)
- **Backfill ADRs, 20–40 lines each**, quoting rationale that already exists and citing its source:

| # | Decision | Source today | Enforced by (after this plan) |
|---|---|---|---|
| 0001 | Record decisions as ADRs | — | PR template + reviewers (PR 2) |
| 0002 | One monorepo, not four repos | `AGENTS.md:12-15` | — |
| 0003 | Tenant isolation in PostgreSQL RLS | `docs/02-architecture/multi-tenancy.md` | `apps/api/tests/test_rls_coverage.py`, `test_rls_enforcement.py`, `infra-compose.yml` |
| 0004 | Cross-tenant access → 404, not 403 | `AGENTS.md:113` | hand-written `apps/*/tests/test_cross_tenant.py` (9/9 apps); a generic harness is backlog |
| 0005 | API contract generated (drf-spectacular → `openapi.yaml` → `schema.d.ts`) in the same commit | `AGENTS.md:119`, `api.yml:177` | `api.yml` openapi job, `frontend.yml` staleness check |
| 0006 | Merge commits, not squash | `AGENTS.md:134-141` | `.git-blame-ignore-revs` depends on it; ruleset (PR 3) |
| 0007 | CI is the source of truth; hooks split by cost; baselines generated in CI | `AGENTS.md:142-172` | `.githooks/*`, CI, `generate-baselines.yml` |
| 0008 | Jest + RTL, not Vitest | `apps/dashboard/AGENTS.md:48-49` | jest configs |
| 0009 | `packages/ui` primitives ported from Metronic (supersedes "shadcn-first"), with RTL-logical sides and required labels | `project-status.md` §Done; `sidebar.tsx`/`data-grid.tsx` headers | TS required props; RTL lint (PR 4) |
| 0010 | Backend layout: `models.py` at the app root, one package per resource (`serializers`, `viewset`, `services.py` or `services/<action>.py`, `urls`, `filters`, `tests/`) | module §20s, `repo-structure.md:38` | `schoolhub-backend-module` skill + change-reviewer |
| 0011 | Dashboard API calls only via `src/services/` (`Services.<module>`); `ApiError` re-exported from `@/services` | `schoolhub-api-services` skill | ESLint (PR 4) |
| 0012 | Tests in sibling `__tests__/` folders | dashboard/website AGENTS | CI check (PR 4) |
| 0013 | Cross-app dependencies, restated to match reality. Apps may import other apps' `models` (FKs, querysets, serializer fields). Mutations and business rules go through the owning app's `services`. Nothing imports another app's `views`/`viewset`/`urls`/`reports`/`tasks`. `core` imports no app. Strict ports-and-adapters was rejected: overkill for this size, and it would ban legitimate FKs | `repo-structure.md:36-38` | import-linter (PR 5) |
| 0014 | No hardcoded values: every value has one owner | new | ESLint (PR 4), ruff/import-linter/tests (PR 5) |

ADR-0014's owners:
- **Dashboard UI strings** live in `messages/{en,ur}.json`. The website chrome is exempt, because `website-builder.md` has no i18n requirement.
- **Env** goes through one typed module per runtime: `env.ts` (server), `env.client.ts` (public only), `config/settings/*`.
- **Magic values** become named constants.
- **Direction** uses RTL-logical classes.
- **Permission keys** stay literal `module.resource.action` strings, validated against the registry by contract test. This is the existing convention (`core/rbac/permissions.py:74-78`); a constants layer was rejected as churn without added safety.

ADR-0009 must record what actually happened: Metronic source ported, `packages/ui/src/styles/metronic/**` vendored. Ask you before finalising if the licence position is unclear.

**Rewrite `docs/02-architecture/repo-structure.md` as the as-built architecture.** This is the "high-level folder structure and conventions" deliverable.

1. **The real monorepo tree:** `apps/api` (config/ core/ apps/), `apps/dashboard/src` (app/ features/ services/ lib/ components/ i18n/), `apps/website/src`, `packages/*`, `e2e/`, `infra/`, `docs/`.
2. **A "Where does new code go?" table:**
   - backend resource → per ADR-0010
   - cross-module backend helper → `core/<area>`
   - dashboard screen → thin `src/app/(app)/<module>/page.tsx` + `src/features/<module>/`
   - API call → `src/services/modules/<module>/`
   - shared UI → `packages/ui`, once a second app uses it
   - shared types → `packages/types`
   - env → per ADR-0014
   - UI string → `messages/{en,ur}.json`
   - permission key → the module's `permissions.py`
   - tests → `__tests__/` or `apps/<m>/tests/`
3. **Dependency rules**, each naming its enforcer:
   - the ADR-0013 backend rules
   - `@schoolhub/api-client` only in dashboard `src/services/**` + `src/lib/auth.ts`
   - apps and packages never import each other by relative path (the `../**` ban)
   - route files stay thin
4. **Naming conventions**, kept as they are.
5. **Config policy:** 12-factor and ADR-0014. The rule of three decides extraction into `core/` or `packages/`.

**Other changes in this PR:**
- `docs/02-architecture/tech-stack.md` §7: mark it "original decision, superseded by §8 as-built". Fix the framing and versions in `docs/AGENTS.md` and `infra/AGENTS.md` ("documentation repo", sibling repos, Django 5/Next 15).
- **Split `docs/project-status.md`.** Move "Deliberately NOT done" (L85–681) verbatim to `docs/deferred-work.md`; the status doc keeps the matrix and "Start here". Update `repo-hygiene.yml` `project-status-sync` to accept a change to either file, and update its error text.

### PR 1b: What the agent loads, and precedence

**Auto-loading:**
- Root `CLAUDE.md` gets `@AGENTS.md` at the top and keeps the graphify section. Fix `AGENTS.md:34`.
- One-line `CLAUDE.md` shims (`@AGENTS.md`) go in `apps/api/`, `e2e/`, `infra/`, `docs/` and `packages/ui/`. This is the pattern `apps/dashboard` and `apps/website` already use, and it loads on demand when files there are read.

**Slim the root `AGENTS.md`** from about 3.6k to about 2k tokens, since subagents pay for it on every dispatch:
- Keep: what this is, layout, invariants (the single list; `docs/AGENTS.md` links to it), and routing.
- Move tooling detail (`:142-198`) to `docs/07-quality/tooling.md`, with the "why" in ADR-0007.
- Move §0c/§0d (shadcn/Metronic) to the new `packages/ui/AGENTS.md`.
- Move the uv pin (`:224-237`) to `apps/api/AGENTS.md`.
- Put clone setup in `README.md` (PR 3 automates it).

**Switch off LinkedUnion context in this repo only**, via project `.claude/settings.json`:
- `skillOverrides` sets `g-flow`, `g-python-skill`, `g-typescript-skill`, `g-django-testing-skill`, `g-nextjs-testing-skill` and `g-dashboard-testing-skill` to `off`. Confirm the key name against the installed Claude Code settings schema first.
- `permissions.deny` adds `Agent(lu-planner)`, `Agent(lu-quality-reviewer)`, `Agent(lu-security-reviewer)`, `Agent(lu-implementer)` and `Agent(lu-qa)`.
- Add a precedence line in `AGENTS.md`: *"In this repo, this file, `docs/decisions/` and `.claude/` override the org sourcebook injected at session start. `g-flow` tiers and `lu-*` agents don't apply; use the working method below."*
- Your user-level files stay untouched.

### PR 1c: Contradictions, stale references, skills and rules

**Resolve contradictions** so each rule is stated once, with the others linking to it:
- Tests go in `__tests__/` (ADR-0012). Fix `schoolhub-testing/SKILL.md:75-77` and `repo-structure.md:66`.
- Merge commits (ADR-0006). Fix `project-status.md:77`.
- Remove the agent-run `gh pr merge` from `AGENTS.md:132`.
- Say that automatic hooks are gates and the agent never runs suites by hand.
- Coverage is 85 (`ENGINEERING_STANDARDS.md:77`).
- Backend layout follows ADR-0010. Remove the "N exceptions" text in `apps/api/AGENTS.md:27-32` and `ENGINEERING_STANDARDS.md` §6.
- `DESIGN.md` chrome section: the recessed chrome was retired in `fb717a8`.
- The live-login line in `schoolhub-testing` vs `e2e/AGENTS.md:61-63`.
- Reword the false claim that the cross-tenant harness auto-enrols routes (`ENGINEERING_STANDARDS.md:74`).

**Remove stale content:**
- Delete `docs/context/agents-template-*.md`.
- Drop the `/run-skill-generator` reference.
- Fix the `DOCS/docs/...` paths in the dashboard and website AGENTS files.
- Correct the `schoolhub-testing` paths.
- Delete `apps/dashboard/AGENTS.md:71-86` (the branch-lineage note).
- Correct the `can.tsx`/`tenant-theme.tsx` rows to `lib/permissions.ts` → `canAccessModule`.
- Mark `core/ai` as planned.
- Document the `core/*` areas: files, money, idempotency, jobs, exports, documents, notifications, common.
- List all 6 workflows.
- Document the dashboard `../` ban.
- Fix the stale comment in `apps/dashboard/src/app/(app)/dashboard/page.tsx:3`.

**Path-scoped rules in `.claude/rules/`**, for file patterns nested CLAUDE.md can't target:
- `api-contract.md` (`paths: apps/api/**/serializers*.py, apps/api/**/views*.py, apps/api/**/viewset*.py, apps/api/**/urls*.py`): regenerate with `apps/api/scripts/generate-openapi.sh` + `pnpm --filter @schoolhub/api-client generate`, in the same commit.
- `migrations.md` (`paths: apps/api/**/migrations/*.py`): `rls_operations` for new tenant tables, reversible, expand→migrate→contract. Migrations ship in the module PR.

**Two new skills**, each backed by repeated history:
- `.claude/skills/schoolhub-backend-module/SKILL.md`: new module or resource, or splitting a flat app per ADR-0010 (about 30 refactor commits). Covers:
  - `TenantOwnedModel` + RLS migration
  - doc §4 → `permissions.py`
  - `MODULE_APPS` + `config/api_v1.py`
  - `services/<action>.py`
  - OpenAPI regeneration
  - `test_cross_tenant.py`
  - the doc §20 update
- `.claude/skills/schoolhub-ui-port/SKILL.md`: porting Metronic or shadcn into `packages/ui` (about 20 commits). Covers:
  - logical `start`/`end`
  - required label props
  - server-driven data and URL-backed filters
  - the header departure log (with `data-grid.tsx` as the worked example)
  - the licence rule

**`docs/context/context-map.md`:**
- Add rows for "Why is it like this?" → `docs/decisions/README.md`, "`packages/ui` / design" → `packages/ui/AGENTS.md` + `DESIGN.md`, and "Deferred work" → `docs/deferred-work.md`.
- Link `docs/superpowers/`.

## Phase 2: Cross-agent verification (PR 2)

### Agents (`.claude/agents/`, committed, schoolhub-specific)

**`plan-reviewer.md`**
- Frontmatter:
  - `tools: Read, Grep, Glob, Bash, WebSearch, WebFetch, mcp__context7__resolve-library-id, mcp__context7__query-docs`
  - `disallowedTools: Write, Edit, NotebookEdit`
  - `model: opus`
  - `skills: [schoolhub-testing]`
- It never runs tests, lint or typechecks.
- **Checks, in order:**
  1. **Goal fidelity.** Restate the goal in one line. Every step must trace to it; flag scope creep as **divergence**.
  2. **Root cause.** A fix needs *proven* cause (file:line, log or CI evidence). If `git log --since=14.days -- <files>` shows earlier fixes for the *same symptom*, demand the evidence explaining why this attempt differs. Without it the verdict is RETHINK.
  3. **Symptom suppressors.** These need an ADR or your OK:
     - timeout or retry bumps
     - coverage excludes
     - `noqa`, `eslint-disable`, `@ts-expect-error`
     - skipped or deleted tests
     - new `data-testid` where a role or label selector works
     - `all_tenants` managers
     - broad `except`
  4. **Reuse.** Grep for existing utilities and name them.
  5. **Conventions.** Check against `docs/decisions/`, the AGENTS chain and the `repo-structure.md` placement table.
  6. **Invariants.** RLS, 404-not-403, a registered permission key per endpoint, append-only money, AI drafts with humans publishing, contract regenerated in the same commit.
  7. **No hardcoding** (ADR-0014).
  8. **Tests.** Right lane, and would the test fail if the code broke?
  9. **Docs.** Module doc, status and ADR updated in the same PR.
  10. **Industry standard.** For each significant choice, name the established pattern and its source (Context7 for library APIs, the vendor docs otherwise). If the plan differs, give a concrete alternative.
  11. **Decision record.** A Tier 2 plan must contain "Alternatives considered (why not)". If it chooses between real alternatives, it must list the ADR it will add.
- **Output:**
  - `Verdict: APPROVE | REVISE | RETHINK`
  - the goal line
  - findings (severity · finding · evidence · fix)
  - divergence
  - what was checked
  - a ready-to-paste `## Independent review` block

**`change-reviewer.md`**
- Frontmatter: same tool limits and model; `skills: [schoolhub-testing, schoolhub-api-services]`.
- **Input:** the diff (`git diff main...HEAD`) **plus the approved plan path**.
- **Checks:**
  - correctness
  - tests-would-fail
  - N+1 queries
  - ADR and convention conformance
  - ADR-0014
  - docs updated
  - baseline and suppression files only shrink
- **A required *Divergence* section** lists every file and behaviour in the diff that isn't in the plan.
- **A mandatory security section** applies when the diff touches `core/tenancy`, `core/rbac`, auth, `fees_finance`/`core/money`, `core/files`, exports, AI or PII. It uses schoolhub's rules (RLS, tenant-scoped default manager, `deleted_at`, 404), not LinkedUnion's.

### The gate (PreToolUse on `ExitPlanMode`)

**`.claude/settings.json`** gets a second `PreToolUse` entry, `matcher: "ExitPlanMode"`, `type: command`, with command `python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/plan_review_gate.py"`. It is deterministic; the `agent` hook type is experimental. Plans stay in `~/.claude/plans` (no `plansDirectory` change).

**`.claude/hooks/plan_review_gate.py`:**
- **Step 1:** a temporary logging hook captures the real payload. The expected fields are `tool_input.plan` and `tool_input.planFilePath`. Remove the logger before committing.
- **Plan text:** read `tool_input.plan`, then the file at `planFilePath`.
- **Allow if the plan contains any of:**
  - `**Tier:** 0` or `**Tier:** 1`
  - `**Review:** waived by user`
  - an `## Independent review` section with a `Verdict:` line
- **Otherwise deny** via `permissionDecision: "deny"`, with the reason: "Tier 2 plan without independent review: dispatch the plan-reviewer agent on this plan, fold in its findings, append its `## Independent review` block, then call ExitPlanMode again."
- **Fail open everywhere.** `main()` is wrapped in `try/except` that exits 0 with a stderr warning, covering a missing file, bad JSON, or an unknown shape.

**Tests:** `.claude/hooks/tests/test_plan_review_gate.py` (stdlib `unittest`). It runs the **exact command string** via `subprocess` with `CLAUDE_PROJECT_DIR` set, and with cwd set to a subdirectory. Cases:
- Tier 0/1 → allow
- waived → allow
- reviewed → allow
- Tier 2 unreviewed → deny JSON
- no Tier line → deny
- malformed JSON → allow
- `planFilePath`-only → read from file

New `repo-hygiene.yml` job: `python3 -m unittest discover .claude/hooks/tests`.

**The superpowers path** (brainstorming spec → writing-plans doesn't go through ExitPlanMode):
- `.claude/skills/schoolhub-review-plan/SKILL.md` provides `/review-plan <path>` (`context: fork`, `agent: plan-reviewer`, `argument-hint: <plan-or-spec path>`).
- A `repo-hygiene.yml` step requires `## Independent review` + `Verdict:` in `docs/superpowers/{specs,plans}/` files **whose filename date is ≥ 2026-09-26**. Older files are grandfathered; ticking checkboxes later doesn't touch the block.

### Working method (a new short section in root `AGENTS.md`, always loaded)

| Tier | When | Flow |
|---|---|---|
| 0 | Question, lookup, typo, one-line change | Just do it |
| 1 | Bounded change, cause proven, a few files | Short in-chat design → approval → implement → `change-reviewer` → PR |
| 2 | Multi-file work, new endpoint/screen/migration, unproven bug, anything touching an invariant | Plan with `**Tier:** 2` → **`plan-reviewer` (gated)** → your approval → implement → `change-reviewer` (with plan) → PR → CI |

Every plan states `**Tier:** n` near the top.

**Stop rules (anti-hotfix, anti-drift):**
1. After a second failed fix for the same symptom, stop. Use `superpowers:systematic-debugging`, re-plan, and re-review.
2. Symptom suppressors need an ADR or your OK.
3. `fix` commits carry `Root cause:` (PR 3).
4. If implementation must deviate from the approved plan, stop, amend the plan, and re-review. Don't improvise.
5. Diagnose on a throwaway **draft PR** that is closed without merging, so `diag:` commits never reach `main`. The fix PR carries only the root-caused fix.

**`.github/pull_request_template.md`**, with these sections:
- Goal
- Tier
- Root cause (fixes)
- Approach + alternatives (ADR or spec link)
- Tests (lane)
- Docs updated
- Checklist: invariants · ADR-0014 · contract regenerated · ADR added if a real choice was made · change-reviewer run

## Phase 3: Mechanical enforcement (PRs 3–5, ratchet)

### PR 3: Turn the gates on, plus commit hygiene

**Auto-install the hooks.** Add a root `package.json` script, `"prepare": "git rev-parse --git-dir >/dev/null 2>&1 && git config core.hooksPath .githooks && git config blame.ignoreRevsFile .git-blame-ignore-revs || true"`.
- It's a no-op in the dashboard and website Docker builds, which copy only manifests and no `.git` (`apps/dashboard/Dockerfile:20-26`).
- In CI it sets local config harmlessly.

**New `.githooks/commit-msg`:**
- It calls a shared `.githooks/lib/check-commit-msg.sh`.
- Rejects `Co-Authored-By:` and "Generated with" lines.
- Subject must match `^(feat|fix|refactor|test|docs|style|chore|ci|perf|build|revert|diag)(\(.+\))?!?: ` or start with `Merge ` or `Revert "`.
- `fix` commits need a `Root cause:` body line.

**CI mirror:** a new `repo-hygiene.yml` job runs the same script over `git log --no-merges base..head`.

**Other changes:**
- **gitleaks** goes in `.githooks/pre-commit` (staged files; warn-and-skip if not installed).
- **`.github/rulesets/main.json`:**
  - remove `required_linear_history`
  - add `merge` to the allowed methods (ADR-0006)
  - require only the always-running `repo-hygiene` jobs, since path-filtered workflows would leave PRs stuck
  - it stays inactive until Pro or an org; README note
- **The 41 historical trailers stay.** Rewriting `main` is destructive, so this is forward-only.

### PR 4: Frontend lint ratchet

Load `turborepo`/`next-best-practices` first, and use Context7 for ESLint 9.39 suppressions and eslint-config-next 16.3 docs.

**Order inside the PR:**
1. Move the 7 flat dashboard tests into `__tests__/` (`src/proxy.test.ts`, `components/providers.test.tsx`, `components/layout-controls.test.tsx`, `hooks/use-copy-to-clipboard.test.ts`, `lib/{env,host,query-client}.test.ts`).
2. Code fixes.
3. Rules.
4. Raise every kept `warn` rule to `error` (e.g. `@next/next/no-img-element`: about 18 `<img>`). Only error-level rules can be suppressed.
5. Generate `eslint-suppressions.json` per workspace via `generate-baselines.yml`.
6. Add `--max-warnings 0` to every `lint` script.

**Code fixes in this PR:**
- **Dashboard services facade.** Re-export `ApiError` from `src/services/index.ts` and repoint its 5 non-test importers (`lib/query-client.ts:1`, `features/auth/login-form.tsx:5`, `staff/staff-form-dialog.tsx:5`, `staff/exit-staff-dialog.tsx:5`, `staff/staff-directory-table.tsx:19`).
- **Website env:** add `src/lib/env.client.ts` (zod, `NEXT_PUBLIC_*` only: platform domain, API origin). `proxy.ts:17` and `app/api/revalidate/route.ts:30` use server `env.ts`. Add `NEXT_PUBLIC_API_ORIGIN` to the `turbo.json` env list.
- **Website public forms:** a new `src/lib/public-api.ts` holds an `ENDPOINTS` registry (`contactMessages`, `admissionEnquiries`) and a browser-side POST helper using `env.client.ts`. `public-enquiry-form.tsx:21-22,51` uses it. **`src/lib/api.ts` stays untouched.** It is server-only and read-only by design (`api.ts:5-12`).
- **`packages/ui/src/lib/to-absolute-url.ts`:** drop the `process.env.NEXT_PUBLIC_BASE_PATH` read. A package must not read app env, and the variable is set nowhere, so the function is already a path passthrough. Keep the signature for its ~27 call sites (mostly Metronic demo code, removed in the backlog) and add a comment that Next's `basePath` config is the supported mechanism.

**Rules:**
- **`no-restricted-imports`**, merged into the **existing** `../**` entry in every file-scoped block, since flat config replaces a rule's options wholesale:
  - `@schoolhub/api-client` is banned in dashboard `src/**` except `src/services/**`, `src/lib/auth.ts` and test files (the existing test override stays)
  - extend the `../**` ban to the website and `packages/*`. Relative imports are the only way apps and packages could reach each other.
- **`no-restricted-syntax`** (one merged entry per config, non-test `src/**` only):
  - `process.env` outside the env modules, `next.config.*`, `jest.setup.*`, `e2e/playwright.config.ts`, `e2e/src/load-env.ts` and `e2e/scripts/**`
  - inline `queryKey: [...]` arrays in dashboard, because the `queryKeys` factory in `src/lib/query-client.ts:58` exists and is unused (21 sites)
  - physical-direction Tailwind classes in className literals, via a narrowed regex: `\b(ml|mr|pl|pr|border-l|border-r|rounded-l|rounded-r)-`, `\btext-(left|right)\b`, and `\b(left|right)-` except `-[50%]`/`-1/2` centring. About 12 today; the `rtl:`-paired ones go in the baseline.
- `react/jsx-no-literals` for the **dashboard only** (ADR-0014), with a punctuation allowlist.
- `max-lines: 400` (skip blanks and comments), excluding tests and `packages/api-client/src/schema.d.ts`.
- `jsx-a11y` rules raised to `error` in the apps.
- `eslint-plugin-playwright` recommended for `e2e/`, plus a ban on `@playwright/test` in `e2e/tests/**` (specs use `@/fixtures`).

**Ratchet enforcement:**
- CI runs plain `eslint`. It fails on unused suppressions by default; never pass `--pass-on-unpruned-suppressions`.
- A new hygiene script, `scripts/check-baselines-shrink.mjs`, diffs every `eslint-suppressions.json` against the base branch. It fails on any new file key or any higher count. It is rename-aware (`git diff -M`) so moved files carry their entries.
- The same script later covers PR 5's baselines.

**Test placement:** a `repo-hygiene.yml` step fails on any `*.test.ts(x)` outside `__tests__/` in `apps/*/src` and `packages/*/src`.

**TS:** add `noImplicitReturns` to `tsconfig.base.json`. Any hits (from CI) get fixed in this PR, since tsc has no baseline.

### PR 5: Backend lint ratchet

**`apps/api/pyproject.toml`:**
- **Ruff:**
  - add `RUF100`; the 21 dead `noqa`s are removed via a `generate-baselines.yml` patch
  - add `BLE`
  - add `TID251` banned-api for `os.environ`/`os.getenv`, with per-file-ignores for `config/settings/*`, `manage.py`, `config/{wsgi,asgi,celery}.py`, and `core/rbac/management/commands/seed_e2e_data.py` until the backlog move
  - no `ANN` rules; type-hint enforcement is mypy's job (below)
- **import-linter:** `uv add --dev import-linter`, which updates `uv.lock`. Confirm the syntax via Context7. It enforces ADR-0013:
  - contract 1 (`forbidden`): `core` ↛ `apps`, with `ignore_imports` for the two seed commands
  - contract 2 (`forbidden`, `allow_indirect_imports = true`): no app imports another app's `apps.**.views`, `apps.**.viewset`, `apps.**.urls`, `apps.**.reports`, `apps.**.tasks`. Baseline: `academics → school_organization.views` and `examinations → attendance.reports`.
  - runs as a step in the `api.yml` lint job
  - its `ignore_imports` are covered by the shrink script
- **mypy:** `[[tool.mypy.overrides]]` sets `disallow_untyped_defs = true` for `core.*` (the per-package ratchet). If CI shows violations, fix them in this PR or narrow to the clean `core` subpackages.
- **Coverage:** read per-package numbers from a `generate-baselines.yml` run. Enforce 90% for `apps/fees_finance`, `core/tenancy` and auth where they already meet it; otherwise set the floor at the current value and record the ratchet in ADR-0007.

**Tests:**
- **Permission-key coverage.** Extend `apps/api/tests/test_endpoint_contracts.py` to AST-scan every `has_permission_key(…, "<literal>")` call in `apps/` and `core/` (views, viewsets **and serializers**, e.g. `student_management/serializers.py:147`, `student_management/views.py:216,262,305`) and assert each key is registered.
- **Env drift.** A test compares `env(...)` keys in `config/settings/*` against `apps/api/.env.example`. There are 10 missing and 5 dead keys today. **Ask before editing `.env.example`.**

### Follow-up backlog (separate plans, listed in `docs/project-status.md` "Start here")

**Dashboard:**
- Move `/staff` from `src/app/(app)/staff/` into `src/features/staff/` with a thin `page.tsx`.
- Move its 14 calls from `Services.dashboard` (`dashboard-service.ts`, 419 lines) to `services/modules/staff/`.
- Put its strings into `messages/{en,ur}.json`.
- Split `staff-form-dialog.tsx` (965) and `staff-directory-table.tsx` (722).

**Shell:**
- Strip the Metronic demo leftovers from `src/app/(app)/shell/`: `chat-sheet`, `notifications-sheet`, `apps-dropdown-menu`, `search/`, the keenthemes links, and about 93 demo `menu-config.ts` entries. That also drops most `toAbsoluteUrl` call sites.
- Translate the real chrome.

**Backend, flat apps to ADR-0010:**
- `fees_finance`, `examinations` and `attendance` (1.6–1.9k-line services).
- Finish `student_management`. Its root `views.py` redefines viewsets its packages already have.

**Rule-of-three extractions:**
- `_fk` (6 apps) → `core/api/serializers`
- `TenantOwnedAdmin` (4) → `core/tenancy/admin`
- the staff/student import and document pipelines → `core/imports` + `core/documents`
- report helpers (3) and numbering patterns (3) → shared modules
- `batch_size=500` (15) → a named constant
- `fees_finance/ledger.py:306` → `core.tenancy.context.require_current_tenant_id`
- seed commands → a top-level seeding package (clears contract 1's baseline)

**Other:**
- A generic cross-tenant contract harness, reusing `_api_views()` from `test_endpoint_contracts.py`.
- Move tenant-host parsing (duplicated in both apps' `lib/host.ts`) to a shared package.
- Consolidate the `packages/ui` pairs `dropdown-menu`/`-4`, `skeleton`/`skeletons`, `data-grid`/`data-table`.
- Burn down every baseline module by module.

## Reused, not rebuilt

- `.githooks/lib/common.sh`: tool discovery and warn-and-skip.
- `.githooks/pre-commit` and `pre-push`: extended, not replaced.
- `packages/config/eslint.no-relative-parent-imports.mjs`: the `../**` pattern that new patterns merge into.
- `apps/api/tests/test_endpoint_contracts.py`: `_api_views()` and URLconf walking.
- The zod env modules: `apps/dashboard/src/lib/env.ts`, `apps/website/src/lib/env.ts`, `e2e/src/env.ts`.
- `apps/dashboard/src/i18n/messages.types-check.ts`: en/ur key parity, already enforced.
- `repo-hygiene.yml`: no path filter, so every repo-wide check goes there.
- The `.claude/skills/schoolhub-*` format: the model for the three new skills.

## Verification (CI is the authority)

- **PR 1a/1b/1c:**
  - `repo-hygiene` is green (link check catches every moved path; cspell; Prettier; doc-sync accepts the split).
  - Fresh root session: "what are this repo's invariants?" is answered from memory without reading files, which proves the `@AGENTS.md` import.
  - Opening a file in `apps/api/` brings in the backend rules.
  - `g-flow` and `g-python-skill` no longer appear in the skill list in schoolhub, and still appear in another repo.
  - The two new skills are listed.
- **PR 2:**
  - The CI unittest job is green.
  - Manual: a Tier 2 plan in plan mode → ExitPlanMode is denied with the instruction → dispatch `plan-reviewer` → append the block → allowed.
  - A `**Tier:** 1` plan → allowed. Starting the session from `apps/api/` behaves the same.
  - `/review-plan` is listed.
  - A new spec dated ≥ 2026-09-26 without a review block fails hygiene.
- **PR 3:**
  - After `pnpm install`, `git config core.hooksPath` prints `.githooks`.
  - A throwaway commit with a `Co-Authored-By` line, or a `fix:` with no `Root cause:`, is rejected locally and by the CI job.
  - A `style(...)` commit and a `Merge branch 'main'` commit pass.
- **PR 4/5:**
  - CI is green with baselines in place.
  - On a scratch branch (deleted afterwards), CI fails for:
    - a JSX literal
    - `process.env` in a component
    - `ml-2`
    - an `@schoolhub/api-client` import in a feature file
    - a `../` import
    - `core` importing an app
    - `os.environ` in a service
    - an unregistered inline permission key
    - an added suppression entry
- **Every PR:** `change-reviewer` runs with the plan before the PR opens, and `gh pr checks <n> --watch` ends green.

## Review Focus

1. **The gate wrongly blocks.** It must fail open on any error and resolve its path from any cwd. The subprocess tests pin this.
2. **Flat-config override.** The `../**` ban must survive every new `no-restricted-imports` block. The scratch-branch `../` import pins this.
3. **Baselines grow silently.** The shrink script checks rename-aware counts; plain `eslint` fails on stale entries.
4. **Slimming drops a rule.** Every moved paragraph lands at a linked destination. The link check plus the change-reviewer's divergence section cover it.
5. **The commit hook rejects legitimate commits.** `style`, merges and reverts are allowed. The PR 3 verification covers each.

## Independent review

- **Reviewer:** Plan agent, read-only, adversarial, 2026-09-26.
- **Verdict:** REVISE, with 2 Critical, 8 High, 12 Medium and 9 Low findings. All are addressed above.
- **Critical fixes:**
  - The website public-form POST no longer goes through the server-only machine-token `api.ts`; it has a separate `public-api.ts`.
  - Baseline generation moved to a CI `workflow_dispatch` job so the no-local-runs rule holds.
- **High fixes:**
  - no fake `--prune-suppressions` check mode; plain eslint plus a shrink script instead
  - warnings raised to error before suppressing
  - client and server env split
  - hook path via `$CLAUDE_PROJECT_DIR`, fail-open
  - no `plansDirectory` change
  - LinkedUnion skills and agents switched off for this repo
  - the change-reviewer checks divergence from the plan
- **Medium and Low fixes:**
  - tier markers unified
  - Context7 and web tools added to the reviewer
  - RETHINK recalibrated to the same symptom within 14 days
  - ruleset linear history removed
  - `style`, merge and revert commits allowed
  - import-linter indirect imports allowed, with `**` patterns
  - ADR-0014 added
  - cross-tenant claim reworded
  - Docker check corrected
  - PR 1 split three ways
- **Unresolved:** none. Two items get confirmed at execution: the `skillOverrides` key name and the exact ExitPlanMode payload.
