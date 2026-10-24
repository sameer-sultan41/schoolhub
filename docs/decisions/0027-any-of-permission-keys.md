# 0027. A route two kinds of caller share declares `AnyOf(...)`, not the view key

- **Status:** Accepted
- **Date:** 2026-10-24
- **Enforced by:** `apps/api/core/rbac/tests/test_permissions.py` (the class and `AnyOf`), `apps/api/tests/test_endpoint_contracts.py` (every member is a registered key, none is a read key); that a shared route uses `AnyOf` rather than hiding its check in the body is review only (`schoolhub-backend-module` skill, step 4)

## Context

Invariant 3: every endpoint declares its real permission key, and `HasPermissionKey` enforces it.
`POST /teacher-substitutions/{id}:cancel` has two legitimate callers, an approver
(`timetable.substitution.approve`, any open cover) and a proposer
(`timetable.substitution.create`, their own proposal). `required_permission_map` took one key per
action, so `cancel` was mapped to the view key every role holds and its body checked the two real
keys by hand. The declared key was not the enforced one: the contract tests could not see the
real rule, and a copy-paste of the action would have opened it to everyone with the view key
(code review of #123).

## Decision

A `required_permission_map` value, or `required_permission`, is a key or `AnyOf("a.b.c", "a.b.d")`
(`core/rbac/permissions.py`): the user needs one of the keys. `declared_keys()` normalises both
forms for the class and the contract tests. A route using it keeps only its row-level rule in
the body.

- An action present in the map is decided by its entry, whatever it holds. An empty string
  refuses everyone; it no longer falls back to the resource's read key.
- `AnyOf` needs at least one non-empty key, and `declared_keys` rejects anything else (a tuple, a
  list, `None`) with `ImproperlyConfigured`.
- The contract tests require every member to be registered and none to be a `.view` key.

## Alternatives considered

- **A bare tuple** — why not: Django's own `permission_required` reads an iterable as *all of*,
  so a reader or a stray trailing comma would take `("a", "b")` for the opposite of what it does,
  and silently widen access.
- **Keep the view-key mapping and the in-body check** — why not: that is the gap; the declaration
  stays untrue and nothing but review can see what the body enforces.
- **A separate `required_any_permission` attribute** — why not: two places to declare one thing.
- **Per-action `permission_classes`, or DRF's `|` composition** — why not: a second mechanism
  beside the one every other route uses, and the contract tests read `required_permission_map`,
  so a composed class would be invisible to them.
- **Map `cancel` to `substitution.create` alone, or give approvers `create`** — why not: refuses
  an approver who can't also propose, or changes who may propose, which is a product decision.

## Consequences

- The write-fallback contract test skips any action that is explicitly mapped, so a *write*
  mapped to a plain `.view` string still passes it. Some read-only POSTs legitimately do that
  (`preview`, `validate`, `download`); closing the gap needs an allowlist of them
  (`docs/deferred-work.md`).
- The permission is not published in the OpenAPI schema, so the generated contract is unchanged.
