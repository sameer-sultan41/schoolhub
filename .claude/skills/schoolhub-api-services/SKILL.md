---
name: schoolhub-api-services
description: Use when wiring a new backend API call into apps/dashboard — phrases like "call the students API", "add an endpoint for X", "wire up this module's API calls", "how do I fetch/create/update a <resource>", or any new file under `apps/dashboard/src/services/`. Also use when reviewing a dashboard PR that calls `apiClient` directly, imports `@schoolhub/api-client` outside `src/services/` or `src/lib/auth.ts`, or hardcodes an API path string in a component. SKIP for apps/website (read-only, no API-calling layer) or apps/api (backend).
---

# SchoolHub Dashboard API Services Skill

## Purpose

`apps/dashboard` centralizes every backend API call behind one small, repeatable
three-file shape per domain: a path registry, a thin service file, and an aggregated
`Services` object. A component never calls `apiClient` directly and never hardcodes a
path string — it calls `Services.<domain>.<action>(...)`. `auth` is the reference
implementation; follow its exact shape for every new domain (students, staff,
academics, …).

**Why this exists:** before this pattern, `apps/dashboard/src/lib/auth.ts` mixed two
unrelated things — the `ApiClient` transport wiring (token store, refresh-on-401,
cookies) and the actual auth API calls (`login`, `logout`, …), each with a hardcoded
path string (`"/login"`, `"/auth/me"`). That made the file's own boundary unclear and
meant every new module would either duplicate the mixing or invent its own convention.
Adapted from a reference pattern at a sibling project (endpoints file + per-domain
service file + aggregated `Services` object) — but **not a copy**: see "What this
skill deliberately does NOT do" below before reaching for something fancier.

## The three files, every time

```
apps/dashboard/src/services/
  endpoints.ts                        # one object, grouped by domain — path strings only
  index.ts                            # aggregates every domain into `Services`
  modules/
    <domain>/
      <domain>-service.ts             # the actual apiClient calls for this domain
      index.ts                        # re-exports as `<Domain>Service`
      __tests__/
        <domain>-service.test.ts
```

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

### 2. Create `src/services/modules/<domain>/<domain>-service.ts`

Thin async functions, each one `apiClient` call. Real example — `auth-service.ts`:

```ts
import { ApiError } from "@schoolhub/api-client";
import type { AuthenticatedUser, LoginCredentials, LoginResponse } from "@schoolhub/types";
import { accessTokenStore, apiClient, authProxyClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";

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
- **Types come from `packages/types`**, not a per-module `type.ts` file. If the
  domain's request/response shape doesn't exist there yet, add it there — that package
  is the one place domain types live in this repo, shared with anything else that
  might need them.

### 3. Re-export as `<Domain>Service` in `src/services/modules/<domain>/index.ts`

```ts
import { fetchCurrentUser, login, logout, restoreSession } from "./auth-service";

export const AuthService = {
  login,
  logout,
  fetchCurrentUser,
  restoreSession,
};
```

### 4. Register it in `src/services/index.ts`

```ts
import { AuthService } from "./modules/auth";
import { StudentsService } from "./modules/students"; // when this domain lands

export const Services = {
  auth: AuthService,
  students: StudentsService,
} as const;
```

### 5. Call it from a component or hook

```ts
import { Services } from "@/services";

const mutation = useMutation({ mutationFn: Services.auth.login });
const query = useQuery({
  queryKey: queryKeys.list("students", "students", filters),
  queryFn: () => Services.students.list(filters),
});
```

Never `import { apiClient } from "@/lib/auth"` from a component. Never
`import { ApiError } from "@schoolhub/api-client"` for anything other than `instanceof`
narrowing on an error you already have (that import is fine — it's not a call).

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
2. `services/modules/<domain>/<domain>-service.ts` — one function per API call, typed
   against `packages/types`, every path from `endpoints.<domain>.*`.
3. `services/modules/<domain>/index.ts` re-exports as `<Domain>Service`.
4. `services/index.ts` registers it under `Services.<domain>`.
5. `services/modules/<domain>/__tests__/<domain>-service.test.ts` covers each function.
6. Every consumer calls `Services.<domain>.<action>(...)` — grep the repo for any
   remaining `apiClient.` or hardcoded path string in the domain's feature code before
   calling the work done; **also grep for any *existing* code that already imported a
   function you're relocating** (e.g. `import { logout } from "@/lib/auth"`) — a stale
   import of a moved function is a hard compile break that a search scoped only to the
   file you're editing will not catch. This exact mistake shipped once already: PR #74
   moved `logout` into `auth-service.ts` and missed a `user-dropdown-menu.tsx` call site
   that imported it from the old location — caught only by a follow-up code review, not
   by the original verification pass.
7. Update `apps/dashboard/AGENTS.md`'s "How This App Is Wired" table if this is a
   structurally new kind of concern (it usually isn't — most new domains need no doc
   change beyond what's already there).

## What this skill deliberately does NOT do

Two things the reference pattern this was adapted from does, on purpose left out:

- **No per-module `type.ts`/`dal.ts`/`actions.ts` split.** This repo already keeps
  domain types in `packages/types` (shared across the whole monorepo, not just the
  dashboard) — duplicating that into a per-module `type.ts` would be two sources of
  truth for the same shape. `actions.ts`'s only reason to exist in the reference
  project was a Next.js `'use server'` directive boundary; nothing here needs that
  split yet — if a mutation genuinely needs to be a Server Action, that's a reason to
  revisit this, not a reason to pre-build it now.
- **No `[error, data]` tuple return.** This repo already throws `ApiError` and lets
  TanStack Query's own error channel (`isError`, `error`, `onError`) handle it — see
  `login-form.tsx`'s `mutation.error instanceof ApiError` pattern. A tuple return would
  be a second, competing error-handling convention for the exact same problem TanStack
  Query already solves.

If a future need genuinely outgrows this (a domain calling more than a handful of
endpoints, or a mutation that needs `'use server'`), revisit deliberately — don't
default into either pattern piecemeal.

## Related

- `apps/dashboard/src/services/modules/auth/` — the reference implementation.
- `apps/dashboard/AGENTS.md` — "How This App Is Wired" and "Adding a Module Screen".
- `apps/dashboard/src/lib/auth.ts` — the transport/session infrastructure every
  service module builds on (the `apiClient` instance, token store, 401 handling).
- `packages/api-client/README.md` — explains why this layer lives in `apps/dashboard`
  and not in `packages/api-client` itself (that package reserves `src/resources/**` for
  a future *generated*, OpenAPI-driven layer — a hand-written one there would collide).
