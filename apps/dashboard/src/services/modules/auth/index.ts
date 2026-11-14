import {
  acceptInvitation,
  changePassword,
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
  changePassword,
  previewInvitation,
  acceptInvitation,
  requestPasswordReset,
  confirmPasswordReset,
};
export type {
  AuthenticatedUser,
  ChangePasswordInput,
  InvitationPreview,
  LoginCredentials,
  LoginResponse,
} from "./auth-service";
