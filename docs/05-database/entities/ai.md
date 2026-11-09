# Entities: AI Gateway

> **Agent Context** — Load this block first.
> **Summary:** Column-level specs for the AI gateway's audit tables: `ai_requests` (one row per gateway call, whatever its outcome) and `ai_request_feedback` (a thumbs up or down on one output). Both are tenant-owned, **append-only** (`AppendOnlyTenantModel`: no `updated_*`, no `deleted_at`, `UPDATE`/`DELETE` revoked from the app role) and isolated by RLS. They hold references and counts, never prompt or answer text ([`../../04-ai/ai-governance.md`](../../04-ai/ai-governance.md) §1.6, §9). Built in `apps/api/core/ai/models.py`; the shape of the gateway is [ADR-0035](../../decisions/0035-ai-gateway-shape.md).
> **Co-load with:** [`../../02-architecture/ai-architecture.md`](../../02-architecture/ai-architecture.md) · [`../../04-ai/ai-governance.md`](../../04-ai/ai-governance.md) · [`tenancy.md`](tenancy.md) (users, `tenant_settings.ai`)

### ai_requests

One gateway call. Written once, at the end of `core.ai.service.run_feature`, in its own transaction,
so a refused call (403, 429, 503) still leaves its row. The budget meter sums the four token columns.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| user_id | uuid | no | — | The user who asked; `users.id` without a FK, as on other audit tables |
| feature_key | varchar(60) | no | — | The registered feature, e.g. `fees.report-summary` |
| prompt_version | varchar(40) | no | — | e.g. `fees.report-summary@1` (ai-governance §6) |
| model | varchar(60) | no | `''` | The model that answered; empty when no call was made |
| input_ref | varchar(200) | no | — | A reference to the input, never the input: `sha256:<hex>` of the context sent |
| output_ref | varchar(200) | no | `''` | `sha256:<hex>` of the raw answer; empty when no call was made |
| input_tokens | integer ≥ 0 | no | `0` | |
| output_tokens | integer ≥ 0 | no | `0` | |
| cache_creation_input_tokens | integer ≥ 0 | no | `0` | Billed, so metered |
| cache_read_input_tokens | integer ≥ 0 | no | `0` | Billed, so metered |
| latency_ms | integer ≥ 0 | no | `0` | Whole call, gates included |
| outcome | varchar(20) | no | — | Enum: `ok`, `fallback` (provider failed or not configured), `refused` (stop reason or validator), `quota`, `disabled` |
| created_at | timestamptz | no | `now()` | Explicit, not auto: the budget windows read it in the tenant's timezone |

Indexes: `(tenant_id, created_at)`; `(tenant_id, user_id, created_at)`.
Relationships: 1:1 `ai_request_feedback`.

### ai_request_feedback

A thumbs up or down on one output, by the user who asked (ai-governance §6). One per request; a
second vote is `409`.

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| ai_request_id | uuid | no | — | FK → `ai_requests.id`, unique, `PROTECT` |
| user_id | uuid | no | — | Must be the request's own user |
| value | smallint | no | — | `-1` or `1` (CHECK `ai_request_feedback_value_check`) |
| comment | varchar(500) | no | `''` | Stored for prompt review; never sent to a provider |
| created_at | timestamptz | no | `now()` | |

Indexes: unique(`ai_request_id`).
Relationships: N:1 `ai_requests`.
