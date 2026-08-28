import type { RefreshResponse } from "@schoolhub/types";
import { ApiError } from "./errors";

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
 * token. Returns `null` when the session is genuinely over, so callers can bounce to `/login`
 * instead of retrying forever.
 */
export async function refreshAccessToken(
  options: RefreshOptions,
): Promise<{ accessToken: string; expiresIn: number } | null> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = `${options.baseUrl.replace(/\/+$/, "")}${options.path ?? "/auth/refresh"}`;

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
  if (!response.ok) return null;

  try {
    const payload = (await response.json()) as { data?: RefreshResponse };
    const accessToken = payload.data?.access_token;
    if (!accessToken) return null;
    return { accessToken, expiresIn: payload.data?.expires_in ?? 900 };
  } catch {
    return null;
  }
}
