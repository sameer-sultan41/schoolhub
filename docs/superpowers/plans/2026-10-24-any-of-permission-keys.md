# Any-of permission keys for a route

**Work tier:** 2 (shared RBAC code; touches an invariant)

## Context

Invariant 3: every endpoint declares its real `module.resource.action` key, and the permission
class enforces it. `POST /teacher-substitutions/{id}:cancel` has two legitimate callers: an
approver (`timetable.substitution.approve`, any open cover) and a proposer
(`timetable.substitution.create`, only their own proposal). `required_permission_map` takes one
key per action, so `cancel` is mapped to the view key every role holds, and the action body then
checks the two real keys by hand. The declared key is not the enforced one, so a copy-paste of
that action silently opens up to everyone with the view key (code review of #123).

The dashboard already gates sidebar items and tabs on "any of several keys"
(`hasAnyPermission`); the API has no equivalent.

## Approach

- **`core/rbac/permissions.py`:** a `required_permission_map` value (and `required_permission`)
  is a string or an `AnyOf(...)` marker, meaning *any one of*. A bare tuple is rejected (Django reads one as all-of).
  - `_required_key` returns `str | tuple[str, ...] | None`.
  - `has_permission` allows the request when the user holds any key of the tuple. An empty tuple
    fails closed, like a missing key.
  - A new helper `declared_keys(value) -> tuple[str, ...]` normalises either form, shared with
    the contract tests so the two can't read the declaration differently.
- **`apps/timetable/substitutions/viewset.py` (on #123, which holds `:cancel`; not in this PR):**
  `"cancel": ("timetable.substitution.approve",
  "timetable.substitution.create")`. A caller with neither is refused (403) before the body runs.
  The body keeps only the *row-level* rule: an approver cancels any open cover, a proposer only
  their own proposal. The comment explaining the old workaround goes.
- **`tests/test_endpoint_contracts.py`:** the registry-membership test and the write-fallback
  test read declarations through `declared_keys`, so a tuple's every member must be registered,
  and a write route mapped to a tuple still counts as mapped. A new test: no tuple member is a
  `.view` key (a write is never authorised by a read key, now for any-of too).
- **OpenAPI:** the permission isn't published in the schema today (`HasPermissionKey` has no
  schema hook), so the generated contract doesn't change. Verified by CI's schema-is-current job.
- **Docs:** `docs/02-architecture/auth-and-rbac.md` (how views declare keys) gains one line on the
  tuple form; `schoolhub-backend-module` skill step 4 is checked for a mention.

## Tests

- `core/rbac/tests`: a view declaring a tuple allows a user holding either key, refuses a user
  holding neither, refuses an anonymous user, and fails closed for an empty tuple; a string
  declaration behaves as before.
- Substitutions (PR 2): a user holding only `timetable.timetable.view` gets 403 on `:cancel` (today the
  body's own check refuses them; now the class does, same status). The existing approver and
  proposer cancel tests pass unchanged.

## Alternatives considered (why not)

- **Keep the view-key mapping and the in-body check.** Rejected: that is the gap. The declared
  key stays untrue, and the contract tests can't see what the body enforces.
- **A separate `required_any_permission` attribute.** Rejected: two places to declare one thing;
  the map already is the per-action declaration.
- **Map `cancel` to `substitution.create` alone, or add `create` to the approver role.**
  Rejected: refuses an approver who can't also propose, or changes who may propose, which is a
  product decision, not a fix.
- **Per-action `permission_classes`.** Rejected: a second mechanism beside the one every other
  route uses.

## Verification

CI only: `api` (tests, mypy, ruff, the contract tests, schema-is-current) and `repo-hygiene`.
No local runs.
- **PR 1,** `refactor/any-of-permission-keys` off `main`: the class, `declared_keys`, the contract
  tests and unit tests, the auth-and-rbac line, and the deferred-work note. It declares no
  tuple itself, so it changes no route.
- **PR 2, on #123:** once PR 1 is on `main`, merge `main` into `feat/timetable-cover` and switch
  `cancel` to the tuple, trimming the body, with the substitutions test. If PR 1 isn't merged
  yet, #123 merges PR 1's branch (the stacking used so far).

## Docs and records

- `docs/deferred-work.md` in PR 2 (#123), not here: #123 review's non-blocking cleanup (redundant
  `_staff_away_on` calls, three near-identical notification helpers, duplicated table markup,
  `today` going stale past midnight in the substitutions table, repeated placeholder ternaries).

## Independent review

- **Reviewer:** plan-reviewer agent, 2026-10-24
- **Verdict:** REVISE — right approach and proven cause, but the `or` fallback in `_required_key` makes an empty tuple fall back to the view key instead of failing closed, the PR 2 test can't fail if the change is undone, and the choice needs an ADR.
- **Findings addressed:**
  - **Empty entry falling back:** `_required_key` now returns `mapping[action]` whenever the action is in the map. `AnyOf()` can't be empty, and an empty string refuses everyone. Both are tested on a view that also declares a view key.
  - **A bare tuple means all-of in Django:** replaced by an explicit `AnyOf(...)`; `declared_keys` rejects tuples, lists and `None`.
  - **PR 2's test:** also asserts the class refuses before the body, using a viewer-only POST to an unknown id (403, where the body check alone gave 404), and the declaration itself.
  - **Write-fallback gap:** a named allowlist is a follow-up; recorded in `deferred-work.md` and ADR-0027, with `AnyOf` members checked now.
  - **ADR:** 0027, with the DRF composition alternative and the deciding reason.
  - **Docs:** the two claims that the schema publishes the keys are corrected; the backend-module skill notes `AnyOf`.
  - **Body after trimming:** keeps one inline key check for the approver/proposer split and the 403 for someone else's proposal.
  - **Cleanup note:** moved to PR 2.
  - **Stacking:** #123's description will say it contains PR 1.
- **Unresolved:** none.
