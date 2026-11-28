import type { ApiSchemas } from "@schoolhub/api-client";
import type { LoginResponse } from "@schoolhub/types";

// Re-exported, not redefined: these are cross-cutting, no-generated-source types
// (ADR-0017) whose real home is `@schoolhub/types` — consumed well beyond auth, by
// `lib/permissions.ts` and tests across students/staff.
export type {
  AuthenticatedUser,
  LoginCredentials,
  LoginResponse,
  LoginResult,
  MfaChallengeResponse,
} from "@schoolhub/types";

/** The emailed-link endpoints' generated wire shapes (ADR-0017, ADR-0033). */
export type InvitationLink = ApiSchemas["InvitationLink"];
export type InvitationPreview = ApiSchemas["InvitationPreview"];
export type InvitationAccept = ApiSchemas["InvitationAccept"];
export type PasswordResetRequest = ApiSchemas["PasswordResetRequest"];
export type PasswordResetConfirm = ApiSchemas["PasswordResetConfirm"];
/** `/auth/impersonation:exchange`'s answer: an access token with no refresh token (ADR-0037). */
export type ImpersonationExchange = ApiSchemas["ImpersonationExchangeResponse"];
/** `POST /auth/change-password`'s body (generated, ADR-0017). */
export type ChangePasswordInput = ApiSchemas["ChangePassword"];

/** `:enroll`'s generated wire shape (`core/rbac/views.py`). */
export type MfaEnrollResponse = ApiSchemas["MfaEnrollResponse"];
/** `:confirm` answers a completed sign-in plus the recovery codes. Its user is the dashboard's
 * `AuthenticatedUser`, as for login and `:verify`, so every sign-in path hands back one model. */
export type MfaConfirmResponse = LoginResponse & { recovery_codes: string[] };
/** One factor for `/auth/mfa:verify`: a TOTP code, or a recovery code; never both. */
export type MfaFactor = { code: string } | { recovery_code: string };
