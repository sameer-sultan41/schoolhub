# Security Requirements

> **Agent Context**
> **Summary:** The complete security requirement register (scope §17) as numbered requirements **SEC-01 … SEC-21**, each with mitigation/implementation notes. Authentication detail defers to `auth-and-rbac.md`; tenant-isolation detail defers to `multi-tenancy.md`; AI data handling defers to `ai-governance.md`. Security is a first-class requirement: every SEC item maps to tests or checks in `testing-strategy.md`.
> **Co-load with:** [`../02-architecture/auth-and-rbac.md`](../02-architecture/auth-and-rbac.md) · [`../02-architecture/multi-tenancy.md`](../02-architecture/multi-tenancy.md) · [`../07-quality/testing-strategy.md`](../07-quality/testing-strategy.md) · [`../04-ai/ai-governance.md`](../04-ai/ai-governance.md)

## Principles

1. **Defense in depth** — isolation and authorization enforced at database, ORM, API, and UI layers; the database is authoritative.
2. **Deny by default** — no endpoint ships without a declared permission key; no module runs without its feature flag.
3. **Children are data subjects** — the platform stores minors' PII; privacy requirements (SEC-17) constrain every other feature, including AI.
4. **Everything audited** — mutations and security events are append-only logged (SEC-14).
5. **Secure by default** — new features ship flag-off, new endpoints ship permission-guarded, new tables ship with RLS; the safe state is always the default state.
6. Alignment target (recommendation): OWASP ASVS Level 2 for the application, OWASP Top 10 coverage verified each release.

## SEC-01 Authentication Hardening

**Requirement:** All human and machine access authenticates via the central auth layer; no alternative login paths.
**Implementation** (full detail: [`auth-and-rbac.md`](../02-architecture/auth-and-rbac.md) §1):
- JWT access (15 min) + rotating refresh (30 days); refresh reuse revokes the whole token family (theft detection).
- Login rate limiting per account and per IP; lockout with exponential backoff; secure one-time-token reset.
- Machine access (website renderer → API) uses scoped, read-only tokens ([`api-architecture.md`](../02-architecture/api-architecture.md) §2.2) — never shared human credentials.
- Impersonation by platform support only via audited, time-boxed elevation grants with visible banner.

## SEC-02 Role-Based Access Control

**Requirement:** Every API endpoint declares a required permission key; record scopes constrain rows; no direct user→permission grants; student/guardian accounts can never hold staff keys.
**Implementation** (detail: auth-and-rbac.md §2–3):
- Declared permission decorators per endpoint, published in OpenAPI — an undecorated endpoint fails CI.
- Record-scope filters (`own`/`assigned`/`campus`/`all`) applied in base querysets, never in view code.
- Approval steps enforce segregation of duties (initiator ≠ approver); financial permissions always audited with amounts.
- Verified by the RBAC permission-matrix test suite ([`../07-quality/testing-strategy.md`](../07-quality/testing-strategy.md) §4).

## SEC-03 Tenant Isolation

**Requirement:** No user, job, AI feature, file URL, search query, or report may ever read or write another tenant's data. Cross-tenant references in payloads return `404` (never `403`) to avoid existence leaks.
**Implementation:** PostgreSQL RLS on every tenant-owned table with a non-`BYPASSRLS` app role; ORM default tenant manager; storage key prefixes + tenant-checked signed URLs; `tenant_id`-filtered search indexes. Detail: [`multi-tenancy.md`](../02-architecture/multi-tenancy.md) §3.
**Test mandate:** CI runs a **cross-tenant access test for every endpoint class of every module** — reads and writes attempted with another tenant's IDs must fail. A module cannot merge without these tests (testing-strategy.md §3).

## SEC-04 Password Security

**Requirement:** Argon2id hashing (no reversible storage anywhere, including logs); minimum 10 characters with breach-list (k-anonymity) check; no forced periodic rotation (NIST-aligned); no password hints or security questions.
**Implementation:** Password fields excluded from serializers, logs, and audit `before/after` snapshots. Reset tokens single-use, 15-minute expiry, delivered via verified email/SMS. Bulk-created student accounts get random initial passwords with forced change on first login.

## SEC-05 Session Management

**Requirement:** Users can list and revoke their active sessions/devices; admins can force logout; refresh-token theft is detected and contained.
**Implementation:** Server-side refresh-token registry with rotation; reuse of a rotated token revokes the whole family. Web refresh token in HttpOnly, Secure, SameSite=Lax cookie; access token in memory only (never localStorage). Idle and absolute session lifetimes configurable per tenant for staff roles (recommendation: 12 h idle / 30 d absolute).

## SEC-06 MFA / 2FA Readiness

**Requirement:** TOTP MFA available at launch for platform roles and tenant owners/admins; per-tenant policy can enforce MFA for all staff; architecture supports adding SMS-OTP/WebAuthn without contract changes.
**Implementation:** `second_factor` step in the login state machine (auth-and-rbac.md §1); recovery codes generated at enrollment; MFA changes are security-audited events.

## SEC-07 API Security

**Requirement:** All API traffic over TLS; authentication on every endpoint (public website content endpoints use scoped read-only machine tokens); standard security headers; no sensitive data in URLs or query strings.
**Implementation:**
- Security headers: HSTS, `X-Content-Type-Options: nosniff`, frame-ancestors denial; strict CORS allowlist per environment.
- Error responses never leak stack traces, SQL, or internal paths (RFC 9457 envelope, api-architecture.md §2.3).
- `X-Request-ID` on every response for forensic correlation with logs and audit rows.
- OpenAPI spec reviewed each release for unintentionally unauthenticated endpoints; the endpoint registry drives this check.

## SEC-08 Input Validation

**Requirement:** All input validated server-side at the serializer layer with **field allowlists** — unknown fields rejected, types/lengths/ranges enforced; client-side validation is UX only.
**Implementation:**
- DRF serializers with explicit `fields` lists — `__all__` is banned on writable serializers (lint rule).
- Filterable/sortable query params whitelisted per endpoint (api-architecture.md §2.4); unknown params rejected.
- File metadata validated separately (SEC-12); numeric money fields validated as decimals with currency-aware precision.
- Import pipelines validate row-by-row with a full error report before anything is applied ([`../07-quality/non-functional.md`](../07-quality/non-functional.md) §10).

## SEC-09 SQL Injection Prevention

**Requirement:** No string-built SQL. All data access goes through the ORM with parameterized queries.
**Implementation:** Raw SQL (`.raw()`, `cursor.execute`) requires explicit security review and a code-owner approval, is parameterized only, and is limited to migration/reporting code. Lint rule flags raw-SQL usage in CI. RLS provides a second barrier: even an injected query runs inside the tenant's row visibility.

## SEC-10 XSS Protection

**Requirement:** No untrusted content is rendered as HTML anywhere in dashboard or public websites.
**Implementation:** React/Next.js auto-escaping as baseline; `dangerouslySetInnerHTML` banned except for the CMS rich-text path, which sanitizes server-side against an element/attribute allowlist. **Content-Security-Policy** on all surfaces (recommendation: default-src 'self', no inline script, nonce-based where needed). User uploads never served from the app origin (SEC-12).

## SEC-11 CSRF Protection

**Requirement:** All cookie-authenticated flows are CSRF-protected.
**Implementation:** The refresh-token cookie endpoint uses SameSite=Lax plus a double-submit CSRF token; bearer-token API calls are inherently CSRF-safe. Public website forms (admissions/contact) use per-form tokens plus SEC-16 throttles.

## SEC-12 Secure File Uploads

**Requirement:** Uploaded files cannot execute, cannot be mistyped, cannot exceed limits, and are only reachable by authorized tenant members.
**Implementation:** presigned-URL two-step upload (api-architecture.md §2.8) with:
- **Type validation:** extension **and** magic-byte content-type check must agree; per-type allowlists (a student-document slot accepts PDF/JPEG/PNG, nothing else).
- **Size limits** per file type and per plan quota; filename normalization (no path traversal, no unicode tricks).
- **Antivirus scan** (e.g. ClamAV — recommendation) before a file flips from `pending` to `ready`; detections quarantined and alerted (SEC-19).
- **No inline execution:** private bucket; delivery only via short-lived tenant-checked signed URLs; `Content-Disposition: attachment` for non-image types; SVG never served inline without sanitization; uploads never served from the application origin (CSP-relevant, SEC-10).
- **Tenant scoping:** storage keys prefixed `tenants/{tenant_id}/…`; signed-URL issuance re-checks the requester's tenant and permission.

## SEC-13 Encryption

**Requirement:** All data encrypted in transit and at rest; extra-sensitive fields encrypted at column level.
**Implementation:**
- **Transit:** TLS 1.2+ everywhere (external and service-to-service); HSTS preload; auto-renewed certificates including tenant custom domains.
- **At rest:** disk/volume encryption for database, backups, and object storage (provider-managed keys minimum; KMS-managed recommended).
- **Column-level (application-layer) encryption** for the most sensitive fields — staff **salary and bank details**, government ID numbers, medical notes on student profiles — so DB dumps and read replicas don't expose them in plaintext. Keys in the secrets manager (SEC-15), rotation procedure documented.

## SEC-14 Audit Logging

**Requirement:** Every mutation and every security event is logged append-only with actor, tenant, before/after, request ID, IP, and user agent; logs are immutable and retained per policy.
**Implementation** (detail: auth-and-rbac.md §4):
- `audit_log` table with no UPDATE/DELETE grants for the app role — immutability enforced at the database, tested in CI.
- Security events logged in addition to mutations: logins (success/fail), password/MFA changes, role/permission changes, exports, impersonation grants.
- Before/after snapshots are PII-minimized (no password/secret material, sensitive fields referenced not embedded).
- Tenant-visible to `school_owner`/`it_admin` with filters; retention per [`../07-quality/non-functional.md`](../07-quality/non-functional.md) §8.

## SEC-15 Secrets Management

**Requirement:** No secret (DB credentials, API keys, JWT signing keys, encryption keys) ever appears in source control, images, logs, or client bundles.
**Implementation:** Environment-injected secrets from a managed secret store (per [`../02-architecture/hosting-deployment.md`](../02-architecture/hosting-deployment.md)); gitleaks in pre-commit and CI; per-environment secrets with least privilege; JWT signing-key rotation supported via key IDs; provider keys (LLM, SMS, payments) held platform-side only — tenants never see raw provider credentials.

## SEC-16 Rate Limiting & Abuse Prevention

**Requirement:** All endpoints rate-limited; authentication and public endpoints strictly; bulk-cost endpoints (SMS, AI, exports) quota-bound.
**Implementation:**
- Redis token-bucket per user and per tenant (api-architecture.md §2.5); stricter buckets on login, reset, and OTP endpoints.
- **Public forms (admissions, contact, enquiry): CAPTCHA + per-IP and per-tenant throttles + honeypot fields** — these are unauthenticated and internet-facing, and feed staff-visible queues (spam directly costs staff time).
- Notification sends and AI calls capped by per-tenant plan quotas; exports throttled per user.
- Anomalous usage spikes (per tenant or per IP) alert the platform team (SEC-19); repeat abusers blockable at the edge.

## SEC-17 Data Privacy (children's data)

**Requirement:** The platform processes minors' PII and must minimize, gate, and govern it:
1. **Minimization** — collect only fields a configured feature needs; optional profile fields are tenant-choices, off by default.
2. **Guardian consent** — tenant onboarding includes consent-capture guidance; consent state recorded per student for photos/website publication (gallery/news must respect a per-student publication flag).
3. **Role-gated PII** — sensitive fields (medical, documents, contact details) require explicit permission keys; list endpoints return minimal projections by default.
4. **No PII to AI providers without redaction** — the AI gateway pseudonymizes/redacts direct identifiers before any external model call; see [`../04-ai/ai-governance.md`](../04-ai/ai-governance.md).
5. **Exports audited** — every export (who, what, when, row count) is a security-audited event; export permission is separate from view.
6. **Subject rights** — access/rectification/erasure request handling per non-functional.md §9; erasure respects legal retention of financial/academic records.

## SEC-18 Backup Security

**Requirement:** Backups are as protected as production data.
**Implementation:** Encrypted at rest, stored in a separate account/region from production, access restricted to a break-glass role and audited; restore drills each release cycle (non-functional.md §16); tenant deletion propagates via backup aging per multi-tenancy.md §7 — deleted-tenant data ages out of backups within the documented window.

## SEC-19 Security Monitoring & Alerting

**Requirement:** Security-relevant signals are detected and alerted on, not just logged.
**Implementation:** Alerts on: authentication failure spikes, lockout storms, RLS policy errors, cross-tenant `404` anomaly patterns, impersonation grants, export volume anomalies, rate-limit saturation, AV detections on uploads, and dependency CVE disclosures. Wired into the observability stack (non-functional.md §4) with an on-call escalation path.

## SEC-20 Vulnerability Management

**Requirement:** Known-vulnerable dependencies and configurations are found and fixed on a defined cadence.
**Implementation:** Dependabot (or equivalent) on all repos with a triage SLA (recommendation: criticals ≤ 72 h); container base-image scanning in CI; OWASP ZAP baseline scan against staging in CI; **annual external penetration test plus a pen test before initial launch** (Phase 5, [`../01-phases/phase-plan.md`](../01-phases/phase-plan.md)); findings tracked to closure with severity SLAs.

## SEC-21 Incident Response (recommendation)

**Requirement:** A written, rehearsed incident response procedure exists before launch.
**Roles:** an incident commander (rotating from the engineering team), a communications owner (tenant/regulator notices), and the platform on-call as first responder; contact tree kept current in the runbook.
**Rehearsal:** at least one tabletop exercise before launch (Phase 6 entry) and annually thereafter, using a cross-tenant-leak scenario as the canonical drill.
**Outline:**
1. **Detect & triage** — alert (SEC-19) or report → severity classification (S1 data breach / S2 active exploit / S3 vulnerability / S4 anomaly).
2. **Contain** — kill switches: feature flags, tenant suspension, token-family revocation, credential rotation, provider key rotation.
3. **Investigate** — request-ID-correlated logs + immutable audit trail; preserve evidence.
4. **Notify** — affected tenants (owners) within a defined window; regulator notification per applicable jurisdiction (placeholder until markets fixed — non-functional.md §9); children's-data breaches treated at highest severity.
5. **Recover & review** — restore, post-incident report with corrective actions tracked; runbook updated.

## Verification Matrix

| SEC | Verified by |
| --- | ----------- |
| 01, 04, 05, 06 | Auth test suite + pen test |
| 02 | RBAC permission-matrix tests (testing-strategy.md §4) |
| 03 | Mandatory cross-tenant suite (testing-strategy.md §3) + RLS-enabled test DB |
| 07–11 | ZAP baseline scan, serializer lint rules, CSP report-only rollout then enforce |
| 12 | Upload integration tests (bad magic bytes, oversize, EICAR) |
| 13, 15 | Infra review + gitleaks + config audit |
| 14 | Immutability tests (app role cannot UPDATE/DELETE audit rows) |
| 16 | Throttle tests + load profiles (testing-strategy.md §7) |
| 17 | AI-governance checklist + export audit tests |
| 18–21 | Restore drills, alert fire drills, dependency dashboards, annual pen test |
