# Phase 5 — Testing, Security, Performance & UAT

> **Agent Context**
> **Summary:** Covers lifecycle activities 10–13 (QA, security testing, performance testing, UAT). Phase 5 is the **gate, not the start** of testing — CI has run since Phase 2 week 1. This phase runs the full regression, a scoped penetration test (OWASP-aligned, tenant-isolation-focused), load tests against three realistic spike profiles, and a scripted UAT protocol with the pilot schools, all against explicit defect exit bars. ~4 weeks is a **recommendation**.
> **Co-load with:** [`phase-plan.md`](phase-plan.md) · [`../06-security/security.md`](../06-security/security.md) · [`../07-quality/testing-strategy.md`](../07-quality/testing-strategy.md) · [`phase-6-launch.md`](phase-6-launch.md)

## Objective

Prove the platform is launchable: functionally complete against the SRD, secure against the threats a multi-tenant school system attracts, performant under real school traffic patterns, and accepted by the pilot schools who will go live in Phase 6.

## Entry Criteria

- Phase 3 and Phase 4 exit criteria met (Phase 5 gates both parallel tracks).
- Feature freeze declared: only defect fixes merge during this phase; feature flags locked to launch configuration.
- Staging environment production-shaped (same topology, RLS, provider sandboxes) with two or more seeded tenants at realistic volume.
- Known-issue log from Phases 2–4 triaged; zero open criticals at entry.

## Activities

### 1. QA regression

- Execute the full regression pack accumulated since Phase 2: per-module functional suites, cross-module scenarios (admission → enrollment → attendance → exam → result → fee), and — if browser-level end-to-end coverage has been adopted by then (see [`../07-quality/testing-strategy.md`](../07-quality/testing-strategy.md)) — the journeys spanning dashboard, parent portal and public website.
- **Cross-tenant regression** re-run in full — every endpoint class attempts foreign-tenant reads/writes and must 404 ([`multi-tenancy.md`](../02-architecture/multi-tenancy.md) §3.5).
- Exploratory testing tours per persona (teacher day, accountant fee-day, parent journey), including RTL/Urdu locale and accessibility checks (keyboard-only passes on the top 10 flows).
- Data-integrity checks: import → operate → export round-trips; report totals reconcile with ledgers.

### 2. Security testing

- **Penetration test** (recommendation: external firm) with a written scope: multi-tenant isolation (the headline risk), authentication/session handling, RBAC bypass and privilege escalation (including custom roles and student/guardian restricted principals), payment callbacks and webhooks, file upload/download paths, AI endpoints (prompt injection, data exfiltration), public website ↔ tenant data boundary.
- **OWASP alignment:** ASVS-driven checklist plus Top 10 coverage; OWASP ZAP baseline scans already in CI are re-run against the frozen build; dependency and secret scans (Dependabot, gitleaks) must be clean.
- Findings triaged jointly with the tech lead: Critical/High fixed and **re-tested by the testers** within the phase; Medium scheduled with owners; report archived in [`../06-security/security.md`](../06-security/security.md) evidence.

### 3. Performance testing

Load profiles model how schools actually hit the system — synchronized bursts, not steady traffic. Targets (recommendations, tune at test design): p95 < 500 ms API reads, < 1 s writes, error rate < 0.1% at peak.

| Profile | Shape | What it stresses |
| ------- | ----- | ---------------- |
| **Morning attendance spike** | All teachers of all tenants mark attendance within ~15 minutes of day start; parent absence notifications fan out immediately after | Concurrent tenant-scoped writes, RLS overhead, notification queue throughput |
| **Fee-due-date spike** | Month-end: invoice generation batch + parents paying concurrently + accountants running collection reports | Payment idempotency under concurrency, gateway callback bursts, heavy read/write mix on fees tables |
| **Result-publish spike** | A large tenant publishes results; thousands of parents/students load report cards within minutes; report-card PDFs generate in bulk | Read amplification, cache effectiveness, Celery PDF pipeline, SSE notification stream |

- Soak test (24 h at nominal multi-tenant load) for leaks and queue backlog; failure drills: Redis restart, worker loss, provider sandbox timeouts.
- Outcomes: capacity model (tenants × students per node), scaling thresholds and alerts for [`phase-6-launch.md`](phase-6-launch.md), and an indexed-query review of the top 20 slowest statements.

### 4. UAT protocol with pilot schools

- **Scripted UAT** per persona: each pilot school receives scenario scripts (staff + parent roles) covering its real operations on a staging tenant loaded with **its own imported legacy data** (from Phase 4).
- 2-week UAT window (recommendation): week 1 scripted scenarios, week 2 free operation shadowing their real week ("run Monday in the system too").
- Feedback captured as structured defect/change requests; change requests go to the Phase 7 enhancement intake — UAT accepts or rejects the build, it does not re-scope it.
- **Sign-off:** each pilot school's champion signs a UAT acceptance record listing open non-blocking issues they accept at launch.

### 5. Defect triage & exit bars

- Daily triage (QA lead + tech lead + PM). Severity definitions: **Critical** — data loss/corruption, tenant-isolation breach, payment error, security High+, no workaround; **Major** — core flow broken with workaround; **Minor** — cosmetic/edge.
- **Exit bars:** 0 Critical open; 0 Major open on launch-critical flows (attendance, fees, results, communication, auth); Majors elsewhere ≤ agreed cap with client sign-off; all pen-test Critical/High fixes re-tested; performance targets met on all three profiles.

## Deliverables

- Regression report (pass rates, coverage, known issues) · Pen-test report + remediation evidence · Load-test report + capacity model + scaling thresholds · Signed UAT acceptance records (per pilot school) · Frozen release candidate build + launch known-issue log for [`phase-6-launch.md`](phase-6-launch.md).

## Roles Involved

- **QA lead** (phase owner, triage chair) · **QA engineers** (regression, exploratory, UAT support) · **External pen-testers** (recommendation) · **Backend/frontend engineers** (fix stream only) · **Tech lead** (severity arbitration, performance analysis) · **PM/BA** (UAT logistics, sign-off collection) · **Pilot-school staff & parents** (UAT execution) · **Client sponsor** (exit-bar acceptance).

## Exit Criteria

Matches [`phase-plan.md`](phase-plan.md) §3: **zero criticals; UAT sign-off**, specifically:

1. All exit bars in Activity 5 met, evidenced in the regression/pen-test/load reports.
2. UAT acceptance signed by every pilot school going live in Phase 6.
3. Release candidate tagged; no code change after tag except client-approved critical fixes (which re-run the affected suites).
4. Capacity model and alert thresholds handed to the launch team.

## Risks & Mitigations

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| Fix stream introduces regressions during the phase | Endless stabilization loop | Full CI on every fix; targeted regression re-run per merge; feature freeze strictly enforced |
| Pen-test finds an isolation flaw late | Launch slip | Cross-tenant testing has run since Phase 2; pen-test scope front-loads tenancy in week 1 |
| Load tests pass on staging but staging ≠ production | False confidence | Production-shaped staging is an entry criterion; capacity model re-validated during Phase 6 soak |
| UAT schools test politely instead of realistically | Shallow acceptance | Scripted scenarios + "run your real week" shadow operation on their own imported data |
| Exit bars negotiated downward under deadline pressure | Launching known-bad | Bars pre-agreed here with client sign-off; any waiver is written and owner-signed |
| Spike profiles underestimate real burst concurrency | Launch-day incident | Profiles derived from pilot headcounts × observed behavior (Phase 0), tested at 2× margin |
