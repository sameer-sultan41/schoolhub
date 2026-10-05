---
name: schoolhub-api-services
description: Use when wiring a new backend API call into apps/dashboard — phrases like "call the students API", "add an endpoint for X", "wire up this module's API calls", "how do I fetch/create/update a <resource>", or any new file under `apps/dashboard/src/services/`. Also use when reviewing a dashboard PR that calls `apiClient` directly, imports `@schoolhub/api-client` outside `src/services/` or `src/lib/`, or hardcodes an API path string in a component. SKIP for apps/website (read-only, no API-calling layer) or apps/api (backend).
---

# SchoolHub Dashboard API Services Skill

## Purpose

`apps/dashboard` centralizes every backend API call behind one small, repeatable
five-file shape per domain: a path registry entry, a thin service file, its sibling
type/constant/helper/schema files, and an aggregated `Services` object. A component
never calls `apiClient` directly and never hardcodes a path string — it calls
`Services.<domain>.<action>(...)`. `students` and `staff` are the reference
implementations for a domain with real accumulated content in every file; `auth` is
the reference for a domain that's deliberately thin in two of them. Follow one of
these exact shapes for every new domain (academics, …) —
[ADR-0019](../../../docs/decisions/0019-every-module-uses-the-five-file-shape.md).

**Why this exists:** before this pattern, `apps/dashboard/src/lib/auth.ts` mixed two
unrelated things — the `ApiClient` transport wiring (token store, refresh-on-401,
cookies) and the actual auth API calls (`login`, `logout`, …), each with a hardcoded
path string (`"/login"`, `"/auth/me"`). That made the file's own boundary unclear and
meant every new module would either duplicate the mixing or invent its own convention.
Adapted from a reference pattern at a sibling project (endpoints file + per-domain
service file + aggregated `Services` object) — but **not a copy**: see "What this
skill deliberately does NOT do" below before reaching for something fancier.

## The five files, every time

```
apps/dashboard/src/services/
  endpoints.ts                        # one object, grouped by domain — path strings only
  index.ts                            # aggregates every domain into `Services`
  modules/
    <domain>/
      <domain>-service.ts             # apiClient calls only — imports its types from ./<domain>-type
      <domain>-type.ts                # domain types: the wire-shape alias (or a re-export,
                                       # for a domain with no generated one) + hand-written
                                       # input/query/view-model types
      <domain>-constant.ts            # cross-file magic strings/numbers and lookup objects
      <domain>-helper.ts              # pure mapper/formatter functions — no React, no API calls
      <domain>.schema.ts              # Zod schemas and their inferred form-values types
      index.ts                        # re-exports as `<Domain>Service`
      __tests__/
        <domain>-service.test.ts
```

Every domain gets all five files from the moment it's created — per
[ADR-0019](../../../docs/decisions/0019-every-module-uses-the-five-file-shape.md), not
once a concern accumulates enough to earn one. A domain with nothing yet to put in
`<domain>-constant.ts`/`<domain>-helper.ts` still creates it: a short header comment
saying so, plus `export {};` to keep it a valid module (`auth`'s own
`auth-constant.ts`/`auth-helper.ts` are exactly this). What goes in each file is
detailed step by step below.

### 1. Add the domain's paths to `src/services/endpoints.ts`

A path is a static string, or — when it needs a value only known at call time (an id,
a slug) — a function returning one:

```ts
export const endpoints = {
  auth: {
    login: "/login",
    logout: "/logout",
    me: "/auth/me",
    refresh: "/refresh",
  },
  students: {
    list: "/students",
    detail: (id: string) => `/students/${id}`,
    create: "/students",
  },
} as const;
```

Only add paths this app actually calls today. Don't pre-populate a domain "for later."

### 2. Create `src/services/modules/<domain>/<domain>-type.ts`

A domain with a generated wire shape type-aliases it here (`export type StudentRecord =
ApiSchemas["Student"]`), plus any hand-written input/query/view-model types. A domain
with no generated source (`auth`'s `AuthenticatedUser`/`LoginCredentials`/
`LoginResponse`) re-exports the real cross-cutting types from `@schoolhub/types`
instead — a named entry point, not a second definition:

```ts
// auth-type.ts — a domain with no generated wire shape
export type { AuthenticatedUser, LoginCredentials, LoginResponse } from "@schoolhub/types";
```

```ts
// students-type.ts — a domain with one, plus hand-written input types
export type StudentRecord = ApiSchemas["Student"];
export interface CreateStudentInput { /* ... */ }
```

**A domain's own wire shape is the generated `ApiSchemas["<Model>"]` type**
(`@schoolhub/api-client`) — never hand-written in `packages/types`
([ADR-0017](../../../docs/decisions/0017-generated-wire-types-for-new-domains.md)).
`packages/types` is for cross-cutting types with no generated source (the envelope/
pagination primitives, auth/RBAC, tenant/website) and small runtime value-arrays an
enum-backed `<Select>`/`z.enum(...)` needs.

### 3. Create `src/services/modules/<domain>/<domain>-constant.ts` and `<domain>-helper.ts`

Cross-file magic strings/lookup objects, and pure mapper/formatter functions,
respectively. `students` is the reference for a domain with real content in both —
`SORT_FIELD`, the `"active"`/`"all"` sentinels, `toStudentRow`, a shared
`copyMappedFields` loop (promoted to `src/lib/helpers.ts` once a second domain
needed it) driving `toStudentBody`/`toStudentsQueryParams`. `staff` shows a real
variant on the same idea: its body builder needs *two* field-inclusion predicates,
not students' one-predicate-for-everything case (`createStaff`/`updateStaff` gate a
"required-like" field group on truthiness and a genuinely-optional group on
`!== undefined`), expressed as one field list carrying an explicit per-row gate tag
(`STAFF_BODY_FIELDS`, each row `[camelKey, snakeKey, "truthy" | "defined"]`) rather
than two separate arrays whose gate was only implied by which array a field was
placed in.

A domain with nothing yet to put in one of these two files still creates it empty —
a short header comment explaining why, plus `export {};` to keep it a valid module.
`auth`'s own `auth-constant.ts`/`auth-helper.ts` are exactly this: every function in
`auth-service.ts` is an API call with a side effect, not a pure mapper, so there is
nothing to extract yet.

### 4. Create `src/services/modules/<domain>/<domain>.schema.ts`

Zod schemas and their inferred form-values types, if the domain's feature code has a
form. A domain with none yet (no form) still gets this file, empty, same as
`-constant.ts`/`-helper.ts`. A schema and its inferred type stay together here; form
*logic* built on top of a schema (defaults, record↔form-values mappers,
submit-payload builders) stays in its own feature file, importing the schema/type
rather than redeclaring it — splitting a schema from its own inferred type across
two files creates a circular-import risk this shape is meant to avoid.

### 5. Create `src/services/modules/<domain>/<domain>-service.ts`

Thin async functions, each one `apiClient` call, importing its types from
`./<domain>-type`. Real example — `auth-service.ts`:

```ts
import { ApiError } from "@schoolhub/api-client";
import { accessTokenStore, apiClient, authProxyClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type { AuthenticatedUser, LoginCredentials, LoginResponse } from "./auth-type";

export async function login(credentials: LoginCredentials): Promise<LoginResponse> {
  const { data } = await authProxyClient.post<LoginResponse>(endpoints.auth.login, credentials, {
    credentials: "include",
    skipAuthRefresh: true,
  });
  accessTokenStore.set(data.access_token, data.expires_in);
  return data;
}

export async function fetchCurrentUser(): Promise<AuthenticatedUser> {
  const { data } = await apiClient.get<AuthenticatedUser>(endpoints.auth.me, {
    credentials: "include",
  });
  return data;
}
```

Rules for this file:

- **Import `apiClient` from `@/lib/auth`** — never construct or import a client
  yourself. `lib/auth.ts` is the one place the `ApiClient` instance is wired
  (auth headers, refresh-on-401, error normalization already handled there).
- **Always pass an `endpoints.<domain>.*` reference as the path** — never a literal
  string. This is the single rule this whole pattern exists to enforce.
- **Return the unwrapped domain type** (`Promise<AuthenticatedUser>`, not
  `Promise<ApiResult<AuthenticatedUser>>`) — destructure `{ data }` out of the call and
  return `data`. Let a thrown `ApiError` propagate; don't catch-and-swallow unless the
  function has a real reason to (see `auth-service.ts`'s `logout()` for the one
  legitimate case: a failed logout must never trap the user in the app).

### 6. Re-export as `<Domain>Service` in `src/services/modules/<domain>/index.ts`

```ts
import { fetchCurrentUser, login, logout, restoreSession } from "./auth-service";

export const AuthService = {
  login,
  logout,
  fetchCurrentUser,
  restoreSession,
};
```

### 7. Register it in `src/services/index.ts`

```ts
import { AuthService } from "./modules/auth";
import { StudentsService } from "./modules/students"; // when this domain lands

export const Services = {
  auth: AuthService,
  students: StudentsService,
} as const;
```

### 8. Call it from a component or hook

```ts
import { Services } from "@/services";

const mutation = useMutation({ mutationFn: Services.auth.login });
const query = useQuery({
  queryKey: queryKeys.list("students", "students", filters),
  queryFn: () => Services.students.list(filters),
});
```

Never `import { apiClient } from "@/lib/auth"` from a component. For `instanceof` narrowing
on an error you already have, import `ApiError` from the services facade —
`import { ApiError, Services } from "@/services"` — never from `@schoolhub/api-client`. ESLint
enforces this for `src/app`, `src/features`, `src/components` and `src/hooks`; only
`src/services/**` and `src/lib/**` (the transport layer) import the client package (ADR-0011).

## Testing

Split the domain's tests the same way `auth` did: if the service file's own logic
needs mocking `@schoolhub/api-client`'s `createApiClient`, write
`services/modules/<domain>/__tests__/<domain>-service.test.ts` mocking `apiClient`'s
`post`/`get`/`put`/`patch`/`delete` methods directly and asserting the resolved
`endpoints.<domain>.*` string was actually used:

```ts
expect(mockPost).toHaveBeenCalledWith(
  "/login",
  { identifier: "admin", password: "secret" },
  expect.objectContaining({ credentials: "include" }),
);
```

Co-locate every test in a sibling `__tests__/` folder — `apps/dashboard/AGENTS.md`'s
convention, not a flat `*.test.ts` beside the source.

## Checklist for a new domain

1. `endpoints.ts` gets the domain's real paths (nothing speculative).
2. `services/modules/<domain>/<domain>-type.ts` — the domain's wire-shape alias
   (`ApiSchemas["<Model>"]`,
   [ADR-0017](../../../docs/decisions/0017-generated-wire-types-for-new-domains.md))
   or, for a domain with no generated source, a re-export of its real cross-cutting
   types from `@schoolhub/types` — plus any hand-written input/query/view-model types.
3. `services/modules/<domain>/<domain>-constant.ts` and `<domain>-helper.ts` — real
   content if the domain has any yet, otherwise each stays a short header comment
   plus `export {};`.
4. `services/modules/<domain>/<domain>.schema.ts` — real content if the domain has a
   form yet, otherwise the same empty-with-comment shape.
5. `services/modules/<domain>/<domain>-service.ts` — one function per API call,
   importing its types from `./<domain>-type`; every path from `endpoints.<domain>.*`.
6. `services/modules/<domain>/index.ts` re-exports as `<Domain>Service`.
7. `services/index.ts` registers it under `Services.<domain>`.
8. `services/modules/<domain>/__tests__/<domain>-service.test.ts` covers each
   function in `<domain>-service.ts`; a `<domain>-helper.test.ts` alongside it once
   `<domain>-helper.ts` has real functions to cover.
9. Every consumer calls `Services.<domain>.<action>(...)` — grep the repo for any
   remaining `apiClient.` or hardcoded path string in the domain's feature code before
   calling the work done; **also grep for any *existing* code that already imported a
   function you're relocating** (e.g. `import { logout } from "@/lib/auth"`) — a stale
   import of a moved function is a hard compile break that a search scoped only to the
   file you're editing will not catch. This exact mistake shipped once already: PR #74
   moved `logout` into `auth-service.ts` and missed a `user-dropdown-menu.tsx` call site
   that imported it from the old location — caught only by a follow-up code review, not
   by the original verification pass.
10. Update `apps/dashboard/AGENTS.md`'s "How This App Is Wired" table if this is a
    structurally new kind of concern (it usually isn't — most new domains need no doc
    change beyond what's already there).

## What this skill deliberately does NOT do

- **No `actions.ts` / `'use server'` split.** Nothing here needs that boundary yet — if
  a mutation genuinely needs to be a Server Action, that's a reason to revisit this,
  not a reason to pre-build it now.
- **No `[error, data]` tuple return.** This repo already throws `ApiError` and lets
  TanStack Query's own error channel (`isError`, `error`, `onError`) handle it — see
  `login-form.tsx`'s `mutation.error instanceof ApiError` pattern. A tuple return would
  be a second, competing error-handling convention for the exact same problem TanStack
  Query already solves.

If a future need genuinely outgrows this (a domain calling more than a handful of
endpoints, or a mutation that needs `'use server'`), revisit deliberately — don't
default into either pattern piecemeal.

## Related

- `apps/dashboard/src/services/modules/students/` — the reference implementation for
  a domain with real, accumulated content in all five files.
- `apps/dashboard/src/services/modules/staff/` — a second worked example, with the
  two-predicate `copyMappedFields` variant students didn't need.
- `apps/dashboard/src/services/modules/auth/` — the reference implementation for a
  domain that's deliberately thin: `auth-type.ts` and `auth.schema.ts` have real
  content, `auth-constant.ts`/`auth-helper.ts` are the empty-with-comment shape.
- [ADR-0019](../../../docs/decisions/0019-every-module-uses-the-five-file-shape.md) —
  why every domain gets all five files from creation.
- [ADR-0018](../../../docs/decisions/0018-per-module-file-split-for-growing-domains.md) —
  superseded by 0019, kept for the original per-file reasoning (what each file is for).
- `apps/dashboard/AGENTS.md` — "How This App Is Wired" and "Adding a Module Screen".
- `apps/dashboard/src/lib/auth.ts` — the transport/session infrastructure every
  service module builds on (the `apiClient` instance, token store, 401 handling).
- `packages/api-client/README.md` — explains why this layer lives in `apps/dashboard`
  and not in `packages/api-client` itself (that package reserves `src/resources/**` for
  a future *generated*, OpenAPI-driven layer — a hand-written one there would collide).
