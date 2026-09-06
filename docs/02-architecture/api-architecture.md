# API Architecture

> **Agent Context**
> **Summary:** Compares REST, GraphQL, and hybrid approaches and selects **versioned REST with OpenAPI** for the platform API. Defines the cross-cutting API conventions every module doc's §16 relies on: auth, versioning, envelope, errors, pagination, filtering, rate limiting, idempotency, webhooks, uploads, background jobs.
> **Co-load with:** `auth-and-rbac.md` · `multi-tenancy.md` · the module doc whose endpoints you are building

## 1. Style Comparison

| Criterion | REST | GraphQL | Hybrid REST+GraphQL |
| --------- | ---- | ------- | ------------------- |
| Scalability | Excellent; straightforward HTTP caching & CDN | Requires persisted queries + complexity limits to stay safe | Both, at double the surface area |
| Maintainability | One resource model, mature DRF tooling | Schema + resolvers + N+1 discipline (dataloaders) | Two stacks to maintain and secure |
| Frontend needs | Dashboard screens map 1:1 to resources; TanStack Query handles caching | Wins when clients need arbitrary nested shapes | — |
| Mobile readiness | Fully sufficient; stable versioned contracts | Also fine | — |
| Reporting | Server-shaped report endpoints are safer for heavy aggregation | Ad-hoc nested queries risk unbounded cost | — |
| Security | Per-endpoint RBAC is simple to audit | Field-level authz is easy to get wrong in multi-tenant systems | Doubled audit surface |
| Caching | HTTP + Redis per endpoint | Client-side normalized caches only | — |
| Real-time | SSE/WebSocket side-channel (same for both) | Subscriptions add server complexity | — |
| 3rd-party integrations | Webhooks + REST is the industry default | Rarely expected by integrators | — |
| Developer experience | OpenAPI → generated TS types/clients | Strong typing too, but higher setup cost | — |

**Decision (recommendation): versioned REST + OpenAPI 3.1.** The clients are known and few (dashboard, tenant websites, future mobile), screens map cleanly to resources, and per-endpoint RBAC auditing matters more in a multi-tenant school system than ad-hoc query flexibility. GraphQL is explicitly deferred; the layered backend (views → services → ORM) keeps the door open to adding a GraphQL read gateway later without rework.

## 2. Conventions

### 2.1 Base URL & Versioning
- `https://api.<platform-domain>/api/v1/...` — URI-versioned. Breaking changes → `v2`; additive changes never bump the version.
- Tenant resolution is **never** part of the path — it comes from the authenticated context (see [`multi-tenancy.md`](multi-tenancy.md)).

### 2.2 Authentication & Authorization
- `Authorization: Bearer <JWT access token>` (15 min) + rotating refresh token (30 days, revocable). Refresh in an HttpOnly cookie for web, secure storage for future mobile.
- Every request resolves `(user, tenant, roles, permissions)`; endpoint guards check `module.resource.action` permission keys per [`auth-and-rbac.md`](auth-and-rbac.md).
- Service-to-service calls (website renderer → API) use scoped machine tokens with read-only public-content permissions.

### 2.3 Response Envelope & Errors
```json
// success
{ "data": { ... }, "meta": { "pagination": { ... } } }
// error (RFC 9457 problem-details style)
{ "error": { "code": "validation_error", "message": "…", "details": [{ "field": "email", "issue": "…" }], "request_id": "…" } }
```

`error.meta` is an optional fifth key, present only when a failure carries context a client has to *act* on rather than display. `details` is a flat list of `{field, issue}` strings and the handler flattens any nested value into it one leaf at a time — right for field errors, destructive for anything with shape. A timetable publish refusal returns every clashing cell so the grid can highlight both sides of a double booking; as `details` that arrived as `conflicts[0].slot_ids` repeated once per id, of which a client keeping the first issue per field name retains only one. Raise `DomainRuleViolation(detail, meta={...})` to use it; the payload passes through as JSON untouched, and its shape belongs to the endpoint, not the envelope.

- Status codes: 200/201/204 success; 400 validation; 401 unauthenticated; 403 permission/tenant denial; 404 not-found **and** cross-tenant access (never reveal existence); 409 conflict; 422 domain-rule violation; 429 rate-limited; 5xx server.
- Every response carries `X-Request-ID` for log correlation.

### 2.4 Pagination, Filtering, Sorting
- Cursor pagination is the default (`?cursor=…&page_size=25`, max 100). Offset pagination (`?page=…&page_size=…`) is allowed only on small admin lists — sets bounded by one school's size, which a person navigates by position rather than by scrolling. A cursor knows what comes next but never where it is, so a page number is the one thing it cannot report.
- **The admin lists that page by number** (`PageNumberPagination`, `meta.pagination` = `{page, page_size, total_count, total_pages}`): `/students`, `/staff`, `/designations`, `/campuses`, `/departments`, `/classes`, `/sections`, `/subjects`, `/houses`, `/rooms`, `/periods`, `/teacher-substitutions`, `/class-subjects`, `/teacher-subject-allocations`, `/student-promotions`. Everything else keeps the cursor — in particular the append-heavy tables (attendance marks, ledger entries, notification deliveries) where an offset scan degrades and can skip or repeat rows under concurrent writes.
- `meta.pagination.total_count` on a **cursor** endpoint stays **opt-in** (`CountedCursorPagination`), because cursor pagination is chosen precisely for never counting. A cursor endpoint that does not count **omits** the key rather than sending null, so a client can tell "this endpoint reports no total" from "the total is unknown". A page-numbered endpoint always reports one — it had to count to know `total_pages`.
- Any ordering is made total by appending the primary key (`core.api.filters.StableOrderingFilter`). A cursor adopts the requested ordering as its key, and a non-unique key lets a page boundary resume in the wrong place; the tiebreaker is what makes the sequence repeatable.
- Filtering: `?field=value`, `?field__gte=…`, `?search=` for text; each endpoint whitelists its filterable fields (documented in the module's §16).
- Sorting: `?ordering=-created_at,name`, whitelisted per endpoint.

### 2.5 Rate Limiting & Idempotency
- Redis token-bucket per user and per tenant (defaults: 60 r/min user, 600 r/min tenant; auth endpoints stricter). `429` + `Retry-After`.
- Mutating endpoints with money or external side effects (fee payments, notification sends, admissions submissions) accept an `Idempotency-Key` header; the key + response are stored 24 h and replayed on retry.

### 2.6 Webhooks
- Outbound webhooks per tenant for events (e.g. `student.enrolled`, `fee.paid`, `result.published`): HMAC-SHA256 signature header, at-least-once delivery, exponential-backoff retries (max 8), dead-letter list visible to tenant admins.

### 2.7 Background Jobs
- Long operations (bulk imports, report generation, notification blasts, AI batch jobs) return `202 Accepted` + a `job` resource: `GET /api/v1/jobs/{id}` → `queued | running | succeeded | failed` with progress and result link. Executed by Celery (see [`tech-stack.md`](tech-stack.md)).

### 2.8 File Uploads
- Two-step: `POST /api/v1/files` → presigned S3 URL + file record (`pending`); client uploads directly to storage; confirmation webhook/poll flips it to `ready`. Server-side validation of type/size/AV-scan per [`../06-security/security.md`](../06-security/security.md). Files are tenant-scoped and served via short-lived signed URLs.

### 2.9 API Documentation
- OpenAPI 3.1 generated from code (drf-spectacular), published per environment; TypeScript client types generated in CI into the frontend monorepo.

## 3. Real-time (initial scope)
- In-app notification badge + live dashboards use SSE (`GET /api/v1/events/stream`); WebSockets deferred until a feature (e.g. live transport tracking, §21) requires bidirectional traffic.

## 4. Endpoint Naming Rules (used by every module doc §16)
- Plural kebab-case resources: `/api/v1/fee-invoices`, `/api/v1/students/{id}/guardians`.
- Sub-resources max one level deep; deeper relations get top-level resources with filters.
- Non-CRUD domain actions are explicit verbs on the resource: `POST /api/v1/students/{id}:promote`, `POST /api/v1/results/{id}:publish` (colon-action style), always permission-guarded and audited.
