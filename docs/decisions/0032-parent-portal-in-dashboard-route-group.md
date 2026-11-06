# 0032. The parent portal is a route group in the dashboard app, routed by a server flag

- **Status:** Accepted
- **Date:** 2026-11-04
- **Enforced by:** `apps/api/core/rbac/tests/test_me.py` (`test_me_flags_restricted_principal`, `test_me_flag_false_for_staff`: `/auth/me` tells a client which shell a user belongs in); `apps/api/apps/parent_portal/tests/test_dashboard.py` (the summary's `modules` booleans are computed on the server from keys and feature flags). That the portal screens live under `apps/dashboard`'s `(portal)` route group, and that the shells route on `is_restricted_principal`, is review only until PR 2 lands its routing tests

## Context

Guardians and students need their own screens: a per-child summary, attendance, fees,
results, timetable, notices, messages and the notification inbox
([`parent-portal.md`](../03-modules/parent-portal.md) §5). The staff dashboard already has the
login, session and token refresh, the proxy, the `src/services/` API layer, i18n and the
design system. The portal owns no data; it reads each module's own endpoints under `own`
scope. Decided in plan
[`docs/superpowers/plans/2026-11-04-parent-portal.md`](../superpowers/plans/2026-11-04-parent-portal.md)
(user decision).

## Decision

1. **One app.** The portal is a `(portal)` route group inside `apps/dashboard`, beside the
   staff `(app)` group, sharing its auth, session, proxy, services and i18n.
2. **The server says who belongs where.** `/auth/me` (and the login response) carries
   `is_restricted_principal`. The shells read it once `/auth/me` resolves, render nothing
   until then, and `router.replace` a guardian or student into the portal and a staff user
   out of it. Role slugs are never sniffed in the client.
3. **The server says which tabs exist.** `GET /parent-portal/dashboard` returns
   `modules: {attendance, fees, examinations, communication, timetable}`, each true only when
   the caller holds the card's key and the tenant has the module on. A card the caller cannot
   read is `null`, never a zero.
4. **Hiding is UX, not enforcement** (Invariant 3). Every portal read is still the owning
   module's endpoint with its own key, scope and 404s.

## Alternatives considered

- **A new `apps/portal` app** — why not: it duplicates auth, session, proxy, services and
  i18n wiring and adds a CI lane, for the same backend calls.
- **Routing on role slugs in the client** — why not: it misses a tenant-defined restricted
  role; the flag is what `DenyRestrictedPrincipals` itself reads.
- **Reading roles in `proxy.ts`** — why not: the proxy sees only an opaque session cookie.
- **Tabs from `menu-access.ts`'s `canAccessModule`** — why not: it checks key prefixes only,
  and the dashboard has no source of tenant feature flags.
- **A `/tenant/features` endpoint for the tabs** — why not: a second source of truth for one
  consumer, when the summary already knows both the keys and the flags.

## Consequences

A portal screen is built like any dashboard screen (`schoolhub-dashboard-screen`, the
generated client, the shared design tokens), and the same API serves a future mobile app
(Invariant 7). The cost is that staff and portal code share one bundle and one deploy, so a
portal route must never import a staff-only feature module. A restricted role a tenant
defines lands in the portal with no client change. Whoever adds a portal tab adds its key and
flag to the summary's `modules`, not a client-side check.
