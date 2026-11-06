import {
  acceptInvitation,
  confirmPasswordReset,
  fetchCurrentUser,
  login,
  logout,
  previewInvitation,
  requestPasswordReset,
  restoreSession,
} from "./auth-service";

export const AuthService = {
  login,
  logout,
  fetchCurrentUser,
  restoreSession,
  previewInvitation,
  acceptInvitation,
  requestPasswordReset,
  confirmPasswordReset,
};
export type {
  AuthenticatedUser,
  InvitationPreview,
  LoginCredentials,
  LoginResponse,
} from "./auth-service";
