## Goal

<!-- One or two sentences: the problem this solves, for whom. Link the spec/plan if there is one. -->

**Work tier:** <!-- 0 · 1 · 2 — see AGENTS.md "Working Method" -->

## Root cause

<!-- Fixes only: what was actually wrong, with evidence (file:line, log, failing CI run). "Not a fix" otherwise. -->

## Approach and alternatives

<!-- What you did and what you rejected, with the reason. Link the ADR in docs/decisions/ if this picks between real alternatives. -->

## Tests

<!-- Which lane (backend · Jest · E2E mocked · E2E live) and why that lane can prove it. -->

## Docs

<!-- Module doc · docs/project-status.md · docs/deferred-work.md · ADR — what changed, or why nothing needed to. -->

## Checklist

- [ ] Invariants hold — RLS on new tenant tables, cross-tenant → 404, registered permission key on every endpoint (every write action mapped), append-only money, AI drafts / humans publish
- [ ] No hardcoded values (ADR-0014) — strings via messages, env via the typed env modules, named constants, tokens, RTL-logical classes
- [ ] API contract regenerated in the same commit, if serializers/views/URLs/filters changed (ADR-0005)
- [ ] ADR added or superseded if a real choice was made (ADR-0001)
- [ ] `change-reviewer` run against the plan; findings addressed
- [ ] No AI attribution in commits or this description
