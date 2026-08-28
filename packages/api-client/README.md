# @schoolhub/api-client

Typed fetch client for the SchoolHub REST API (`/api/v1`).

## ⚠️ This package is REGENERATED — do not hand-edit the resource layer

The backend (`schoolhub-api`) publishes **OpenAPI 3.1** (drf-spectacular) as a CI artifact per
environment. Frontend CI regenerates the **resource/operation layer** of this package — and the
request/response types in `@schoolhub/types` — from that spec. A contract change that breaks the
dashboard fails frontend CI *before* deploy: the spec is the inter-repo interface and is reviewed
like code (see `DOCS/docs/02-architecture/repo-structure.md` §6.1).

Until the generator is wired up, this package ships the **hand-written transport core only**.
The split is deliberate and must be preserved:

| Layer | File(s) | Generated? |
| ----- | ------- | ---------- |
| Transport core: envelope unwrapping, auth header, refresh-on-401, error normalization, pagination | `src/client.ts`, `src/errors.ts`, `src/pagination.ts`, `src/token-store.ts` | **No** — hand-written, stable |
| Resources: `students.list()`, `feeInvoices.create()`, … | `src/resources/**` (added by the generator) | **Yes** — overwritten on every regeneration |

If you need a request shape the client cannot express, change the transport core or the OpenAPI
spec. Never patch a generated file: the next `pnpm generate:api` erases it.

## Usage

```ts
import { createApiClient, ApiError } from "@schoolhub/api-client";

const api = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL!,
  getAccessToken: () => tokenStore.get(),
  refreshAccessToken: () => tokenStore.refresh(), // called once on a 401, then the call retries
});

const { data, meta } = await api.get<Student[]>("/students", {
  query: { search: "khan", page_size: 25 },
});
```

Errors always arrive as `ApiError`, normalized from the envelope
`{ error: { code, message, details, request_id } }` — including transport failures, which become
`code: "network_error"`. Render `error.code` and the field-level `details`; never invent a message
for a code the API already defines.

### Cursor pagination

```ts
import { paginate, collectPages } from "@schoolhub/api-client";

for await (const page of paginate<Student>(api, "/students", { query: { page_size: 100 } })) {
  // page.items, page.pagination.next_cursor
}

const all = await collectPages<Student>(api, "/students", { maxPages: 10 });
```

### Auth model

- `Authorization: Bearer <access token>` (15 min).
- The rotating refresh token lives in an **HttpOnly cookie** — the client never reads or writes
  it; it only calls the refresh endpoint with `credentials: "include"`.
- A single in-flight refresh is shared across concurrent 401s; if the refresh fails, the original
  `ApiError` propagates and `onUnauthorized` fires so the app can bounce to `/login`.
- Mutating money/side-effecting endpoints accept `idempotencyKey`, sent as `Idempotency-Key`.

### Server-side use

The client takes a `fetchImpl`, so a Next.js server component can pass a `fetch` carrying
`next: { revalidate, tags }` options. The public website renderer uses this with a **read-only
machine token** and never issues a non-GET request.
