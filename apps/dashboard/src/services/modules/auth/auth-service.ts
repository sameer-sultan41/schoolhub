import { ApiError } from "@schoolhub/api-client";
import { isMfaChallenge } from "@schoolhub/types";
import {
  accessTokenStore,
  apiClient,
  authProxyClient,
  clearSessionCookie,
  mfaChallengeStore,
  setSessionCookie,
} from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type {
  AuthenticatedUser,
  ChangePasswordInput,
  InvitationAccept,
  InvitationLink,
  InvitationPreview,
  LoginCredentials,
  LoginResponse,
  LoginResult,
  MfaConfirmResponse,
  MfaEnrollResponse,
  MfaFactor,
  PasswordResetConfirm,
  PasswordResetRequest,
} from "./auth-type";

/**
 * The auth domain's API calls. Every dashboard consumer reaches these through
 * `Services.auth.*` (see `@/services`) — never by importing this file directly and never
 * by importing `@schoolhub/api-client` directly.
 */

export type {
  AuthenticatedUser,
  ChangePasswordInput,
  InvitationAccept,
  InvitationLink,
  InvitationPreview,
  LoginCredentials,
  LoginResponse,
  LoginResult,
  MfaConfirmResponse,
  MfaEnrollResponse,
  MfaFactor,
  PasswordResetConfirm,
  PasswordResetRequest,
} from "./auth-type";

/** A completed sign-in's token and the proxy's session marker. */
function startSession(data: { access_token: string; expires_in: number }): void {
  accessTokenStore.set(data.access_token, data.expires_in);
  setSessionCookie();
}

/**
 * Password sign-in. An account with TOTP on gets a challenge instead of a session: no token, no
 * cookie, only the `mfa_token` kept for `verifyMfa`.
 */
export async function login(credentials: LoginCredentials): Promise<LoginResult> {
  const { data } = await authProxyClient.post<LoginResult>(endpoints.auth.login, credentials, {
    // Lets the API set the HttpOnly refresh cookie on this same-origin response.
    credentials: "include",
    skipAuthRefresh: true,
  });
  if (isMfaChallenge(data)) {
    mfaChallengeStore.set(data.mfa_token);
    return data;
  }
  mfaChallengeStore.set(null);
  startSession(data);
  return data;
}

/** Whether a password sign-in is waiting for its second factor in this tab. */
export function hasPendingMfaChallenge(): boolean {
  return mfaChallengeStore.get() !== null;
}

/**
 * Completes a challenged sign-in with a TOTP or recovery code. Every refusal is a 400 or 429 and
 * never a 401, so no refresh is tried and no sign-out happens: a wrong code keeps the challenge
 * for another try; a dead one (`mfa_challenge_invalid`) is dropped, and the user signs in again.
 */
export async function verifyMfa(factor: MfaFactor): Promise<LoginResponse> {
  const mfaToken = mfaChallengeStore.get();
  try {
    const { data } = await authProxyClient.post<LoginResponse>(
      endpoints.auth.mfaVerify,
      { mfa_token: mfaToken ?? "", ...factor },
      { credentials: "include", skipAuthRefresh: true },
    );
    mfaChallengeStore.set(null);
    startSession(data);
    return data;
  } catch (error) {
    if (error instanceof ApiError && error.code === "mfa_challenge_invalid") {
      mfaChallengeStore.set(null);
    }
    throw error;
  }
}

/** A new, not-yet-enabled TOTP secret for the signed-in platform user (a password-only session). */
export async function enrollMfa(): Promise<MfaEnrollResponse> {
  const { data } = await apiClient.post<MfaEnrollResponse>(endpoints.auth.mfaEnroll);
  return data;
}

/**
 * Turns TOTP on with a first code. The answer is a fresh session carrying the second factor and
 * the ten recovery codes, shown once; through the auth proxy, since it sets the refresh cookie.
 */
export async function confirmMfa(code: string): Promise<MfaConfirmResponse> {
  const { data } = await authProxyClient.post<MfaConfirmResponse>(
    endpoints.auth.mfaConfirm,
    { code },
    { credentials: "include" },
  );
  startSession(data);
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

/** Changes the signed-in user's own password (204). A wrong current password or a weak new one
 * is a 400 with the field named. */
export async function changePassword(input: ChangePasswordInput): Promise<void> {
  await apiClient.post(endpoints.auth.changePassword, input);
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

/**
 * The emailed-link endpoints (ADR-0033). All four are unauthenticated and set no cookie, so
 * they call the API directly rather than through the `/api/auth` proxy, and never try a
 * refresh: a 401 here would not mean an expired session. Every unusable link is a 400
 * `invalid_link`.
 */
const LINK_REQUEST = { skipAuthRefresh: true } as const;

/** Who an invitation is for and which school sent it, before a password is set. */
export async function previewInvitation(link: InvitationLink): Promise<InvitationPreview> {
  const { data } = await apiClient.post<InvitationPreview>(
    endpoints.auth.invitationPreview,
    link,
    LINK_REQUEST,
  );
  return data;
}

/** Sets the password and activates the account; `204`. */
export async function acceptInvitation(body: InvitationAccept): Promise<void> {
  await apiClient.post(endpoints.auth.invitationAccept, body, LINK_REQUEST);
}

/** `204` whether or not the email has an account here, so it reveals nothing. */
export async function requestPasswordReset(body: PasswordResetRequest): Promise<void> {
  await apiClient.post(endpoints.auth.passwordReset, body, LINK_REQUEST);
}

/** Sets the new password from a reset link and signs out every device; `204`. */
export async function confirmPasswordReset(body: PasswordResetConfirm): Promise<void> {
  await apiClient.post(endpoints.auth.passwordResetConfirm, body, LINK_REQUEST);
}
