# Real Login Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first real (non-demo) page in `apps/dashboard`: a `/login` page that renders with Metronic's visual polish and calls the actual backend auth API (`POST /api/v1/auth/login` via this app's own `/api/auth/*` proxy), replacing the throwaway `/dashboard` Metronic-sample-data preview's login-adjacent stubs with working code.

**Architecture:** `apps/dashboard/src` was deleted wholesale earlier on this branch (see root git history). Everything this plan restores — `lib/constants.ts`, `lib/env.ts`, `lib/host.ts`, `lib/query-client.ts`, `lib/auth.ts`, and the `(auth)` route group — is proven, already-tested logic from before that deletion (commit `d74f0f5` and earlier), untouched by the Metronic work since only `apps/dashboard/src` was ever deleted, never `packages/api-client` or `packages/types`. Restore it close to verbatim. The one genuinely new piece is `features/auth/login-form.tsx`: same real validation/submit/error-mapping logic as before, restyled with Metronic's password show/hide toggle and spacing conventions, with the NextAuth/Google/demo-credentials/sign-up bits from Metronic's own vendor sign-in page dropped since none of them apply to this product.

**Tech Stack:** Next.js 16 App Router, next-intl (real per-locale message loading, not the Metronic-preview's `messages: {}` stub), TanStack Query, React Hook Form + Zod, `@schoolhub/api-client`/`@schoolhub/types` (untouched, already implement the full auth contract).

**Spec:** `apps/dashboard/AGENTS.md` (stack rules, route-group convention, auth wiring table); `packages/types/src/auth.ts` (the API contract this plan wires against); the deleted-but-recoverable pre-`d74f0f5`-deletion source, read via `git show d74f0f5:<path>` throughout this plan.

## Global Constraints

- **Never run Jest, `tsc`, or lint locally** (root `CLAUDE.md`, standing instruction) — every task below writes both the implementation and its test together, then commits (pre-commit hooks run lint/format/cspell, not Jest) and relies on CI to run the actual test suite. Do not run `pnpm test` or `jest` yourself unless the user asks for that by name in a later message.
- Every user-facing string goes through `next-intl` messages — no hardcoded English (`apps/dashboard/AGENTS.md` hard rule). `messages/en.json` and `messages/ur.json` already carry every key this plan needs (verified: `auth.login.*`, `auth.session.*`, `errors.*`, `app.name`, `app.tagline` — see Task 4).
- Access token in memory only, refresh token in an HttpOnly cookie via the same-origin `/api/auth/*` proxy (already wired in `next.config.ts`, untouched) — never localStorage, never a JS-readable cookie for the access token itself (`apps/dashboard/AGENTS.md`).
- Don't touch `packages/ui`, `packages/api-client`, `packages/types`, or `apps/website` — this plan only adds/restores files under `apps/dashboard/src`.
- Route convention: unauthenticated routes under `src/app/(auth)/…`, matching `apps/dashboard/AGENTS.md`'s table.
- **Out of scope for this plan** (small chunks, per the user's request — later chunks): `src/proxy.ts` (the route guard that redirects an anonymous visitor to `/login` and a signed-in one away from it), `/forgot-password` and `/reset-password` pages (linked from the login form but not built yet — the link is present and inert until then, same as it was before), tenant branding on the login screen, and gating `/dashboard` itself behind a session check. This plan makes `/login` a real, working, reachable page; it does not yet make it the *only* way in.

---

### Task 1: Restore `lib/constants.ts`, `lib/env.ts`, `lib/host.ts`

**Files:**
- Create: `apps/dashboard/src/lib/constants.ts`
- Create: `apps/dashboard/src/lib/env.ts`
- Test: `apps/dashboard/src/lib/env.test.ts`
- Create: `apps/dashboard/src/lib/host.ts`
- Test: `apps/dashboard/src/lib/host.test.ts`

**Interfaces:**
- Produces: `LOGIN_PATH`, `PLATFORM_NAME`, `TABLET_BREAKPOINT_PX`, `DEFAULT_QUERY_STALE_TIME_MS`, `DEFAULT_QUERY_GC_TIME_MS`, `SESSION_QUERY_STALE_TIME_MS`, `TENANT_QUERY_STALE_TIME_MS`, `SEARCH_DEBOUNCE_MS`, `LOCALE_COOKIE_NAME`, `LOCALE_COOKIE_MAX_AGE_SECONDS` (all `string`/`number` constants) from `./constants`; `env` (parsed public config object), `SUPPORTED_LOCALES`, `SupportedLocale`, `isSupportedLocale(value: string): value is SupportedLocale`, `directionFor(locale: string): "ltr" | "rtl"` from `./env`; `parseTenantSlug(hostname: string, platformDomain: string): string | null` from `./host`. Tasks 2–5 import all of these.

- [ ] **Step 1: Create `lib/constants.ts`**

```ts
/** Route the app treats as the sign-in destination — checked by proxy.ts's public-path
 * allowlist and used as the redirect target after logout or a lost session. */
export const LOGIN_PATH = "/login";

/** Fallback shown wherever a tenant name would otherwise go before one is known (e.g. the
 * unauthenticated shell, or the browser tab title). */
export const PLATFORM_NAME = "SchoolHub";

/** Mirrors Tailwind's `md` breakpoint (unchanged in this repo's config). Named so a future
 * breakpoint change has one place to update instead of a silent drift between the two. */
export const TABLET_BREAKPOINT_PX = 768;

/**
 * Query cache durations. Each name reflects what the duration actually governs, even
 * where two happen to share a numeric value today (SESSION_QUERY_STALE_TIME_MS and
 * DEFAULT_QUERY_GC_TIME_MS) — coincidence, not a shared concern, so they stay separate
 * constants rather than one that would misrepresent either call site if it changed.
 */
export const DEFAULT_QUERY_STALE_TIME_MS = 30_000;
export const DEFAULT_QUERY_GC_TIME_MS = 5 * 60_000;
export const SESSION_QUERY_STALE_TIME_MS = 5 * 60_000;
export const TENANT_QUERY_STALE_TIME_MS = 10 * 60_000;

/**
 * Debounce window for every list screen's search input — long enough to skip most
 * keystrokes, short enough that the result still feels live.
 *
 * One constant rather than the per-module copies students and staff each kept: the
 * feel of a search box is a property of the app, not of the roster it happens to be
 * searching, and two constants meant two places to change it and one place to forget.
 */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * Cookie next-intl resolves the locale from (`src/i18n/request.ts`).
 *
 * It lives here rather than beside that resolver because both a server module and a
 * client one need the name: `i18n/request.ts` imports `next/headers` and is server-only,
 * so a client component importing the constant from there is a build error rather than a
 * bundle-size question. One definition, imported both ways, beats two strings that must
 * silently agree.
 */
export const LOCALE_COOKIE_NAME = "sh_locale";

/** A year: a language choice is not a session, and should outlive one. */
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
```

- [ ] **Step 2: Create `lib/env.ts`**

```ts
import { z } from "zod";

/**
 * Build/runtime configuration, validated once at module load.
 *
 * Only `NEXT_PUBLIC_*` values may appear here — everything sensitive stays server-side
 * (repo-structure.md §4). `process.env.X` must be referenced literally so Next can inline
 * the value at build time; a dynamic lookup would resolve to `undefined` in the browser.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.url({
    error: "NEXT_PUBLIC_API_BASE_URL must be an absolute URL, e.g. https://api.example.com/api/v1",
  }),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_DEFAULT_LOCALE: z.string().min(2).default("en"),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  /** Apex domain for tenant wildcard subdomains: `<slug>.<platform-domain>:3000`. */
  NEXT_PUBLIC_PLATFORM_DOMAIN: z.string().min(1),
});

const parsed = publicEnvSchema.safeParse({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_DEFAULT_LOCALE: process.env.NEXT_PUBLIC_DEFAULT_LOCALE,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_PLATFORM_DOMAIN: process.env.NEXT_PUBLIC_PLATFORM_DOMAIN,
});

if (!parsed.success) {
  // Fail loudly at boot rather than with a confusing 404 on the first API call.
  throw new Error(`Invalid dashboard environment configuration:\n${z.prettifyError(parsed.error)}`);
}

export const env = parsed.data;

/** Locales shipped at launch; a tenant may enable a subset (tech-stack.md §3). */
export const SUPPORTED_LOCALES = ["en", "ur"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Urdu is RTL; layouts must use logical properties so this is the only switch needed. */
export function directionFor(locale: string): "ltr" | "rtl" {
  return locale === "ur" ? "rtl" : "ltr";
}
```

**Note:** `jest.setup.ts` (already present, untouched) sets `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_APP_URL`, and `NEXT_PUBLIC_PLATFORM_DOMAIN` test defaults already — no test env file to create.

- [ ] **Step 3: Create `lib/env.test.ts`**

```ts
import { directionFor, env, isSupportedLocale, SUPPORTED_LOCALES } from "./env";

describe("env", () => {
  it("parses the test environment's public config", () => {
    expect(env.NEXT_PUBLIC_API_BASE_URL).toBe("https://api.test.invalid/api/v1");
    expect(env.NEXT_PUBLIC_PLATFORM_DOMAIN).toBe("schoolhub.test");
  });

  it("fails loudly at import time when the config is invalid", async () => {
    const original = process.env.NEXT_PUBLIC_API_BASE_URL;
    process.env.NEXT_PUBLIC_API_BASE_URL = "not-a-url";
    jest.resetModules();

    await expect(import("./env")).rejects.toThrow("Invalid dashboard environment configuration");

    process.env.NEXT_PUBLIC_API_BASE_URL = original;
    jest.resetModules();
  });
});

describe("SUPPORTED_LOCALES", () => {
  it("ships English and Urdu", () => {
    expect(SUPPORTED_LOCALES).toEqual(["en", "ur"]);
  });
});

describe("isSupportedLocale", () => {
  it("accepts a shipped locale", () => {
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("ur")).toBe(true);
  });

  it("rejects an unshipped locale", () => {
    expect(isSupportedLocale("fr")).toBe(false);
  });
});

describe("directionFor", () => {
  it("is rtl for Urdu", () => {
    expect(directionFor("ur")).toBe("rtl");
  });

  it("is ltr for every other locale", () => {
    expect(directionFor("en")).toBe("ltr");
    expect(directionFor("fr")).toBe("ltr");
  });
});
```

- [ ] **Step 4: Create `lib/host.ts`**

```ts
/**
 * Tenant-subdomain parsing for the dashboard login flow.
 *
 * Deliberately a separate, smaller copy of apps/website/src/lib/host.ts rather than a
 * shared import — this repo's own convention keeps each app's `lib/` self-contained (see
 * PLATFORM_NAME in apps/website vs. apps/dashboard). The dashboard has no "custom domain"
 * concept: tenants get a custom domain for their public site only, never for staff login.
 *
 * Tenant hosts live under `app.<platform_domain>`, NOT bare `<platform_domain>` — e.g.
 * `cityschool.app.schoolhub.example`, not `cityschool.schoolhub.example`. That's a
 * deliberate, different wildcard from the website's own `<slug>.<platform_domain>`: the
 * two apps can't both claim the same wildcard (infra/terraform/envs/production/main.tf's
 * comment on the website's ALB rule explains why — a shared wildcard would make one
 * service's host rule swallow the other's traffic). Reserving the `app.` prefix for the
 * dashboard is what lets its own ALB rule (`module "dashboard"`, same Terraform file)
 * match tenant dashboard hosts before they'd otherwise fall through to the website's
 * wider rule.
 */

const PORT_SUFFIX_PATTERN = /:\d+$/;

/** `<platform_domain>` alone is the website's apex/landing page — never a dashboard host. */
function dashboardApex(platformDomain: string): string {
  return `app.${platformDomain.trim().toLowerCase()}`;
}

/**
 * `demo.app.localhost` (platformDomain="localhost")  -> "demo"
 * `app.localhost`                                    -> null (generic login, no tenant)
 * `localhost` (bare, no "app." prefix)                -> null (local-dev convenience only;
 *                                                         production never routes this host
 *                                                         to the dashboard at all)
 * `a.b.app.localhost` (more than one label)            -> null (not a recognized tenant host)
 */
export function parseTenantSlug(hostname: string, platformDomain: string): string | null {
  const host = hostname.trim().toLowerCase().replace(PORT_SUFFIX_PATTERN, "");
  const apex = dashboardApex(platformDomain);

  if (host === apex) return null;
  if (!host.endsWith(`.${apex}`)) return null;

  const label = host.slice(0, -(apex.length + 1));
  if (label.length === 0 || label.includes(".")) return null;

  return label;
}
```

- [ ] **Step 5: Create `lib/host.test.ts`**

```ts
import { parseTenantSlug } from "./host";

describe("parseTenantSlug", () => {
  const PLATFORM = "localhost";

  it("resolves a tenant subdomain under app.<platform-domain>", () => {
    expect(parseTenantSlug("demo.app.localhost", PLATFORM)).toBe("demo");
  });

  it("strips a port before matching", () => {
    expect(parseTenantSlug("demo.app.localhost:3000", PLATFORM)).toBe("demo");
  });

  it("is case-insensitive", () => {
    expect(parseTenantSlug("Demo.App.Localhost", PLATFORM)).toBe("demo");
  });

  it("returns null for the bare dashboard apex (generic login)", () => {
    expect(parseTenantSlug("app.localhost", PLATFORM)).toBeNull();
  });

  it("returns null for a bare host with no app. prefix", () => {
    expect(parseTenantSlug("localhost", PLATFORM)).toBeNull();
  });

  it("returns null for a host outside the dashboard apex entirely", () => {
    expect(parseTenantSlug("demo.example.com", PLATFORM)).toBeNull();
  });

  it("returns null for more than one label before the apex", () => {
    expect(parseTenantSlug("a.b.app.localhost", PLATFORM)).toBeNull();
  });

  it("returns null for an empty label", () => {
    expect(parseTenantSlug(".app.localhost", PLATFORM)).toBeNull();
  });
});
```

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/lib/constants.ts apps/dashboard/src/lib/env.ts apps/dashboard/src/lib/env.test.ts apps/dashboard/src/lib/host.ts apps/dashboard/src/lib/host.test.ts
git commit -m "feat(dashboard): restore constants, env, and host config

Foundational config layer the login page and its plumbing depend on —
restored verbatim from before apps/dashboard/src was deleted; unrelated
to the Metronic preview work."
```

---

### Task 2: Restore `lib/query-client.ts`

**Files:**
- Create: `apps/dashboard/src/lib/query-client.ts`
- Test: `apps/dashboard/src/lib/query-client.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_QUERY_GC_TIME_MS`, `DEFAULT_QUERY_STALE_TIME_MS` from `./constants` (Task 1).
- Produces: `shouldRetry(failureCount: number, error: unknown): boolean`, `makeQueryClient(): QueryClient`, `getQueryClient(): QueryClient`, `queryKeys` (object with `session()`, `tenant()`, `module(module: string)`, `list(module: string, resource: string, params?: Record<string, unknown>)`, `detail(module: string, resource: string, id: string)`) — Task 5's login form uses `getQueryClient()` and `queryKeys.session()`.

- [ ] **Step 1: Create `lib/query-client.ts`**

```ts
import { ApiError } from "@schoolhub/api-client";
import { QueryClient, defaultShouldDehydrateQuery } from "@tanstack/react-query";
import { DEFAULT_QUERY_GC_TIME_MS, DEFAULT_QUERY_STALE_TIME_MS } from "@/lib/constants";

/**
 * TanStack Query owns all server state (tech-stack.md §3).
 *
 * Retry policy is deliberate: a 4xx from the API is an answer, not a blip — retrying a 403 or
 * a 422 just delays the error the user needs to see. Only transport failures and 5xx retry.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (error instanceof ApiError) return error.isTransient;
  return false;
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Long enough that a server-rendered payload is not refetched on hydration.
        staleTime: DEFAULT_QUERY_STALE_TIME_MS,
        gcTime: DEFAULT_QUERY_GC_TIME_MS,
        retry: shouldRetry,
        refetchOnWindowFocus: false,
        throwOnError: false,
      },
      mutations: {
        // Never auto-retry a mutation: money and side-effecting endpoints are
        // idempotency-keyed server-side, and a blind retry can double-submit the rest.
        retry: false,
      },
      dehydrate: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === "pending",
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * One client per request on the server, one shared client in the browser — the standard
 * App Router pattern. A module-level singleton on the server would leak one tenant's data
 * into another tenant's request.
 */
export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

/**
 * Query-key factory. Keys start with the module so a mutation can invalidate a whole
 * module's cache without knowing every screen that reads it.
 */
export const queryKeys = {
  session: () => ["session"] as const,
  tenant: () => ["tenant"] as const,
  module: (module: string) => [module] as const,
  list: (module: string, resource: string, params?: Record<string, unknown>) =>
    [module, resource, "list", params ?? {}] as const,
  detail: (module: string, resource: string, id: string) =>
    [module, resource, "detail", id] as const,
};
```

- [ ] **Step 2: Create `lib/query-client.test.ts`**

```ts
import { ApiError } from "@schoolhub/api-client";
import { getQueryClient, makeQueryClient, queryKeys } from "./query-client";

function makeApiError(status: number): ApiError {
  return new ApiError({ code: "x", message: "x", status, url: "/x" });
}

describe("makeQueryClient retry policy", () => {
  function retry(failureCount: number, error: unknown): boolean {
    const client = makeQueryClient();
    const shouldRetry = client.getDefaultOptions().queries?.retry;
    if (typeof shouldRetry !== "function") throw new Error("retry must be a function");
    return shouldRetry(failureCount, error as never);
  }

  it("never retries past two attempts", () => {
    expect(retry(2, makeApiError(500))).toBe(false);
  });

  it("retries a transport failure (status 0)", () => {
    expect(retry(0, makeApiError(0))).toBe(true);
  });

  it("retries a 5xx server error", () => {
    expect(retry(0, makeApiError(503))).toBe(true);
  });

  it("retries a 429 rate-limit", () => {
    expect(retry(0, makeApiError(429))).toBe(true);
  });

  it("does not retry a 4xx client error", () => {
    expect(retry(0, makeApiError(403))).toBe(false);
    expect(retry(0, makeApiError(422))).toBe(false);
  });

  it("does not retry a non-ApiError", () => {
    expect(retry(0, new Error("boom"))).toBe(false);
  });

  it("never retries a mutation", () => {
    const client = makeQueryClient();
    expect(client.getDefaultOptions().mutations?.retry).toBe(false);
  });
});

describe("dehydrate.shouldDehydrateQuery", () => {
  function shouldDehydrate(status: string): boolean {
    const client = makeQueryClient();
    const fn = client.getDefaultOptions().dehydrate?.shouldDehydrateQuery;
    if (typeof fn !== "function") throw new Error("shouldDehydrateQuery must be a function");
    return fn({ state: { status } } as never);
  }

  it("also dehydrates a still-pending query, not just successful ones", () => {
    expect(shouldDehydrate("pending")).toBe(true);
  });

  it("does not dehydrate an errored query", () => {
    expect(shouldDehydrate("error")).toBe(false);
  });
});

describe("getQueryClient", () => {
  it("returns the same instance across calls in the browser", () => {
    const first = getQueryClient();
    const second = getQueryClient();
    expect(first).toBe(second);
  });
});

describe("queryKeys", () => {
  it("builds stable, module-first keys", () => {
    expect(queryKeys.session()).toEqual(["session"]);
    expect(queryKeys.tenant()).toEqual(["tenant"]);
    expect(queryKeys.module("fees")).toEqual(["fees"]);
    expect(queryKeys.list("fees", "invoices")).toEqual(["fees", "invoices", "list", {}]);
    expect(queryKeys.list("fees", "invoices", { status: "overdue" })).toEqual([
      "fees",
      "invoices",
      "list",
      { status: "overdue" },
    ]);
    expect(queryKeys.detail("fees", "invoices", "inv-1")).toEqual([
      "fees",
      "invoices",
      "detail",
      "inv-1",
    ]);
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/lib/query-client.ts apps/dashboard/src/lib/query-client.test.ts
git commit -m "feat(dashboard): restore the TanStack Query client and key factory"
```

---

### Task 3: Restore `lib/auth.ts`

**Files:**
- Create: `apps/dashboard/src/lib/auth.ts`
- Test: `apps/dashboard/src/lib/auth.test.ts`

**Interfaces:**
- Consumes: `env` from `./env` (Task 1); `createAccessTokenStore`, `createApiClient`, `refreshAccessToken`, `ApiClient`, `ApiError` from `@schoolhub/api-client` (untouched); `AuthenticatedUser`, `LoginCredentials`, `LoginResponse` from `@schoolhub/types` (untouched).
- Produces: `SESSION_COOKIE_NAME` (string), `accessTokenStore` (`AccessTokenStore`), `apiClient` (`ApiClient`), `setUnauthorizedHandler(handler: (error: ApiError) => void): void`, `login(credentials: LoginCredentials): Promise<LoginResponse>`, `logout(): Promise<void>`, `fetchCurrentUser(): Promise<AuthenticatedUser>`, `restoreSession(): Promise<AuthenticatedUser | null>`. Task 5's login form calls `login`.

- [ ] **Step 1: Create `lib/auth.ts`**

```ts
import {
  type ApiClient,
  ApiError,
  createAccessTokenStore,
  createApiClient,
  refreshAccessToken,
} from "@schoolhub/api-client";
import type { AuthenticatedUser, LoginCredentials, LoginResponse } from "@schoolhub/types";
import { env } from "./env";

/**
 * Dashboard auth wiring (auth-and-rbac.md §1).
 *
 * - The **access token** (15 min) lives in memory only — never localStorage, never a
 *   readable cookie — so an XSS bug cannot exfiltrate a long-lived credential.
 * - The **refresh token** (30 days, rotating) is an HttpOnly SameSite cookie set by the API.
 *   JavaScript never touches it; `credentials: "include"` is what sends it. Login, refresh,
 *   and logout go through this app's own `/api/auth/*` proxy (see AUTH_PROXY_BASE_URL below)
 *   rather than calling the API directly, so the cookie is always same-origin.
 * - A 401 triggers exactly one refresh, shared across concurrent requests, then the original
 *   request replays. A refresh that comes back 401/403 means the session is over: clear
 *   state and bounce to /login. A refresh that is throttled, 5xx or unreachable means
 *   nothing of the sort — that error propagates and the session is left intact.
 *
 * The same endpoints serve future mobile clients with secure storage instead of a cookie —
 * no web-only shortcut is introduced here.
 */

/** Presence-only hint the proxy reads; the API remains the authority. */
export const SESSION_COOKIE_NAME = "sh_session";

/** Mirrors the API's refresh-token lifetime (SIMPLE_JWT.REFRESH_TOKEN_LIFETIME). */
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Set/cleared here, not by the API: once tenant subdomains are in play the dashboard's
 * own host (`<slug>.<platform-domain>`) is never the same host as the API's, so the API
 * would need an explicit cross-host `Domain` to share this cookie — which browsers
 * reject outright when the platform domain has no dot, as "localhost" does in local dev
 * (RFC 6265's public-suffix check treats a single-label host as its own effective TLD,
 * the same rule that blocks `Domain=.com`). Setting it from JS already running on
 * whichever host the browser is on sidesteps that entirely, in every environment.
 */
function setSessionCookie(): void {
  document.cookie = `${SESSION_COOKIE_NAME}=1; path=/; max-age=${SESSION_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

function clearSessionCookie(): void {
  document.cookie = `${SESSION_COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
}

export const accessTokenStore = createAccessTokenStore();

type UnauthorizedHandler = (error: ApiError) => void;

let onUnauthorized: UnauthorizedHandler = () => {
  accessTokenStore.clear();
};

/** Lets the app shell redirect to /login when the session is truly over. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
  onUnauthorized = handler;
}

/**
 * Same-origin path this app's own `next.config.ts` rewrites to the real API's
 * `/auth/*`. Login, refresh, and logout all read or write the refresh cookie, and must
 * go through this proxy rather than a direct cross-origin call to `env.NEXT_PUBLIC_API_BASE_URL`
 * — see next.config.ts's rewrites() comment for why a direct call would silently drop the
 * cookie on a tenant subdomain.
 */
const AUTH_PROXY_BASE_URL = "/api/auth";

export const apiClient: ApiClient = createApiClient({
  baseUrl: env.NEXT_PUBLIC_API_BASE_URL,
  getAccessToken: () => accessTokenStore.get(),
  /**
   * No `.catch(() => null)` here, deliberately. `refreshAccessToken` returns `null` only
   * for a spent session and throws when the refresh could not be determined (a 429 from
   * `AuthEndpointThrottle`, a 5xx, a dropped connection). Swallowing the throw used to
   * clear a perfectly good session — reachable by a real user reloading twice or opening
   * a second tab under load, not just by test tooling. Letting it propagate keeps the
   * in-memory token, leaves the refresh cookie alone, and surfaces the real error.
   */
  refreshAccessToken: async () => {
    const refreshed = await refreshAccessToken({
      baseUrl: AUTH_PROXY_BASE_URL,
      path: "/refresh",
    });
    if (!refreshed) {
      accessTokenStore.clear();
      return null;
    }
    accessTokenStore.set(refreshed.accessToken, refreshed.expiresIn);
    return refreshed.accessToken;
  },
  onUnauthorized: (error) => {
    accessTokenStore.clear();
    clearSessionCookie();
    onUnauthorized(error);
  },
});

/** Only for the cookie-bearing auth endpoints — see AUTH_PROXY_BASE_URL. */
const authProxyClient: ApiClient = createApiClient({
  baseUrl: AUTH_PROXY_BASE_URL,
  getAccessToken: () => accessTokenStore.get(),
});

export async function login(credentials: LoginCredentials): Promise<LoginResponse> {
  const { data } = await authProxyClient.post<LoginResponse>("/login", credentials, {
    // Lets the API set the HttpOnly refresh cookie on this same-origin response.
    credentials: "include",
    skipAuthRefresh: true,
  });
  accessTokenStore.set(data.access_token, data.expires_in);
  setSessionCookie();
  return data;
}

export async function logout(): Promise<void> {
  try {
    await authProxyClient.post("/logout", undefined, {
      credentials: "include",
      skipAuthRefresh: true,
    });
  } catch (error) {
    // A failed logout must never trap the user in the app; the cookie expires regardless.
    if (!(error instanceof ApiError)) throw error;
  } finally {
    accessTokenStore.clear();
    clearSessionCookie();
  }
}

/** Current user + effective permissions. The single source for permission-aware UI. */
export async function fetchCurrentUser(): Promise<AuthenticatedUser> {
  const { data } = await apiClient.get<AuthenticatedUser>("/auth/me", {
    credentials: "include",
  });
  return data;
}

/**
 * Restore a session on a cold page load: there is no access token in memory yet, but the
 * refresh cookie may still be valid.
 *
 * Returns `null` only when the user must genuinely sign in again. A **transient** failure
 * — the auth throttle, a 5xx, an offline moment — is rethrown instead, because returning
 * `null` here reads as "signed out" all the way up to the app shell. `useSession` retries
 * it under the shared policy rather than dropping a still-valid session at `/login`; a
 * cold load during a blip is exactly when this used to bite.
 */
export async function restoreSession(): Promise<AuthenticatedUser | null> {
  if (!accessTokenStore.isValid()) {
    // Through the client's single-flight refresh, not a direct call: a cold load
    // and an authenticated request's 401 can happen together, and two
    // simultaneous refreshes against a 10/min throttle is how a throttle window
    // becomes a sign-out.
    const token = await apiClient.refresh();
    if (!token) return null;
  }

  try {
    const user = await fetchCurrentUser();
    // Keeps the proxy's marker in sync with reality: it may be missing here even
    // though the refresh cookie was still valid (e.g. non-HttpOnly cookies got
    // cleared independently, or this is the first visit since this code shipped).
    setSessionCookie();
    return user;
  } catch (error) {
    if (error instanceof ApiError && error.isTransient) throw error;
    accessTokenStore.clear();
    clearSessionCookie();
    return null;
  }
}
```

- [ ] **Step 2: Create `lib/auth.test.ts`**

```ts
import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockPost = jest.fn();
const mockGet = jest.fn();
const mockRefreshAccessToken = jest.fn();
const mockRefresh = jest.fn();
const mockClientConfigs: ApiClientConfig[] = [];

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((config: ApiClientConfig) => {
      mockClientConfigs.push(config);
      // `refresh` is the client's single-flight entry point; `restoreSession`
      // goes through it rather than calling refreshAccessToken directly, so a
      // cold load cannot race a 401-triggered refresh.
      return { post: mockPost, get: mockGet, refresh: mockRefresh };
    }),
    refreshAccessToken: mockRefreshAccessToken,
  };
});

// Every test below re-imports "@schoolhub/api-client" fresh (never a stale top-level
// capture): jest.resetModules() in beforeEach means each test's jest.mock factory calls
// its own jest.requireActual, producing a NEW ApiError class each time — a class
// captured once at file-load time would fail `instanceof` checks against errors thrown
// by that test's own (later, different) module instance.
async function importApiClient() {
  return import("@schoolhub/api-client");
}

describe("auth", () => {
  beforeEach(() => {
    jest.resetModules();
    mockPost.mockReset();
    mockGet.mockReset();
    mockRefreshAccessToken.mockReset();
    mockRefresh.mockReset();
    mockClientConfigs.length = 0;
    document.cookie = "sh_session=; path=/; max-age=0";
  });

  it("wires two clients: one direct, one through the auth proxy", async () => {
    await import("./auth");
    expect(mockClientConfigs).toHaveLength(2);
    expect(mockClientConfigs[1]?.baseUrl).toBe("/api/auth");
  });

  describe("login", () => {
    it("stores the access token and sets the session cookie", async () => {
      const { login, accessTokenStore } = await import("./auth");
      mockPost.mockResolvedValueOnce({
        data: {
          access_token: "at-1",
          expires_in: 900,
          user: {
            id: "u1",
            email: null,
            phone: null,
            full_name: "Test User",
            avatar_url: null,
            locale: "en",
            tenant_id: "t1",
            roles: [],
            permissions: [],
          },
        },
      });

      const result = await login({ identifier: "admin", password: "secret" });

      expect(mockPost).toHaveBeenCalledWith(
        "/login",
        { identifier: "admin", password: "secret" },
        expect.objectContaining({ credentials: "include", skipAuthRefresh: true }),
      );
      expect(accessTokenStore.get()).toBe("at-1");
      expect(document.cookie).toContain("sh_session=1");
      expect(result.access_token).toBe("at-1");
    });
  });

  describe("logout", () => {
    it("clears the token and cookie even when the request fails with an ApiError", async () => {
      const { login, logout, accessTokenStore } = await import("./auth");
      const { ApiError } = await importApiClient();
      mockPost.mockResolvedValueOnce({
        data: {
          access_token: "at-1",
          expires_in: 900,
          user: {
            id: "u1",
            email: null,
            phone: null,
            full_name: "Test User",
            avatar_url: null,
            locale: "en",
            tenant_id: "t1",
            roles: [],
            permissions: [],
          },
        },
      });
      await login({ identifier: "admin", password: "secret" });

      mockPost.mockRejectedValueOnce(
        new ApiError({ code: "unauthenticated", message: "gone", status: 401, url: "/logout" }),
      );

      await expect(logout()).resolves.toBeUndefined();
      expect(accessTokenStore.get()).toBeNull();
      expect(document.cookie).not.toContain("sh_session=1");
    });

    it("re-throws a non-ApiError failure", async () => {
      const { logout } = await import("./auth");
      mockPost.mockRejectedValueOnce(new Error("network down"));

      await expect(logout()).rejects.toThrow("network down");
    });
  });

  describe("fetchCurrentUser", () => {
    it("returns the authenticated user payload", async () => {
      const { fetchCurrentUser } = await import("./auth");
      mockGet.mockResolvedValueOnce({ data: { id: "u1", email: "a@test.invalid" } });

      const user = await fetchCurrentUser();

      expect(mockGet).toHaveBeenCalledWith("/auth/me", { credentials: "include" });
      expect(user).toEqual({ id: "u1", email: "a@test.invalid" });
    });
  });

  describe("restoreSession", () => {
    it("returns null when the refresh cookie has nothing to offer", async () => {
      const { restoreSession } = await import("./auth");
      mockRefresh.mockResolvedValueOnce(null);

      await expect(restoreSession()).resolves.toBeNull();
      expect(mockGet).not.toHaveBeenCalled();
    });

    it("refreshes, then fetches the user, on a cold load", async () => {
      const { restoreSession } = await import("./auth");
      mockRefresh.mockResolvedValueOnce("at-2");
      mockGet.mockResolvedValueOnce({ data: { id: "u2" } });

      const user = await restoreSession();

      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(user).toEqual({ id: "u2" });
      expect(document.cookie).toContain("sh_session=1");
    });

    it("clears state and returns null when the user fetch fails", async () => {
      const { restoreSession, accessTokenStore } = await import("./auth");
      mockRefresh.mockResolvedValueOnce("at-3");
      mockGet.mockRejectedValueOnce(new Error("boom"));

      await expect(restoreSession()).resolves.toBeNull();
      expect(accessTokenStore.get()).toBeNull();
    });

    it("rethrows a throttled refresh instead of reporting a signed-out session", async () => {
      // Returning null here reads as "signed out" all the way up to the app shell, so a
      // cold load during a throttle window used to drop a still-valid session at /login.
      const { restoreSession } = await import("./auth");
      const { ApiError } = await importApiClient();
      const throttled = new ApiError({
        code: "rate_limited",
        message: "Too many requests.",
        status: 429,
        url: "/api/auth/refresh",
      });
      mockRefresh.mockRejectedValueOnce(throttled);

      await expect(restoreSession()).rejects.toBe(throttled);
      expect(mockGet).not.toHaveBeenCalled();
    });

    it("rethrows a transient user-fetch failure and keeps the session intact", async () => {
      const { restoreSession, accessTokenStore } = await import("./auth");
      const { ApiError } = await importApiClient();
      mockRefresh.mockResolvedValueOnce("at-8");
      accessTokenStore.set("at-8", 900);
      mockGet.mockRejectedValueOnce(
        new ApiError({ code: "server_error", message: "down", status: 503, url: "/auth/me" }),
      );

      await expect(restoreSession()).rejects.toBeInstanceOf(ApiError);
      expect(accessTokenStore.get()).toBe("at-8");
    });
  });

  describe("setUnauthorizedHandler", () => {
    it("lets the app override the default 401 handler", async () => {
      const { setUnauthorizedHandler, accessTokenStore } = await import("./auth");
      const handler = jest.fn();
      setUnauthorizedHandler(handler);

      const { ApiError } = await importApiClient();
      const directClientConfig = mockClientConfigs[0];
      accessTokenStore.set("at-4", 900);
      directClientConfig?.onUnauthorized?.(
        new ApiError({ code: "unauthenticated", message: "gone", status: 401, url: "/x" }),
      );

      expect(accessTokenStore.get()).toBeNull();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("the default handler (before any override) just clears the token store", async () => {
      const { accessTokenStore } = await import("./auth");
      const { ApiError } = await importApiClient();
      const directClientConfig = mockClientConfigs[0];
      accessTokenStore.set("at-5", 900);

      expect(() =>
        directClientConfig?.onUnauthorized?.(
          new ApiError({ code: "unauthenticated", message: "gone", status: 401, url: "/x" }),
        ),
      ).not.toThrow();

      expect(accessTokenStore.get()).toBeNull();
    });
  });

  describe("the direct client's getAccessToken/refreshAccessToken config", () => {
    it("getAccessToken reads whatever is currently in the token store", async () => {
      const { accessTokenStore } = await import("./auth");
      const directClientConfig = mockClientConfigs[0];
      accessTokenStore.set("at-6", 900);

      expect(directClientConfig?.getAccessToken?.()).toBe("at-6");
    });

    it("refreshAccessToken clears the store and resolves null when the proxy has nothing", async () => {
      const { accessTokenStore } = await import("./auth");
      const directClientConfig = mockClientConfigs[0];
      accessTokenStore.set("stale", 900);
      mockRefreshAccessToken.mockResolvedValueOnce(null);

      await expect(directClientConfig?.refreshAccessToken?.()).resolves.toBeNull();
      expect(accessTokenStore.get()).toBeNull();
    });

    it("refreshAccessToken stores and returns the new token when the proxy refreshes", async () => {
      const { accessTokenStore } = await import("./auth");
      const directClientConfig = mockClientConfigs[0];
      mockRefreshAccessToken.mockResolvedValueOnce({ accessToken: "at-7", expiresIn: 900 });

      await expect(directClientConfig?.refreshAccessToken?.()).resolves.toBe("at-7");
      expect(accessTokenStore.get()).toBe("at-7");
    });

    it("refreshAccessToken lets a transient failure through with the token untouched", async () => {
      // The `.catch(() => null)` that used to wrap this call turned a throttled or
      // unreachable refresh into "session over", clearing a perfectly good session.
      const { accessTokenStore } = await import("./auth");
      const { ApiError } = await importApiClient();
      const directClientConfig = mockClientConfigs[0];
      accessTokenStore.set("still-good", 900);
      mockRefreshAccessToken.mockRejectedValueOnce(
        new ApiError({
          code: "rate_limited",
          message: "Too many requests.",
          status: 429,
          url: "/api/auth/refresh",
        }),
      );

      await expect(directClientConfig?.refreshAccessToken?.()).rejects.toBeInstanceOf(ApiError);
      expect(accessTokenStore.get()).toBe("still-good");
    });
  });

  describe("the auth-proxy client's getAccessToken config", () => {
    it("also reads from the shared token store", async () => {
      const { accessTokenStore } = await import("./auth");
      const authProxyClientConfig = mockClientConfigs[1];
      accessTokenStore.set("at-8", 900);

      expect(authProxyClientConfig?.getAccessToken?.()).toBe("at-8");
    });
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/lib/auth.ts apps/dashboard/src/lib/auth.test.ts
git commit -m "feat(dashboard): restore the real auth wiring (login/logout/session)

Token store, the two ApiClient instances (direct + same-origin auth
proxy), and login/logout/fetchCurrentUser/restoreSession — talks to
the actual backend via next.config.ts's existing /api/auth/* rewrite."
```

---

### Task 4: Load real per-locale messages in `i18n/request.ts`

**Files:**
- Modify: `apps/dashboard/src/i18n/request.ts` (currently a stub from the Metronic preview work — returns `messages: {}` unconditionally)
- Create: `apps/dashboard/src/i18n/messages.types-check.ts`

**Interfaces:**
- Consumes: `LOCALE_COOKIE_NAME` from `@/lib/constants`, `env` and `isSupportedLocale` from `@/lib/env` (Task 1).
- Produces: re-exports `LOCALE_COOKIE_NAME`; the `next-intl` request config now resolves the real locale and loads `messages/<locale>.json`, so `useTranslations`/`getTranslations` calls anywhere in the app (Task 5's login page included) render real strings instead of throwing on a missing key.

- [ ] **Step 1: Replace `i18n/request.ts`**

```ts
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE_NAME } from "@/lib/constants";
import { cookies } from "next/headers";
import type * as EnMessages from "../../messages/en.json";
import { env, isSupportedLocale } from "@/lib/env";

/** The shape every locale file under `messages/` is expected to match. */
type Messages = typeof EnMessages;

/**
 * next-intl without locale routing: the dashboard is a single-origin app whose language
 * follows the user/tenant preference, not the URL.
 *
 * The cookie is written by the account menu's language switch
 * (`components/user-menu.tsx`, not yet rebuilt). Writing it from the authenticated user's
 * own `locale` at sign-in is still to be done — until then a returning user gets the
 * default until they choose, which is why the switch exists at all.
 */
// Re-exported, not redeclared: the name is owned by `lib/constants.ts` so a client
// component can import it too (this module is server-only, via `next/headers`).
// Existing importers of this path keep working.
export { LOCALE_COOKIE_NAME };

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const requested = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  const locale =
    requested && isSupportedLocale(requested) ? requested : env.NEXT_PUBLIC_DEFAULT_LOCALE;

  // A dynamic import with a computed specifier can't be resolved statically, so TS gives
  // it type `any` — asserted against en.json's shape. This assertion only describes *this*
  // value; it does not check any other locale file's real content — that check lives in
  // messages.types-check.ts, a file that exists purely to fail `tsc` if a locale diverges.
  // Cast the whole module object before touching `.default`, not after: asserting only
  // the final expression still leaves the intermediate `.default` access unsafely typed
  // as `any`.
  const messages = (await import(`../../messages/${locale}.json`)) as { default: Messages };

  return {
    locale,
    messages: messages.default,
    // Tenant timezone would be injected here once the tenant is resolved server-side.
    now: new Date(),
  };
});
```

- [ ] **Step 2: Create `i18n/messages.types-check.ts`**

```ts
import type * as EnMessages from "../../messages/en.json";
import type * as UrMessages from "../../messages/ur.json";

/**
 * Compile-time-only: fails `tsc` if a locale file's shape diverges from en.json's.
 *
 * This file is never imported by anything — its only job is to sit inside the TS project
 * (`apps/dashboard/tsconfig.json` includes `**\/*.ts` regardless of import graph, and
 * ESLint's own glob matching is the same) so both tools walk it and catch a locale that
 * is missing a key en.json has, or has one with a mismatched type. `request.ts`'s own
 * `as` assertion only describes the value at that one call site — it cannot verify any
 * *other* locale file's real content, which is exactly what this file exists to do.
 *
 * `declare const` is safe here specifically because this file is dead code: nothing
 * bundles it, so the ambient (never-really-defined) value it names is never evaluated.
 * The same construct inside an actually-executed file would throw a real
 * `ReferenceError` the moment that line ran — do not copy this pattern into request.ts.
 */
type Messages = typeof EnMessages;
declare const urMessagesSample: typeof UrMessages;
const _urMessagesMatchEn: Messages = urMessagesSample;
void _urMessagesMatchEn;
```

`jest.config.ts` (already present, untouched) already excludes this exact path from coverage — no config change needed.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/i18n/request.ts apps/dashboard/src/i18n/messages.types-check.ts
git commit -m "feat(dashboard): load real per-locale messages instead of the {} stub

The Metronic preview's i18n/request.ts stubbed messages to {} since
that route never used next-intl for real content. The login page does."
```

---

### Task 5: Build the real `/login` page

**Files:**
- Create: `apps/dashboard/src/app/(auth)/layout.tsx`
- Create: `apps/dashboard/src/app/(auth)/login/page.tsx`
- Create: `apps/dashboard/src/features/auth/login-form.tsx`
- Test: `apps/dashboard/src/features/auth/login-form.test.tsx`

**Interfaces:**
- Consumes: `login` from `@/lib/auth` (Task 3); `getQueryClient`, `queryKeys` from `@/lib/query-client` (Task 2); real `auth.login.*`/`errors.*`/`app.*` messages via `next-intl` (Task 4, keys already present in `messages/en.json` and `messages/ur.json` — verified, no message-file changes needed); `Alert`, `AlertDescription`, `Button`, `Card`, `CardContent`, `Form`, `FormControl`, `FormDescription`, `FormField`, `FormItem`, `FormLabel`, `FormMessage`, `Input` from `@schoolhub/ui` (untouched, already used by the Metronic dashboard build).
- Produces: the `/login` route, reachable now (not yet the *only* way in — `src/proxy.ts` is a later chunk, see Global Constraints).

- [ ] **Step 1: Create `app/(auth)/layout.tsx`**

Centered, platform-branded shell — deliberately NOT the Metronic `Shell` from `app/(app)/_metronic/shell.tsx`: this route is shown before any tenant (or even a user) is known, so it can't use that tenant-dashboard chrome (sidebar, header nav, mega-menu). This is the same layout that shipped before the deletion; it already uses the platform brand tokens `theme.css` defines (`--sh-platform-*`), which Task 4 doesn't touch and which are unrelated to the Metronic `data-theme-preset="metronic"` tokens the `(app)` route group opts into.

```tsx
import { getTranslations } from "next-intl/server";
import type { CSSProperties, ReactNode } from "react";

/**
 * /login (and every other route under this group) is never a tenant's — it's shown
 * before a user, and therefore any tenant, is known. It renders SchoolHub's own
 * "Aurora" platform brand rather than the tenant-overridable default, by
 * overriding the same --sh-color-* variables every component already reads (bg-primary,
 * bg-surface, ...) with the never-tenant-overridable --sh-platform-* values from
 * theme.css — the identical mechanism TenantTheme uses to re-theme for a real tenant
 * (not yet rebuilt), just scoped to this subtree instead of a fetched branding object.
 * Every component (Card, Button, Form, ...) needs zero changes to render correctly here:
 * it only ever reads --sh-color-primary etc, never knows or cares which tier supplied
 * the value.
 */
const PLATFORM_BRAND_STYLE: CSSProperties = {
  "--sh-color-primary": "var(--sh-platform-color-primary)",
  "--sh-color-primary-foreground": "var(--sh-platform-color-primary-foreground)",
  "--sh-color-surface": "var(--sh-platform-color-surface)",
  "--sh-color-surface-foreground": "var(--sh-platform-color-primary)",
} as CSSProperties;

/** Centered, platform-branded shell for the unauthenticated routes. */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("app");

  return (
    <main
      style={PLATFORM_BRAND_STYLE}
      className="flex min-h-dvh flex-col items-center justify-center bg-primary px-4 py-12"
    >
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <p className="font-heading text-xl font-semibold text-primary-foreground">{t("name")}</p>
          <p className="text-sm text-primary-foreground/70">{t("tagline")}</p>
        </div>
        {children}
      </div>
    </main>
  );
}
```

If `--sh-platform-color-*` or `.font-heading` are not yet defined in `packages/ui/src/styles/theme.css` for this app's build, the layout still renders — it falls back to the inherited `--sh-color-*` values, just without the platform-specific override. Confirm visually in Step 5; do not add new tokens to `packages/ui` to chase this (out of scope, shared package).

- [ ] **Step 2: Create `app/(auth)/login/page.tsx`**

```tsx
import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/features/auth/login-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * `LoginForm` reads the `?next=` search param, so it must sit behind a Suspense boundary
 * for this route to prerender.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-[var(--sh-radius)] bg-muted" />}>
      <LoginForm />
    </Suspense>
  );
}
```

- [ ] **Step 3: Create `features/auth/login-form.tsx`**

Same validation/submit/error-mapping logic as the pre-deletion version (Zod schema mirrors the API per module doc §11; the API's `error.details` are surfaced verbatim, never invented). Two additions from Metronic's own `app/(auth)/signin/page.tsx` visual pattern: a password show/hide toggle (`Eye`/`EyeOff` from `lucide-react`, local `useState`, zero backend dependency) and its spacing/heading conventions. Dropped from Metronic's version: the NextAuth `signIn()` call (replaced with the real `login()` mutation below), the Google sign-in button, the demo-credentials alert, and the "Sign Up" link — none apply to a product where accounts are school-issued, not self-registered.

```tsx
"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError } from "@schoolhub/api-client";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@schoolhub/ui";
import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { login } from "@/lib/auth";
import { env } from "@/lib/env";
import { parseTenantSlug } from "@/lib/host";
import { getQueryClient, queryKeys } from "@/lib/query-client";

/**
 * Zod schema mirrors the API's validation (module doc §11) so the user gets instant feedback,
 * but the API remains the authority — its `error.details` are surfaced verbatim below.
 */
const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const t = useTranslations("auth.login");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [passwordVisible, setPasswordVisible] = useState(false);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "", password: "" },
  });
  const { handleSubmit, setError } = form;

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: () => {
      // Fire-and-forget: the redirect below does not need the cache to have settled first.
      void getQueryClient().invalidateQueries({ queryKey: queryKeys.session() });
      const next = searchParams.get("next");
      router.replace(next?.startsWith("/") ? next : "/dashboard");
    },
    onError: (error: unknown) => {
      if (!(error instanceof ApiError)) return;
      // Map the envelope's field details onto the form; never invent a message for a known code.
      for (const [field, issue] of Object.entries(error.fieldErrors())) {
        if (field === "identifier" || field === "password") {
          setError(field, { type: "server", message: issue });
        }
      }
    },
  });

  const formError =
    mutation.error instanceof ApiError
      ? mutation.error.isUnauthenticated
        ? t("genericError")
        : tErrors.has(mutation.error.code)
          ? tErrors(mutation.error.code)
          : mutation.error.message
      : null;

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <div className="space-y-1">
          <h1 className="font-heading text-lg font-semibold text-foreground">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>

        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <Form {...form}>
          <form
            className="space-y-4"
            // react-hook-form's handleSubmit always returns an async wrapper, so onSubmit
            // is a promise-returning function where the DOM expects void — but `void` alone
            // only silences that mismatch, it does not handle a rejection. A validation
            // failure itself never rejects (react-hook-form resolves that internally via
            // setError), and mutation.mutate is fire-and-forget, but an unexpected throw
            // inside the resolver would otherwise vanish as an unhandled rejection with
            // nothing here to say so — hence the explicit .catch().
            onSubmit={(event) => {
              handleSubmit((values) => {
                // Tenant comes from the subdomain (<slug>.<platform-domain>:3000), not a
                // form field — `window` is safe here since this handler only ever runs
                // client-side, in response to a real submit event.
                const school = parseTenantSlug(
                  window.location.hostname,
                  env.NEXT_PUBLIC_PLATFORM_DOMAIN,
                );
                mutation.mutate(school ? { ...values, school } : values);
              })(event).catch((error: unknown) => {
                console.error("Unexpected error while submitting the sign-in form:", error);
              });
            }}
            noValidate
          >
            <FormField
              control={form.control}
              name="identifier"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("identifier")}</FormLabel>
                  <FormDescription>{t("identifierHint")}</FormDescription>
                  <FormControl required>
                    <Input {...field} autoComplete="username" autoFocus />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-baseline justify-between gap-2">
                    <FormLabel required>{t("password")}</FormLabel>
                    <Link
                      href="/forgot-password"
                      className="text-xs text-primary underline-offset-4 hover:underline"
                    >
                      {t("forgotPassword")}
                    </Link>
                  </div>
                  {/* The toggle Button sits outside FormControl, as a sibling of it inside
                      this relative wrapper — not nested inside FormControl alongside Input.
                      FormControl clones its aria-describedby/aria-invalid/id props onto its
                      one child via Slot; wrapping both elements in a div would land those
                      props on the div instead of the actual <input>, breaking the a11y
                      wiring FormMessage depends on. */}
                  <div className="relative">
                    <FormControl required>
                      <Input
                        {...field}
                        type={passwordVisible ? "text" : "password"}
                        autoComplete="current-password"
                      />
                    </FormControl>
                    <Button
                      type="button"
                      variant="ghost"
                      mode="icon"
                      size="sm"
                      onClick={() => setPasswordVisible(!passwordVisible)}
                      className="absolute end-1 top-1/2 size-7 -translate-y-1/2 bg-transparent!"
                      aria-label={passwordVisible ? "Hide password" : "Show password"}
                    >
                      {passwordVisible ? (
                        <EyeOff className="text-muted-foreground" />
                      ) : (
                        <Eye className="text-muted-foreground" />
                      )}
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              block
              isLoading={mutation.isPending}
              loadingLabel={t("submitting")}
            >
              {t("submit")}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Create `features/auth/login-form.test.tsx`**

A trimmed local wrapper, not the full pre-deletion `test-utils.tsx` (that file also pulls in `preferences-provider`, `motion/react`, and `next-themes` — unrelated preference/layout infrastructure this chunk deliberately doesn't restore; see Global Constraints). `LoginForm` needs only real messages and a query client.

```tsx
import { ApiError } from "@schoolhub/api-client";
import type { LoginResponse } from "@schoolhub/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import messages from "../../../messages/en.json";
import { login } from "@/lib/auth";
import { LoginForm } from "./login-form";

function renderLoginForm(ui: ReactElement = <LoginForm />) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

function makeLoginResponse(): LoginResponse {
  return {
    access_token: "at-1",
    expires_in: 900,
    user: {
      id: "u1",
      email: "admin@cityschool.test",
      phone: null,
      full_name: "Ayesha Khan",
      avatar_url: null,
      locale: "en",
      tenant_id: "t1",
      roles: [],
      permissions: [],
    },
  };
}

const mockReplace = jest.fn();
const mockGet = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => ({ get: mockGet }),
}));

jest.mock("@/lib/auth", () => ({
  login: jest.fn(),
}));

const mockLogin = login as jest.MockedFunction<typeof login>;

async function fillAndSubmit(identifier: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/email, phone, or username/i), identifier);
  await user.type(screen.getByLabelText(/^password/i), password);
  await user.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("LoginForm", () => {
  beforeEach(() => {
    mockLogin.mockReset();
    mockReplace.mockReset();
    mockGet.mockReset().mockReturnValue(null);
  });

  it("renders the sign-in fields", () => {
    renderLoginForm();

    expect(screen.getByLabelText(/email, phone, or username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("toggles the password field's visibility", async () => {
    renderLoginForm();
    const user = userEvent.setup();
    const passwordInput = screen.getByLabelText(/^password/i);
    expect(passwordInput).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: /show password/i }));
    expect(passwordInput).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: /hide password/i }));
    expect(passwordInput).toHaveAttribute("type", "password");
  });

  it("redirects to /dashboard on a successful sign-in with no next param", async () => {
    mockLogin.mockResolvedValue(makeLoginResponse());

    renderLoginForm();
    await fillAndSubmit("admin@cityschool.test", "secret123");

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });
    // TanStack Query's useMutation calls mutationFn with a second (context) argument
    // beyond the variables — assert on the first call's first argument directly rather
    // than via toHaveBeenCalledWith, which requires every argument to match.
    expect(mockLogin.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ identifier: "admin@cityschool.test", password: "secret123" }),
    );
  });

  it("redirects to a same-origin next param when present", async () => {
    mockGet.mockReturnValue("/students");
    mockLogin.mockResolvedValue(makeLoginResponse());

    renderLoginForm();
    await fillAndSubmit("admin@cityschool.test", "secret123");

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/students");
    });
  });

  it("ignores an off-site next param", async () => {
    mockGet.mockReturnValue("https://evil.example.com");
    mockLogin.mockResolvedValue(makeLoginResponse());

    renderLoginForm();
    await fillAndSubmit("admin@cityschool.test", "secret123");

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("maps a field-level API error onto the matching form field", async () => {
    mockLogin.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "Invalid",
        status: 422,
        url: "/login",
        details: [{ field: "identifier", issue: "No account with that identifier." }],
      }),
    );

    renderLoginForm();
    await fillAndSubmit("nobody", "secret123");

    await waitFor(() => {
      expect(screen.getByText("No account with that identifier.")).toBeInTheDocument();
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows the generic error banner on 401", async () => {
    mockLogin.mockRejectedValue(
      new ApiError({
        code: "unauthenticated",
        message: "bad credentials",
        status: 401,
        url: "/login",
      }),
    );

    renderLoginForm();
    await fillAndSubmit("admin@cityschool.test", "wrong");

    await waitFor(() => {
      expect(
        screen.getByText("We could not sign you in. Check your details and try again."),
      ).toBeInTheDocument();
    });
  });

  it("shows a mapped error message for a known error code", async () => {
    mockLogin.mockRejectedValue(
      new ApiError({ code: "server_error", message: "boom", status: 500, url: "/login" }),
    );

    renderLoginForm();
    await fillAndSubmit("admin@cityschool.test", "secret123");

    await waitFor(() => {
      expect(
        screen.getByText("Something went wrong on our side. The team has been notified."),
      ).toBeInTheDocument();
    });
  });
});
```

Verify `errors.server_error`'s exact English string in `apps/dashboard/messages/en.json` matches the literal above before committing — read the file rather than trusting this plan's transcription, since a mismatch fails this test for a reason that has nothing to do with the feature.

- [ ] **Step 5: Verify live (dev server + browser, not `pnpm build`/`tsc`/jest)**

```bash
source ~/.nvm/nvm.sh && nvm use 24
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
pnpm --filter @schoolhub/dashboard dev &
timeout 30 bash -c 'until curl -sf http://localhost:3000/login >/dev/null; do sleep 1; done' || true
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login
```

Expected: `200`. Then drive it with a headless browser (same pattern as the `/dashboard` Metronic verification): navigate to `/login`, screenshot, confirm the centered card renders with the two real fields, the password toggle works, and typing a wrong identifier/password and submitting shows a real error banner from the real API (or a network error if the backend isn't running locally — either is fine for this check; the point is confirming the request actually fires against `/api/auth/login`, not that the backend is up).

- [ ] **Step 6: Commit**

```bash
git add "apps/dashboard/src/app/(auth)" apps/dashboard/src/features/auth
git commit -m "feat(dashboard): build the real /login page

Real react-hook-form + zod validation, TanStack Query mutation against
the actual login() API wiring from lib/auth.ts, and field-level error
mapping from the API's error envelope — restyled with Metronic's
password show/hide toggle. Metronic's NextAuth/Google/demo-credentials
sign-in bits are dropped; none apply to school-issued accounts."
```

## Verification

1. `curl http://localhost:3000/login` → 200.
2. Browser check: real Sign In card renders (not the Metronic demo dashboard), both fields present, password toggle works, submitting calls the real `/api/auth/login` proxy (visible in the Network tab or via a 4xx/network-error banner if no backend is running).
3. `git status --porcelain=v1 -- apps/website packages/ui packages/api-client packages/types` → empty — nothing outside `apps/dashboard` touched.
4. Push and let CI run Jest/typecheck/lint — per this session's standing instruction, do not run them locally first.
