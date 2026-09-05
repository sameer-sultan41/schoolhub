import { ApiClient, refreshAccessToken as exchangeRefreshCookie } from "@schoolhub/api-client";
import type { LoginResponse } from "@schoolhub/types";
import { env } from "@/env";

/**
 * `Set-Cookie: sh_refresh=<token>; Max-Age=...; Path=/api/auth; HttpOnly; SameSite=Lax`
 * — only the `name=value` pair is valid in a request's `Cookie` header, so the
 * attributes after the first `;` must be stripped before resending it.
 */
function refreshCookieFrom(response: Response): string | null {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) return null;
  return setCookie.split(";")[0] ?? null;
}

export interface LiveCredentials {
  identifier: string;
  password: string;
}

/**
 * One real login for the lifetime of a worker.
 *
 * `AuthEndpointThrottle` (apps/api/core/api/throttling.py) allows only 10 requests/minute
 * per IP across login/refresh/logout combined — a real login per test would exhaust that
 * budget the moment the API spec suite grows past a handful of files. `liveApiClient`
 * (see `@/fixtures`) is worker-scoped, so this runs once per worker regardless of how
 * many `api/*.spec.ts` files run against it.
 *
 * Uses raw `fetch`, not a browser context: the real `RefreshView` reads the `sh_refresh`
 * cookie directly off the request (`request.COOKIES`), so the refresh token just needs to
 * be resent as a `Cookie` header — no browser cookie jar required.
 *
 * `credentials` defaults to the primary admin (`env.LIVE_ADMIN_*`) but is overridable —
 * a record-scope spec needs a real, narrower identity logged in on its own, not the
 * worker-shared admin session, and `campuses.spec.ts`'s cross-tenant test already
 * hand-rolls this exact login sequence once for its own second identity; a second
 * hand-rolled copy is exactly the duplication this parameter avoids.
 */
export async function createLiveSession(credentials?: LiveCredentials): Promise<ApiClient> {
  let accessToken: string | null = null;
  let refreshCookie: string | null = null;

  const client = new ApiClient({
    baseUrl: env.API_BASE_URL,
    fetchImpl: fetch,
    getAccessToken: () => accessToken,
    refreshAccessToken: async () => {
      if (!refreshCookie) return null;
      // token-store.ts's refreshAccessToken hardcodes `credentials: "include"`, a no-op
      // under Node's global fetch (no cookie jar) — inject the Cookie header ourselves
      // via fetchImpl instead, and capture the rotated Set-Cookie as a side effect.
      const result = await exchangeRefreshCookie({
        baseUrl: env.API_BASE_URL,
        fetchImpl: async (url, init) => {
          const headers = new Headers(init?.headers);
          headers.set("Cookie", refreshCookie ?? "");
          const response = await fetch(url, { ...init, headers });
          refreshCookie = refreshCookieFrom(response) ?? refreshCookie;
          return response;
        },
      });
      if (!result) return null;
      accessToken = result.accessToken;
      return accessToken;
    },
  });

  const login = await fetch(`${env.API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      credentials ?? {
        identifier: env.LIVE_ADMIN_IDENTIFIER,
        password: env.LIVE_ADMIN_PASSWORD,
      },
    ),
  });
  if (!login.ok) {
    throw new Error(`live API login failed: ${login.status} ${await login.text()}`);
  }

  refreshCookie = refreshCookieFrom(login);
  const { data } = (await login.json()) as { data: LoginResponse };
  accessToken = data.access_token;

  return client;
}
