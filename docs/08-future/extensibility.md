# Future: Scalability & Extensibility

> **Agent Context**
> **Summary:** Scope §21 — the catalog of planned future capabilities (themes, marketplace, payment gateways, biometric/RFID, IoT, advanced AI, channels, educational integrations, analytics, billing), each mapped to the **extension point in the current architecture that enables it** and a rough phase placement. Nothing here is initial scope; the current build's obligation is to keep these extension points intact.
> **Co-load with:** [`mobile-apps.md`](mobile-apps.md) · [`../02-architecture/api-architecture.md`](../02-architecture/api-architecture.md) · [`../02-architecture/multi-tenancy.md`](../02-architecture/multi-tenancy.md)

## Extension-Point Inventory (what the current architecture provides)

| Extension point | Defined in |
| --------------- | ---------- |
| Provider-agnostic **adapter layers** (notifications, payments, AI) | [`../02-architecture/tech-stack.md`](../02-architecture/tech-stack.md), [`../02-architecture/notifications.md`](../02-architecture/notifications.md) |
| **Feature flags + plans** (per-tenant enablement, kill switches, quotas) | [`../02-architecture/multi-tenancy.md`](../02-architecture/multi-tenancy.md) §5–6 |
| **Versioned REST API + OpenAPI + scoped machine tokens** | [`../02-architecture/api-architecture.md`](../02-architecture/api-architecture.md) |
| **Webhooks** (signed outbound events per tenant) | api-architecture.md §2.6 |
| **AI gateway** (provider-agnostic, budgeted, redacting) | [`../02-architecture/ai-architecture.md`](../02-architecture/ai-architecture.md) |
| **Theme system** (theme-instance per tenant, one theme initially) | [`../03-modules/website-cms.md`](../03-modules/website-cms.md) |
| **Background jobs + SSE** (async work, event streams) | api-architecture.md §2.7, §3 |

## 1. Additional Website Themes

- **What:** more design packages for tenant public sites (WordPress-style theme choice), with theme-level options.
- **Extension point:** the website renderer already resolves a per-tenant *theme instance* over a stable content model (pages, sections, branding tokens) — a new theme is a new rendering package against the same CMS content contract; no backend changes.
- **Phase:** first post-launch roadmap item (Phase 7); theme marketplace pricing via plans.

## 2. Marketplace Integrations

- **What:** a directory of third-party apps/services schools can enable (e.g. e-learning tools, accounting sync).
- **Extension point:** scoped machine tokens + per-endpoint permission keys give integrations least-privilege API access; webhooks give them events; feature flags gate availability per tenant/plan. A formal OAuth2 client-credentials layer for third parties is the main addition.
- **Phase:** later roadmap (after mobile); start by hardening the public API docs.

## 3. More Payment Gateways

- **What:** additional regional gateways beyond the launch gateway(s), selectable per tenant (no country is assumed).
- **Extension point:** payments already sit behind a **gateway adapter interface** (initiate / callback-verify / refund / reconcile) with idempotency keys and append-only ledger entries ([`../03-modules/fees-finance.md`](../03-modules/fees-finance.md)); a new gateway is a new adapter + config UI entry, never a fees-module change.
- **Phase:** demand-driven, from Phase 7 onward; each adapter sandbox-verified per the Phase 4 checklist.

## 4. Biometric Attendance & RFID

- **What:** fingerprint/face devices and RFID card readers feeding staff/student attendance automatically.
- **Extension point:** the **device-integration adapter pattern** — attendance ingestion is an API concern (`attendance` module write endpoints + idempotent bulk ingest), so a device integration is: device/vendor adapter → normalized punch events → the same attendance service the UI uses (validations, corrections, notifications all reused). Device registry and per-campus mapping live in tenant settings.
- **Phase:** post-launch; pilot with one vendor per device class; keep vendor SDKs out of the core (adapter processes/workers only).

## 5. IoT Integrations (transport GPS)

- **What:** live vehicle tracking (GPS units), route-adherence alerts, parent "bus nearby" notifications.
- **Extension point:** the transport module models vehicles/routes/stops with **tracking-integration readiness** ([`../03-modules/transport.md`](../03-modules/transport.md)); GPS providers post to an ingest endpoint (device adapter again), positions fan out over the existing SSE channel — this is the flagged trigger for adding WebSockets if bidirectional traffic is needed (api-architecture.md §3). Geodata retention gets its own short retention class.
- **Phase:** after mobile apps (tracking is primarily a parent-app feature).

## 6. Advanced AI Models & Capabilities

- **What:** stronger/cheaper models, fine-tuned or school-corpus-grounded assistants, richer predictive models (enrollment forecasting, staffing optimization).
- **Extension point:** the **AI gateway** is provider-agnostic per feature — models are swappable per feature flag with per-tenant budgets; evaluation/monitoring hooks and the human-approval workflow ([`../04-ai/ai-governance.md`](../04-ai/ai-governance.md)) apply to new models automatically. Redaction rules (security.md SEC-17) are gateway-level, so new capabilities inherit them.
- **Phase:** continuous from Phase 7; each new AI capability passes the same governance checklist as launch features.

## 7. Additional Communication Channels

- **What:** more channels beyond email/SMS/push/in-app — e.g. WhatsApp Business, Telegram, voice/IVR broadcasts.
- **Extension point:** the notification service's **channel adapter interface** (send / delivery-status / retry semantics) plus channel-aware templates and per-user preferences ([`../03-modules/communication.md`](../03-modules/communication.md)); a channel is an adapter + template variant + preference option, plan-gated for cost control.
- **Phase:** WhatsApp is near-term (Phase 4/7 depending on market); others demand-driven.

## 8. Third-Party Educational Integrations

- **What:** LMS/content platforms, video classes, e-library providers, exam-board data exchange.
- **Extension point:** versioned REST + webhooks for data exchange; SSO for launch-into-tool flows is the main addition (the JWT auth layer is structured to add an OIDC identity-provider facade without changing core auth). Import/export pipelines (non-functional.md §10) handle batch interchange formats.
- **Phase:** roadmap, prioritized by pilot-school demand.

## 9. Advanced Analytics

- **What:** cross-year cohort analytics, benchmarking, custom report builders, possibly a warehouse.
- **Extension point:** reporting already runs on a **separate read path** (read replicas per non-functional.md §2; platform aggregates per multi-tenancy.md §8) — a warehouse/ELT feed is an extension of that path. Tenant isolation carries into the warehouse via mandatory `tenant_id` partitioning; platform-level analytics stay aggregate-only.
- **Phase:** after sufficient data accrues (year 2); custom report builder earlier via [`../03-modules/reporting-analytics.md`](../03-modules/reporting-analytics.md) saved-report foundations.

## 10. Subscription / Billing Enhancements

- **What:** self-service plan changes, usage-based billing (SMS/AI token packs), proration, dunning automation, reseller/partner billing.
- **Extension point:** plans, quotas, usage tracking, and the tenant lifecycle state machine already live in [`../03-modules/platform-admin.md`](../03-modules/platform-admin.md); enhancements attach a billing provider (e.g. Stripe Billing — recommendation) to existing plan/usage records, and dunning drives the existing `PastDue → Suspended` transitions (multi-tenancy.md §7).
- **Phase:** manual invoicing at launch; self-service billing early Phase 7 as tenant count grows.

## Guardrails for All Future Work

1. New capabilities enter through the inventoried extension points; if one is missing, extend the architecture doc first (docs stay live — phase-plan.md §4.3).
2. Everything is flag-gated and plan-mappable from day one of its development.
3. Nothing may weaken the invariants: tenant isolation (SEC-03), append-only money (BR-03), permission-bound access (SEC-02), children's-data privacy (SEC-17).
4. Device/provider SDKs stay in adapters — the core domain never imports a vendor SDK.
