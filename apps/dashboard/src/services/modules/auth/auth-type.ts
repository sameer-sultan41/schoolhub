import type { ApiSchemas } from "@schoolhub/api-client";

// Re-exported, not redefined: these are cross-cutting, no-generated-source types
// (ADR-0017) whose real home is `@schoolhub/types` — consumed well beyond auth, by
// `lib/permissions.ts` and tests across students/staff.
export type { AuthenticatedUser, LoginCredentials, LoginResponse } from "@schoolhub/types";

/** The emailed-link endpoints' generated wire shapes (ADR-0017, ADR-0033). */
export type InvitationLink = ApiSchemas["InvitationLink"];
export type InvitationPreview = ApiSchemas["InvitationPreview"];
export type InvitationAccept = ApiSchemas["InvitationAccept"];
export type PasswordResetRequest = ApiSchemas["PasswordResetRequest"];
export type PasswordResetConfirm = ApiSchemas["PasswordResetConfirm"];
/** `POST /auth/change-password`'s body (generated, ADR-0017). */
export type ChangePasswordInput = ApiSchemas["ChangePassword"];
