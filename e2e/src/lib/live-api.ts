import { ApiClient } from "@schoolhub/api-client";
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
 */
export async function createLiveSession(): Promise<ApiClient> {
  let accessToken: string | null = null;
  let refreshCookie: string | null = null;

  const client = new ApiClient({
    baseUrl: env.API_BASE_URL,
    fetchImpl: fetch,
    getAccessToken: () => accessToken,
    refreshAccessToken: async () => {
      if (!refreshCookie) return null;
      const response = await fetch(`${env.API_BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: { Cookie: refreshCookie },
      });
      if (!response.ok) return null;
      refreshCookie = refreshCookieFrom(response) ?? refreshCookie;
      const { data } = (await response.json()) as { data: { access_token: string } };
      accessToken = data.access_token;
      return accessToken;
    },
  });

  const login = await fetch(`${env.API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: env.LIVE_ADMIN_IDENTIFIER,
      password: env.LIVE_ADMIN_PASSWORD,
    }),
  });
  if (!login.ok) {
    throw new Error(`live API login failed: ${login.status} ${await login.text()}`);
  }

  refreshCookie = refreshCookieFrom(login);
  const { data } = (await login.json()) as { data: LoginResponse };
  accessToken = data.access_token;

  return client;
}
