# 0001. Record architecture decisions as ADRs

- **Status:** Accepted
- **Date:** 2026-09-26
- **Enforced by:** review only — the PR template's "ADR added or superseded if a real choice was made" item, and the `plan-reviewer` (check 11) and `change-reviewer` agents

## Context

The reasoning behind this codebase was scattered across `AGENTS.md` prose, module docs'
§20 "Implementation notes", the "Deliberately NOT done" section of `project-status.md`,
one spec's decisions table, and roughly 300 source-file header comments. A `docs/adr/`
folder was referenced by `repo-structure.md` but never created. The result was repeated
re-litigation: a rule whose reason is not findable gets "simplified" away, and a later
session reintroduces the problem it prevented.

## Decision

Architectural decisions live in `docs/decisions/` as short, numbered records (a lightweight
variant of MADR). Each names the alternatives rejected and **what enforces it**. The
README's index is the entry point. Existing rationale in file headers and module §20s stays
where it is — records link to it rather than duplicating it.

## Alternatives considered

- **Keep rationale inline in AGENTS.md** — why not: AGENTS.md is loaded into every agent
  context window, so each paragraph of history costs tokens on every task, and it had
  already grown contradictory.
- **Rely on commit messages and PR descriptions** — why not: they are not discoverable by
  topic, and squash-or-merge history makes them hard to trace.
- **Full MADR with every optional section** — why not: heavier than a solo/small team
  will maintain; a record nobody writes enforces nothing.

## Consequences

Every reversal needs a new record, which is deliberate friction. The "Enforced by" line
makes unenforced rules visible — several records start as `review only (planned: …)` and
are updated as the enforcement ships.
