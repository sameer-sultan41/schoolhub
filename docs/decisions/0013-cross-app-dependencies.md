# 0013. Cross-app dependency rules for the backend

- **Status:** Accepted (replaces the "apps talk only via `services.py`" rule in the original `repo-structure.md`, which was never followed)
- **Date:** 2026-09-26
- **Enforced by:** review only (planned: import-linter `forbidden` contracts in `apps/api/pyproject.toml`, run in `api.yml`)

## Context

The original structure doc said `services.py` is "the only module-to-module surface" and
that `core/` "imports no app". An audit of `apps/api`'s **non-test** code on 2026-09-26 found:

- 128 cross-app imports, 111 of them targeting another app's `models`. These are mostly
  foreign keys, querysets and serializer `PrimaryKeyRelatedField`s.
- 13 cross-app imports that go through `services`.
- One import of another app's `views` (`academics → school_organization.views`) and one of
  another app's `reports` (`examinations → attendance.reports`).
- `core/` importing apps only from two seed management commands.

A rule that everyone breaks is not a rule, and enforcing it as written would ban legitimate
foreign keys.

## Decision

- An app **may** import another app's `models`, for foreign keys, querysets and serializer
  fields.
- **Writes and business rules** that belong to another app go through that app's `services`.
  Don't re-implement its invariants or mutate its rows directly.
- An app **never** imports another app's `views`, `viewset`, `urls`, `reports` or `tasks`.
  Anything shared there belongs in the owning app's `services`, or in `core/`.
- `core/` **never** imports `apps/`. Hooks from apps into core self-register from
  `AppConfig.ready()`, as `communication` does with `core/notifications`.

## Alternatives considered

- **Strict ports and adapters (services-only, no model imports)** — why not: overkill for a
  modular monolith this size, it bans ordinary Django foreign keys, and it would need a DTO
  layer nobody has asked for.
- **No rule** — why not: the view and report imports above are exactly the coupling that turns
  a refactor of one app into a break in another.

## Consequences

The seed commands (`core/rbac/management/commands/seed_e2e_data.py`, `seed_all_roles.py`) and
the two cross-app view/report imports are the known violations. They will be baselined when
import-linter lands and removed by moving the seeds into a dedicated package. Test code is out
of scope for these contracts: about a dozen `core/` test modules import apps' test factories,
which is legitimate, so the contracts must exclude `tests` packages.
