import type { RefreshResponse } from "@schoolhub/types";
import { ApiError, codeForStatus } from "./errors";
import { TRAILING_SLASH_PATTERN } from "./regex";

/**
 * In-memory access-token store.
 *
 * The access token (15 min) is deliberately **not** persisted: no localStorage, no
 * non-HttpOnly cookie. Durability comes from the rotating refresh token, which lives in an
 * HttpOnly SameSite cookie the browser attaches to `/auth/refresh` — JavaScript never sees it.
 * Future mobile clients swap this store for secure storage against the same endpoints.
 */
export interface AccessTokenStore {
  get(): string | null;
  set(token: string, expiresInSeconds?: number): void;
  clear(): void;
  /** True when a token exists and has not passed its expiry (minus the skew window). */
  isValid(): boolean;
  subscribe(listener: (token: string | null) => void): () => void;
}

/** Refresh this many seconds before the token actually expires. */
const EXPIRY_SKEW_SECONDS = 30;

export function createAccessTokenStore(): AccessTokenStore {
  let token: string | null = null;
  let expiresAt = 0;
  const listeners = new Set<(value: string | null) => void>();

  const emit = () => {
    for (const listener of listeners) listener(token);
  };

  return {
    get: () => token,
    set: (value, expiresInSeconds) => {
      token = value;
      expiresAt =
        typeof expiresInSeconds === "number"
          ? Date.now() + Math.max(expiresInSeconds - EXPIRY_SKEW_SECONDS, 0) * 1000
          : Number.POSITIVE_INFINITY;
      emit();
    },
    clear: () => {
      token = null;
      expiresAt = 0;
      emit();
    },
    isValid: () => token !== null && Date.now() < expiresAt,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export interface RefreshOptions {
  baseUrl: string;
  /** Defaults to `/auth/refresh`. */
  path?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Exchange the HttpOnly refresh cookie for a new access token.
 *
 * Sends no body and reads no cookie — `credentials: "include"` is what carries the refresh
 * token.
 *
 * The two failure modes are **not** the same thing and must not collapse into one:
 *
 * - `null` — the session is genuinely over (401/403, or a 200 with no token in it). The
 *   refresh cookie is spent; the caller should clear state and bounce to `/login`.
 * - **throws `ApiError`** — the refresh could not be *determined*: a 429 from
 *   `AuthEndpointThrottle` (10 req/min across login/refresh/logout combined), a 5xx, or a
 *   transport failure. The refresh cookie is very likely still good, so treating this as
 *   "logged out" signs a user out for reloading twice in quick succession or opening a
 *   second tab under load. Callers propagate it and let their retry policy decide.
 *
 * Both used to return `null`, which is what made a rate-limited refresh indistinguishable
 * from an expired session.
 */
export async function refreshAccessToken(
  options: RefreshOptions,
): Promise<{ accessToken: string; expiresIn: number } | null> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = `${options.baseUrl.replace(TRAILING_SLASH_PATTERN, "")}${options.path ?? "/auth/refresh"}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch (cause) {
    throw new ApiError({
      code: "network_error",
      message: "Could not reach the authentication service.",
      status: 0,
      url,
      cause,
    });
  }

  if (response.status === 401 || response.status === 403) return null;

  if (!response.ok) {
    const retryAfter = response.headers.get("Retry-After");
    throw new ApiError({
      code: codeForStatus(response.status),
      message: retryAfter
        ? `Could not refresh the session; retry after ${retryAfter}s.`
        : "Could not refresh the session right now.",
      status: response.status,
      url,
      requestId: response.headers.get("X-Request-ID"),
    });
  }

  // `Partial`, not `RefreshResponse`: this is untrusted JSON off the wire, and asserting
  // the full shape would make the guards below look redundant to the type-checker while
  // still being the only thing standing between a malformed body and a broken session.
  const payload = (await response.json().catch(() => null)) as {
    data?: Partial<RefreshResponse>;
  } | null;
  const data = payload?.data;
  // A 2xx whose body carries no token is a spent session, not a transient fault: the
  // server answered, it simply has no token to give.
  if (!data?.access_token) return null;
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? 900 };
}
