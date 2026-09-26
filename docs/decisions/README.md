# Architecture Decision Records

> **Agent Context**
> **Summary:** Why SchoolHub is built the way it is. Each record captures one decision, the alternatives that were rejected and why, and — the part that matters most — what mechanically enforces it. Read the relevant record before proposing to change something it covers.
> **Co-load with:** [`../02-architecture/repo-structure.md`](../02-architecture/repo-structure.md) (where code goes) · the root [`../../AGENTS.md`](../../AGENTS.md) (invariants)

## The rule

**A change that picks between real alternatives, or reverses an earlier choice, adds or
supersedes a record in the same pull request.** A reviewer who has to ask "why this and
not the obvious other thing?" is looking at a missing record.

A record's decision is never edited to say something different. When a decision changes,
write a new record, set the old one's status to `Superseded by NNNN`, and link forward. Two
lines *are* kept current in place: **Status**, and **Enforced by** — updated when the
enforcement it names actually ships. Typos and broken links are fine to fix in place too.

## Writing one

Copy [`0000-template.md`](0000-template.md) to `NNNN-short-title.md` using the next free
number. Aim for 20–40 lines. Quote existing rationale with its source rather than
paraphrasing it from memory.

The **Enforced by** line is not optional. Name the exact tool, config file or test that
fails when the decision is violated. If nothing does, write `review only` — an honest
`review only` is how an unenforced rule becomes visible instead of silently drifting.

## Index

| # | Decision | Status | Enforced by |
| - | -------- | ------ | ----------- |
| [0001](0001-record-decisions.md) | Record architecture decisions as ADRs | Accepted | review only — PR template checklist, `plan-reviewer` / `change-reviewer` agents |
| [0002](0002-single-monorepo.md) | One monorepo, not four repositories | Accepted | review only |
| [0003](0003-tenant-isolation-rls.md) | Tenant isolation in PostgreSQL Row-Level Security | Accepted | `apps/api/tests/test_rls_coverage.py`, `test_rls_enforcement.py`, `infra-compose.yml` |
| [0004](0004-cross-tenant-404.md) | Cross-tenant access returns 404, never 403 | Accepted | per-app `tests/test_cross_tenant.py` |
| [0005](0005-generated-api-contract.md) | The API contract is generated and committed | Accepted | `api.yml` openapi job, `frontend.yml` staleness check |
| [0006](0006-merge-commits.md) | Pull requests land as merge commits | Accepted | review only (the corrected ruleset would enforce it; not applied) |
| [0007](0007-ci-source-of-truth.md) | CI is the source of truth; local hooks split by cost | Accepted | `.githooks/*` (auto-installed by `prepare`), CI workflows |
| [0008](0008-jest-not-vitest.md) | Jest + React Testing Library, not Vitest | Accepted | `apps/*/jest.config.ts` |
| [0009](0009-ported-ui-primitives.md) | UI primitives are ported vendor source, adapted for RTL and i18n | Accepted | TypeScript required props; ESLint physical-direction ban |
| [0010](0010-backend-module-layout.md) | Backend apps use one package per resource | Accepted | review only (`schoolhub-backend-module` skill) |
| [0011](0011-dashboard-services-layer.md) | Dashboard API calls go only through `src/services/` | Accepted | ESLint `no-restricted-imports` (UI layers) |
| [0012](0012-tests-in-dunder-tests.md) | Frontend tests live in sibling `__tests__/` folders | Accepted | `test-placement` CI job |
| [0013](0013-cross-app-dependencies.md) | Cross-app dependency rules for the backend | Accepted | `apps/api/tests/test_import_boundaries.py` |
| [0014](0014-no-hardcoded-values.md) | Every value has one owner — no hardcoding | Accepted | ESLint rules + shrink-only baselines (frontend); ruff `TID251`, `test_env_example.py`, `test_endpoint_contracts.py` (backend) |
| [0015](0015-independent-plan-review.md) | Non-trivial plans pass an independent reviewer before approval | Accepted | `.claude/hooks/plan_review_gate.py` (tested in `repo-hygiene.yml`), `plan-review-record` CI job |
| [0016](0016-commit-message-rules.md) | Commit messages: conventional subjects, no AI attribution, fixes name their root cause | Accepted | `.githooks/commit-msg`, `commit-messages` CI job |

"Planned" items land in the stacked PRs described in
[`../superpowers/specs/2026-09-26-engineering-standards-and-agent-workflow-design.md`](../superpowers/specs/2026-09-26-engineering-standards-and-agent-workflow-design.md);
each PR updates its row here when the enforcement actually exists.
