import { ApiError } from "@schoolhub/api-client";
import type { AuthenticatedUser, LoginCredentials, LoginResponse } from "@schoolhub/types";
import {
  accessTokenStore,
  apiClient,
  authProxyClient,
  clearSessionCookie,
  setSessionCookie,
} from "@/lib/auth";
import { endpoints } from "@/services/endpoints";

/**
 * The auth domain's API calls. Every dashboard consumer reaches these through
 * `Services.auth.*` (see `@/services`) — never by importing this file directly and never
 * by importing `@schoolhub/api-client` directly.
 */

export async function login(credentials: LoginCredentials): Promise<LoginResponse> {
  const { data } = await authProxyClient.post<LoginResponse>(endpoints.auth.login, credentials, {
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
    await authProxyClient.post(endpoints.auth.logout, undefined, {
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
  const { data } = await apiClient.get<AuthenticatedUser>(endpoints.auth.me, {
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
