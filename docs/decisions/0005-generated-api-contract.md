# 0005. The API contract is generated and committed, in the same commit as the change

- **Status:** Accepted
- **Date:** 2026-09-26 (recording a decision already in effect)
- **Enforced by:** the `openapi` job in `.github/workflows/api.yml` (regenerates `apps/api/openapi.yaml` and fails on any diff) and the "Lint · Typecheck" job in `.github/workflows/frontend.yml` (regenerates `packages/api-client/src/schema.d.ts` and fails if stale); `apps/api/tests/test_api_contract.py`

## Context

The dashboard consumes the Django API. Hand-written request and response types drift from
the server silently — the drift was the original reason for the monorepo
([0002](0002-single-monorepo.md)).

## Decision

drf-spectacular emits `apps/api/openapi.yaml` (`apps/api/scripts/generate-openapi.sh`, run
with `--validate --fail-on-warn`). openapi-typescript turns that into
`packages/api-client/src/schema.d.ts` (`pnpm --filter @schoolhub/api-client generate`). Both
files are committed and **change in the same commit as the serializer, view or URL change
that caused them**. Nobody hand-edits `schema.d.ts`; Prettier ignores it. Editing a
serializer, view, viewset or URL file loads
[`.claude/rules/api-contract.md`](../../.claude/rules/api-contract.md), which tells the agent
to regenerate both.

## Alternatives considered

- **Hand-written client types** — why not: they drift with no failing check.
- **Generate at build time, don't commit** — why not: a reviewer can't see the contract
  change in the diff, and a frontend build would need a running backend.
- **A shared runtime library between backend and frontend** — why not: it couples deploys
  and there is no shared language.

## Consequences

`openapi.yaml` and `schema.d.ts` are among the most-churned files in the repo, which is
expected. Changing a serializer means running two generators before committing. Breaking API changes need a new version path
per `api-architecture.md` §2.1.
