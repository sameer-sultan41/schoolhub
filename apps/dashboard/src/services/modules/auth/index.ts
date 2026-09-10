import { fetchCurrentUser, login, logout, restoreSession } from "./auth-service";

export const AuthService = {
  login,
  logout,
  fetchCurrentUser,
  restoreSession,
};
