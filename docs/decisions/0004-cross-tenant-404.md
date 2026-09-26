# 0004. Cross-tenant access returns 404, never 403

- **Status:** Accepted
- **Date:** 2026-09-26 (recording a decision already in effect)
- **Enforced by:** hand-written `apps/<module>/tests/test_cross_tenant.py` in all nine built apps. No harness enrols new routes automatically — a new endpoint without a cross-tenant test fails nothing today (a generic harness is on the backlog).

## Context

When a user asks for a record that belongs to another tenant, the response itself can leak
information. [`multi-tenancy.md`](../02-architecture/multi-tenancy.md) §3 and
[`api-architecture.md`](../02-architecture/api-architecture.md) §2.3 set the rule; the root
`AGENTS.md` states the reason: "a 403 confirms the record exists."

## Decision

Any request for an object outside the caller's tenant, or outside their record scope within
a tenant, returns `404 Not Found`. This includes object IDs nested in request payloads, which
are re-validated against the request tenant. RLS usually produces this naturally: the row is
invisible, so the lookup finds nothing.

## Alternatives considered

- **403 Forbidden** — why not: it tells an attacker that a guessed UUID is real and belongs
  to someone else, which is an enumeration oracle across tenants.
- **403 within a tenant, 404 across tenants** — why not: two behaviours to test and reason
  about, and the within-tenant scope (`RecordScope.OWN`) has the same existence-leak
  problem.

## Consequences

Every module ships `tests/test_cross_tenant.py` asserting 404 through each endpoint class.
Client code must not treat 404 as "deleted" without context. Error copy for 404 must not say
"you don't have access".
