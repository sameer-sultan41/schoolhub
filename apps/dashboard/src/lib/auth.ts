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
    const refreshed = await refreshAccessToken({
      baseUrl: AUTH_PROXY_BASE_URL,
      path: "/refresh",
    });
    if (!refreshed) return null;
    accessTokenStore.set(refreshed.accessToken, refreshed.expiresIn);
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
