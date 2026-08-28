# Future: Mobile Applications

> **Agent Context**
> **Summary:** Scope §20 — mobile apps are a **future phase, explicitly not built initially**. Defines the recommended app split (two Flutter apps: Parent+Student, Staff), what the current architecture already guarantees for mobile, the mobile-readiness rules that must not be broken meanwhile, offline considerations, and store/release strategy. All content here is recommendation-grade until the mobile phase is scoped.
> **Co-load with:** [`../02-architecture/api-architecture.md`](../02-architecture/api-architecture.md) · [`../02-architecture/auth-and-rbac.md`](../02-architecture/auth-and-rbac.md) · [`../01-phases/phase-plan.md`](../01-phases/phase-plan.md) · [`extensibility.md`](extensibility.md)

## 1. Position

Mobile apps for students, parents, teachers, and school staff are planned but deferred (scope §20). The obligation on the current build is architectural: the API, auth, and notification layers must let mobile be added **without major backend changes**. Technology recommendation: **Flutter** (single codebase, Android + iOS) consuming the same versioned REST API ([`../02-architecture/tech-stack.md`](../02-architecture/tech-stack.md) §7).

Business rationale: parents are the largest user population and the most mobile-first; a strong parent app directly drives the parent-activation and fee-collection success metrics in [`../00-overview/vision.md`](../00-overview/vision.md) §8.

## 2. App Split (recommendation)

| Option | Pros | Cons |
| ------ | ---- | ---- |
| One app, role-based experience | Single codebase/release train; users with dual roles (teacher who is also a parent) switch in-app | Bloated bundle; muddled store listing/reviews; parent-facing polish and staff-facing density fight each other; hardest permission surface to audit |
| Separate app per role (4 apps) | Perfectly focused UX | 4 store listings and release trains — untenable for a small team |
| **Two apps: "SchoolHub Family" (Parent + Student) and "SchoolHub Staff" (Teacher + all staff roles)** | Matches the real audience boundary (restricted principals vs staff — users-and-roles.md §6.4); two focused listings; staff app can lean dense/productive while family app leans simple; RBAC already drives what staff see, so one staff app serves every staff role | Two release trains (acceptable) |

**Recommendation: two apps.**
- **SchoolHub Family** serves guardians and students: child switcher for guardians with multiple children; student mode for older students; simple, notification-driven UX.
- **SchoolHub Staff** renders whatever the signed-in user's roles permit — the same permission keys that drive the dashboard drive mobile navigation, so one staff app serves teachers, accountants, librarians, drivers, and admins without per-role builds.
- Dual-role people (a teacher who is also a parent) install both — they genuinely hold two different relationships with the school.

### Indicative feature scope per app (to be confirmed at mobile-phase kickoff)

| App | First-release scope |
| --- | ------------------- |
| Family | Attendance and results view, timetable, fee invoices + payment, notices/messages, AI study assistant (student mode), consent-aware gallery/news |
| Staff | Attendance marking (incl. offline queue, §5), timetable + substitutions, approvals inbox, marks entry, parent messaging, AI teacher tools |

## 3. What the Current Architecture Already Guarantees

- **Versioned REST + OpenAPI** — stable `v1` contracts; mobile clients are generated from the same spec as the web TS types (api-architecture.md §2.9). Additive-only changes within `v1`.
- **Mobile-ready auth** — JWT access + rotating refresh with server-side revocation was designed for token (not cookie) clients from day one; mobile stores the refresh token in secure storage (Keychain/Keystore) and uses the **same endpoints** (auth-and-rbac.md §1). Session listing/revocation covers mobile devices automatically.
- **Push notifications** — the notification service is channel-adapter based ([`../02-architecture/notifications.md`](../02-architecture/notifications.md)); adding FCM/APNs is a new adapter plus a device-token registry, not a redesign. Notification preferences and templates are already channel-aware.
- **Presigned uploads** — the two-step file flow (api-architecture.md §2.8) works identically from mobile; no multipart-through-API rework.
- **Server-authoritative permissions** — UI hiding is UX only; every check is server-side, so a new client cannot widen access.
- **SSE real-time** — consumable from mobile; if richer real-time is needed, WebSockets are an additive channel.
- **Tenant resolution from the JWT** — no domain-based logic needed in apps; one binary serves all tenants (per-tenant branding fetched at login).

In short, the mobile phase consumes contracts that already exist; its net-new backend work is limited to:

| Net-new backend work at mobile phase | Size |
| ------------------------------------ | ---- |
| FCM/APNs channel adapter + device-token registry | Small (adapter pattern exists) |
| Minimum-supported-app-version endpoint (§6) | Trivial |
| Payment deep-link/return-URL handling for in-app payment flows | Small (gateway adapters already redirect-based) |
| Any offline-sync conflict endpoints (§5) | Moderate, attendance-only |

## 4. What Must NOT Be Broken Meanwhile (mobile-readiness rules)

Enforced by the **mobile-readiness review at every phase exit** (phase-plan.md §4.4):

1. No cookie-only authentication paths for API functionality — cookies are a web transport choice, never a contract requirement.
2. No HTML-only flows for anything a mobile user needs (e.g. payment initiation must have an API + redirect/deep-link pattern, not a web-form-only flow).
3. No breaking changes inside `v1`; deprecations follow the versioning policy.
4. No web-session assumptions in rate limiting, idempotency, or CSRF design that would reject token clients.
5. Feature flags, plan checks, and permission checks stay server-side (never baked into client builds).
6. Notification triggers keep channel-agnostic payloads so push can render them without server changes.

## 5. Offline Considerations (future-phase design notes)

- **Read-mostly offline:** cache timetable, contact info, recent results/attendance, and notices locally; every cached view clearly stamped with "as of" freshness.
- **Queued writes for narrow cases only:** teacher attendance marking is the prime candidate (classroom connectivity dead zones):
  - queue marks locally and sync with the existing `Idempotency-Key` mechanism (api-architecture.md §2.5) so retries never double-write;
  - the server resolves conflicts as last-write-with-audit; discrepancies route through the existing attendance-correction workflow rather than silent overwrites;
  - queued items expire at day end — stale marks require the correction flow, keeping BR-07 intact.
- **Never offline:** payments, approvals, result publishing — anything money- or approval-gated (BR-03/BR-05 in [`../00-overview/requirements.md`](../00-overview/requirements.md)) requires a live server round-trip.
- **Children's-data caution:** local caches encrypted at rest, scoped per account, wiped on logout and on server-side device/session revocation ([`../06-security/security.md`](../06-security/security.md) SEC-17 applies to devices too).

## 6. Store & Release Strategy (recommendation)

- **Platform-branded apps** (SchoolHub Family / SchoolHub Staff) on both stores; tenant selection at login, tenant branding (logo, colors) applied in-app from the tenant-config API.
- **White-label per-school listings are out of scope initially** — store-review overhead and per-tenant build maintenance don't fit a small team; revisit as a premium plan feature via [`extensibility.md`](extensibility.md).
- Release trains decoupled from backend releases (the stable `v1` contract makes this safe); staged rollouts (1% → 100%) on both stores.
- **Forced-upgrade mechanism from v1:** a minimum-supported-app-version endpoint lets the backend retire insecure or contract-obsolete clients gracefully.
- Beta tracks (TestFlight / Play internal testing) fed by the pilot schools; crash/ANR monitoring wired into the same error-tracking stack (Sentry) with release tagging.
- **Phase placement:** after launch stabilization (phase-plan.md Phase 7 roadmap), scoped as its own project — this doc plus the OpenAPI spec are its starting brief; the mobile-readiness reviews (§4) guarantee the brief stays valid until then.
