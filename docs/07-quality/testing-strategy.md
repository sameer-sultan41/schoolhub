# Testing Strategy

> **Agent Context**
> **Summary:** How SchoolHub is proven correct: test pyramid per repo, the **mandatory cross-tenant access suite**, RBAC permission-matrix tests, money-invariant tests, migration tests, load-test profiles (attendance spike, fee day, result publish), the pilot-school UAT protocol, per-PR CI gates, and the release regression checklist. Section numbers are referenced by `security.md` and `non-functional.md`.
> **Co-load with:** [`non-functional.md`](non-functional.md) · [`../06-security/security.md`](../06-security/security.md) · [`../01-phases/phase-plan.md`](../01-phases/phase-plan.md)

## 1. Principles

1. **Testing is continuous** — CI runs from the first week of Phase 2; Phase 5 is the gate, not the start ([`../01-phases/phase-plan.md`](../01-phases/phase-plan.md) §4).
2. **Module docs are the oracle** — acceptance tests derive from each module doc's features, validations, and workflows; reviewers check tests against the doc.
3. **Isolation and money are non-negotiable** — the cross-tenant suite (§3) and money invariants (§5) block merges; everything else trades off, these don't.
4. **Tests run against real infrastructure semantics** — the backend test database has **RLS enabled with the non-bypass app role**, so isolation tests exercise the real mechanism, not a mock.

## 2. Test Pyramid (per repo)

### Backend (Django/DRF)
| Layer | Scope | Tooling |
| ----- | ----- | ------- |
| Unit | Services, validators, calculators (grades, fees, payroll), workflow engine | pytest, factory-based fixtures |
| Integration | API endpoints end-to-end through serializers, permissions, RLS, and DB | pytest + DRF client against Postgres (never SQLite — RLS/JSONB parity) |
| API contract | Generated OpenAPI schema diffed per PR; breaking change on `v1` fails CI | drf-spectacular + schema diff |
| Job/worker | Celery tasks (imports, report generation, notification fan-out) executed eagerly + retry/failure paths | pytest |

### Frontend (Next.js monorepo: dashboard + website)
| Layer | Scope | Tooling |
| ----- | ----- | ------- |
| Component | UI components, forms + Zod validation, permission-based rendering | Jest + React Testing Library (via `next/jest`) |
| E2E | Critical user journeys per role (login, attendance marking, fee collection, marks entry → result publish, admissions submit, parent payment) | Not scaffolded. Browser-level coverage is a deliberate open decision — raise it explicitly rather than adding a second runner by default. |
| Accessibility | axe assertions on key screens (non-functional.md §5) | `jest-axe` in component tests; browser-level auditing deferred with E2E above |

Generated TypeScript API types (from OpenAPI) make many contract mismatches compile-time failures.

Component-layer coverage is gated at 85% global per app (§9.6) via each app's `jest.config.ts` `coverageThreshold`, enforced by CI's dedicated `test` job.

## 3. Cross-Tenant Access Suite (mandatory)

The test mandate from [`../02-architecture/multi-tenancy.md`](../02-architecture/multi-tenancy.md) §3.5 and security.md SEC-03:

- Fixtures create **two fully-populated tenants** (A and B) with parallel data.
- For **every endpoint class of every module**, authenticated as tenant-A users, the suite attempts against tenant-B resources: detail read, list leakage (B rows must never appear), create-with-foreign-reference (e.g. invoice for a B student), update, delete, file access, export, and search.
- Expected result: `404` for direct references (never `403` — no existence leaks), zero B rows in lists/exports/search.
- Implemented as a parameterized harness driven by the endpoint registry, so **a new endpoint is automatically enrolled**; opting an endpoint out requires an explicit, reviewed allowlist entry (platform-admin paths only).
- A module PR without cross-tenant coverage for its new endpoints fails review by definition (phase-plan.md §4.2).

## 4. RBAC Permission-Matrix Tests

- The seeded default role→permission matrix ([`../02-architecture/auth-and-rbac.md`](../02-architecture/auth-and-rbac.md) §5) is executable: for each (role, endpoint) pair the harness asserts allow/deny per the module doc's §4 table.
- Record-scope tests per scope type: `own` (student sees self only; guardian sees own children only), `assigned` (teacher limited to assigned sections), `campus:<id>`, `all`.
- Negative guarantees: student/guardian accounts can never reach staff endpoints even via crafted custom roles (users-and-roles.md §6.4); initiator-cannot-approve enforced on every workflow.
- A permission-key change (add/remove/rename) fails CI unless the seed matrix and the module doc are updated in the same PR.

## 5. Money-Invariant Tests

Continuous verification of requirements.md BR-03/BR-04:

- **Ledger balance:** after every fees-finance test scenario, property-style assertions recompute each ledger from its entries and compare to the stored balance — any drift fails.
- **Append-only:** attempts to UPDATE/DELETE invoices, payments, refunds, and audit rows through the app role must fail at the DB grant level.
- **Refund cap:** refunds exceeding collected amounts rejected at 422; **idempotency:** replaying a payment with the same `Idempotency-Key` produces one ledger entry.
- **Concurrency:** parallel payments against one invoice never over-collect (row-locking test).
- **Payroll:** payslip totals equal structure + allowances − deductions; approval required before disbursement entries exist.

## 6. Migration Tests

- Every PR runs migrations forward on a copy of the current production schema shape; reversible migrations are reversed and re-applied.
- Data migrations ship with pre/post assertions (row counts, invariant spot-checks) and are rehearsed against an anonymized production-scale dataset before release.
- RLS policy coverage test: CI asserts **every tenant-owned table has an RLS policy and a `tenant_id` NOT NULL column** — a new table without them fails the suite.
- Seed evolution: release upgrades to default roles must not remove tenant-granted permissions (auth-and-rbac.md §5) — asserted by seed-diff tests.

## 7. Load-Test Profiles (recommendations; run in Phase 5 and before major releases)

| Profile | Shape | Pass criteria |
| ------- | ----- | ------------- |
| **Attendance spike** | 200 tenants' teachers marking all sections within 60 min (burst writes + parent notification fan-out) | Write p95 < 800 ms; notification queue drains < 15 min; zero lost marks |
| **Fee day** | Month-boundary: bulk invoice generation + concurrent gateway payments + receipt PDFs | No double-collection under retry; job backlog < 5 min; read p95 holds < 400 ms |
| **Result publish** | A term's results published across tenants: report-card PDF batch + portal read storm + notification blast | Publish jobs complete; portal reads p95 < 400 ms; PDFs correct under concurrency |
| Baseline soak | 2 h at expected steady state (non-functional.md §2) | No memory growth, no error-rate drift |

Tooling: k6 or Locust (recommendation) against staging with production-scale seeded data; results tracked release-over-release.

## 8. UAT Protocol (pilot schools)

- 2–3 pilot schools (phase-plan.md Phase 5), each with a dedicated staging tenant seeded from their real (consented, anonymized where required) data via the import pipeline — which itself is thereby UAT-tested.
- **Scenario scripts per role** derived from users-and-roles.md §5 journeys: admin onboarding week, teacher day, accountant month-end, exam cycle, admissions funnel, parent experience.
- Defects triaged daily: Critical/High block launch; Medium scheduled; Low backlog. Exit: all scripts pass, zero Critical/High open, written sign-off per pilot school.
- UAT feedback that changes requirements updates the module doc first, then the code.

## 9. CI Gates (per PR)

1. Lint + type checks (backend and frontend) and secret scan (gitleaks).
2. Full unit + integration suites; cross-tenant (§3) and RBAC (§4) harnesses included.
3. Money-invariant suite on any PR touching fees-finance/payroll paths (path-triggered, plus nightly full run).
4. Migration forward/backward check (§6) when migrations present; RLS coverage assertion always.
5. OpenAPI contract diff — breaking `v1` change fails.
6. **Coverage floor (recommendation): 85% overall backend, 90% on `fees`, `auth`, `tenancy` packages; 85% global (statements/branches/functions/lines) on each of `apps/dashboard` and `apps/website`; coverage may never decrease** (ratchet). The frontend floor runs as its own CI check, isolated from lint/typecheck/build/E2E per §2 — a coverage-gate failure never withholds build or E2E signal from an unrelated change.
7. E2E smoke subset (login, one CRUD flow, one payment flow) on PRs labeled for it; full E2E nightly and pre-release.

## 10. Release Regression Checklist

Before any production release:

- [ ] Full CI green on the release candidate, including nightly E2E and full money suite
- [ ] Cross-tenant + RBAC harness green with RLS-enabled DB
- [ ] Migration rehearsal on anonymized production-scale data completed
- [ ] Load profile(s) relevant to the release (any perf-touching change) within targets
- [ ] ZAP baseline scan clean of new findings (security.md verification matrix)
- [ ] Backup + restore drill within the current cycle (non-functional.md §16)
- [ ] Feature flags default-safe (new features off unless plan-enabled); kill switches verified
- [ ] Seed/permission diffs reviewed; tenant-facing changelog and rollback plan written
