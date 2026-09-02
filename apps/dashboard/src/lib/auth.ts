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
 *   JavaScript never touches it; `credentials: "include"` is what sends it.
 * - A 401 triggers exactly one refresh, shared across concurrent requests, then the original
 *   request replays. If the refresh fails we clear state and bounce to /login.
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

export const apiClient: ApiClient = createApiClient({
  baseUrl: env.NEXT_PUBLIC_API_BASE_URL,
  getAccessToken: () => accessTokenStore.get(),
  refreshAccessToken: async () => {
    const refreshed = await refreshAccessToken({ baseUrl: env.NEXT_PUBLIC_API_BASE_URL }).catch(
      () => null,
    );
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

export async function login(credentials: LoginCredentials): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>("/auth/login", credentials, {
    // Lets the API set the HttpOnly refresh cookie on this response.
    credentials: "include",
    skipAuthRefresh: true,
  });
  accessTokenStore.set(data.access_token, data.expires_in);
  setSessionCookie();
  return data;
}

export async function logout(): Promise<void> {
  try {
    await apiClient.post("/auth/logout", undefined, {
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
 * refresh cookie may still be valid. Returns null when the user must sign in again.
 */
export async function restoreSession(): Promise<AuthenticatedUser | null> {
  if (!accessTokenStore.isValid()) {
    const refreshed = await refreshAccessToken({
      baseUrl: env.NEXT_PUBLIC_API_BASE_URL,
    }).catch(() => null);
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
  } catch {
    accessTokenStore.clear();
    clearSessionCookie();
    return null;
  }
}
