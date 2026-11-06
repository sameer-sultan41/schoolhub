import { changePassword, fetchCurrentUser, login, logout, restoreSession } from "./auth-service";

export const AuthService = {
  login,
  logout,
  fetchCurrentUser,
  restoreSession,
  changePassword,
};
export type {
  AuthenticatedUser,
  ChangePasswordInput,
  LoginCredentials,
  LoginResponse,
} from "./auth-service";
