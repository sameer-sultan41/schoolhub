import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockPost = jest.fn();
const mockGet = jest.fn();
const mockRefresh = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      post: mockPost,
      get: mockGet,
      refresh: mockRefresh,
    })),
    refreshAccessToken: jest.fn(),
  };
});

async function importApiClient() {
  return import("@schoolhub/api-client");
}

describe("AuthService", () => {
  beforeEach(() => {
    jest.resetModules();
    mockPost.mockReset();
    mockGet.mockReset();
    mockRefresh.mockReset();
    document.cookie = "sh_session=; path=/; max-age=0";
  });

  describe("login", () => {
    it("stores the access token and sets the session cookie", async () => {
      const { login } = await import("../auth-service");
      const { accessTokenStore } = await import("@/lib/auth");
      mockPost.mockResolvedValueOnce({
        data: {
          access_token: "at-1",
          expires_in: 900,
          user: {
            id: "u1",
            email: null,
            phone: null,
            full_name: "Test User",
            avatar_url: null,
            locale: "en",
            tenant_id: "t1",
            tenant_summary: { name: "City School", slug: "city-school" },
            roles: [],
            permissions: [],
          },
        },
      });

      const result = await login({ identifier: "admin", password: "secret" });

      expect(mockPost).toHaveBeenCalledWith(
        "/login",
        { identifier: "admin", password: "secret" },
        expect.objectContaining({ credentials: "include", skipAuthRefresh: true }),
      );
      expect(accessTokenStore.get()).toBe("at-1");
      expect(document.cookie).toContain("sh_session=1");
      expect(result).toEqual(expect.objectContaining({ access_token: "at-1" }));
    });

    it("keeps an mfa_required challenge instead of starting a session", async () => {
      const { hasPendingMfaChallenge, login } = await import("../auth-service");
      const { accessTokenStore } = await import("@/lib/auth");
      // `core/rbac/views.py` LoginView's challenge body: no token, no user, no cookie.
      mockPost.mockResolvedValueOnce({ data: { mfa_required: true, mfa_token: "challenge-1" } });

      const result = await login({ identifier: "ops", password: "secret" });

      expect(result).toEqual({ mfa_required: true, mfa_token: "challenge-1" });
      expect(accessTokenStore.get()).toBeNull();
      expect(document.cookie).not.toContain("sh_session=1");
      expect(hasPendingMfaChallenge()).toBe(true);
    });
  });

  describe("second factor", () => {
    const SIGNED_IN = {
      access_token: "at-otp",
      expires_in: 900,
      user: {
        id: "op1",
        email: "ops@schoolhub.test",
        phone: null,
        full_name: "Platform Operator",
        avatar_url: null,
        locale: "en",
        tenant_id: "",
        tenant_summary: null,
        roles: [],
        permissions: ["platform.tenant.view"],
        is_platform: true,
        mfa_enabled: true,
      },
    };

    async function challenged() {
      const service = await import("../auth-service");
      mockPost.mockResolvedValueOnce({ data: { mfa_required: true, mfa_token: "challenge-1" } });
      await service.login({ identifier: "ops", password: "secret" });
      return service;
    }

    it("trades the challenge and a code for a session through the auth proxy", async () => {
      const { hasPendingMfaChallenge, verifyMfa } = await challenged();
      const { accessTokenStore } = await import("@/lib/auth");
      mockPost.mockResolvedValueOnce({ data: SIGNED_IN });

      const result = await verifyMfa({ code: "123456" });

      expect(mockPost).toHaveBeenLastCalledWith(
        "/mfa:verify",
        { mfa_token: "challenge-1", code: "123456" },
        expect.objectContaining({ credentials: "include", skipAuthRefresh: true }),
      );
      expect(result.user.is_platform).toBe(true);
      expect(accessTokenStore.get()).toBe("at-otp");
      expect(document.cookie).toContain("sh_session=1");
      // Spent: the server takes a challenge once.
      expect(hasPendingMfaChallenge()).toBe(false);
    });

    it("keeps the challenge after a wrong code, and drops a dead one", async () => {
      const { hasPendingMfaChallenge, verifyMfa } = await challenged();
      const { ApiError } = await importApiClient();
      const { accessTokenStore } = await import("@/lib/auth");
      mockPost.mockRejectedValueOnce(
        new ApiError({ code: "invalid_mfa_code", message: "Wrong.", status: 400, url: "/x" }),
      );

      await expect(verifyMfa({ code: "000000" })).rejects.toBeInstanceOf(ApiError);
      expect(hasPendingMfaChallenge()).toBe(true);
      expect(accessTokenStore.get()).toBeNull();

      mockPost.mockRejectedValueOnce(
        new ApiError({
          code: "mfa_challenge_invalid",
          message: "Expired.",
          status: 400,
          url: "/x",
        }),
      );
      await expect(verifyMfa({ recovery_code: "AAAA-BBBB-CCCC-DDDD" })).rejects.toBeInstanceOf(
        ApiError,
      );
      expect(hasPendingMfaChallenge()).toBe(false);
    });

    it("enrols directly against the API and confirms through the auth proxy", async () => {
      const { confirmMfa, enrollMfa } = await import("../auth-service");
      const { accessTokenStore } = await import("@/lib/auth");
      mockPost
        .mockResolvedValueOnce({
          data: { secret: "test-secret", otpauth_uri: "otpauth://totp/SchoolHub:ops" },
        })
        .mockResolvedValueOnce({ data: { ...SIGNED_IN, recovery_codes: ["AAAA-BBBB-CCCC-DDDD"] } });

      const enrolment = await enrollMfa();
      const confirmed = await confirmMfa("123456");

      expect(enrolment.otpauth_uri).toBe("otpauth://totp/SchoolHub:ops");
      expect(mockPost).toHaveBeenNthCalledWith(1, "/auth/mfa:enroll");
      expect(mockPost).toHaveBeenNthCalledWith(
        2,
        "/mfa:confirm",
        { code: "123456" },
        expect.objectContaining({ credentials: "include" }),
      );
      expect(confirmed.recovery_codes).toEqual(["AAAA-BBBB-CCCC-DDDD"]);
      expect(accessTokenStore.get()).toBe("at-otp");
      expect(document.cookie).toContain("sh_session=1");
    });
  });

  describe("logout", () => {
    it("clears the token and cookie even when the request fails with an ApiError", async () => {
      const { login, logout } = await import("../auth-service");
      const { accessTokenStore } = await import("@/lib/auth");
      const { ApiError } = await importApiClient();
      mockPost.mockResolvedValueOnce({
        data: {
          access_token: "at-1",
          expires_in: 900,
          user: {
            id: "u1",
            email: null,
            phone: null,
            full_name: "Test User",
            avatar_url: null,
            locale: "en",
            tenant_id: "t1",
            tenant_summary: { name: "City School", slug: "city-school" },
            roles: [],
            permissions: [],
          },
        },
      });
      await login({ identifier: "admin", password: "secret" });

      mockPost.mockRejectedValueOnce(
        new ApiError({ code: "unauthenticated", message: "gone", status: 401, url: "/logout" }),
      );

      await expect(logout()).resolves.toBeUndefined();
      expect(accessTokenStore.get()).toBeNull();
      expect(document.cookie).not.toContain("sh_session=1");
    });

    it("re-throws a non-ApiError failure", async () => {
      const { logout } = await import("../auth-service");
      mockPost.mockRejectedValueOnce(new Error("network down"));

      await expect(logout()).rejects.toThrow("network down");
    });
  });

  describe("changePassword", () => {
    it("POSTs both passwords to the change-password path", async () => {
      const { changePassword } = await import("../auth-service");
      mockPost.mockResolvedValueOnce({ data: undefined });

      await changePassword({ current_password: "old-secret-1", new_password: "new-secret-123" });

      expect(mockPost).toHaveBeenCalledWith("/auth/change-password", {
        current_password: "old-secret-1",
        new_password: "new-secret-123",
      });
    });
  });

  describe("fetchCurrentUser", () => {
    it("returns the authenticated user payload", async () => {
      const { fetchCurrentUser } = await import("../auth-service");
      mockGet.mockResolvedValueOnce({ data: { id: "u1", email: "a@test.invalid" } });

      const user = await fetchCurrentUser();

      expect(mockGet).toHaveBeenCalledWith("/auth/me", { credentials: "include" });
      expect(user).toEqual({ id: "u1", email: "a@test.invalid" });
    });
  });

  describe("restoreSession", () => {
    it("returns null when the refresh cookie has nothing to offer", async () => {
      const { restoreSession } = await import("../auth-service");
      mockRefresh.mockResolvedValueOnce(null);

      await expect(restoreSession()).resolves.toBeNull();
      expect(mockGet).not.toHaveBeenCalled();
    });

    it("refreshes, then fetches the user, on a cold load", async () => {
      const { restoreSession } = await import("../auth-service");
      mockRefresh.mockResolvedValueOnce("at-2");
      mockGet.mockResolvedValueOnce({ data: { id: "u2" } });

      const user = await restoreSession();

      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(user).toEqual({ id: "u2" });
      expect(document.cookie).toContain("sh_session=1");
    });

    it("clears state and returns null when the user fetch fails", async () => {
      const { restoreSession } = await import("../auth-service");
      const { accessTokenStore } = await import("@/lib/auth");
      mockRefresh.mockResolvedValueOnce("at-3");
      mockGet.mockRejectedValueOnce(new Error("boom"));

      await expect(restoreSession()).resolves.toBeNull();
      expect(accessTokenStore.get()).toBeNull();
    });

    it("rethrows a throttled refresh instead of reporting a signed-out session", async () => {
      // Returning null here reads as "signed out" all the way up to the app shell, so a
      // cold load during a throttle window used to drop a still-valid session at /login.
      const { restoreSession } = await import("../auth-service");
      const { ApiError } = await importApiClient();
      const throttled = new ApiError({
        code: "rate_limited",
        message: "Too many requests.",
        status: 429,
        url: "/api/auth/refresh",
      });
      mockRefresh.mockRejectedValueOnce(throttled);

      await expect(restoreSession()).rejects.toBe(throttled);
      expect(mockGet).not.toHaveBeenCalled();
    });

    it("rethrows a transient user-fetch failure and keeps the session intact", async () => {
      const { restoreSession } = await import("../auth-service");
      const { accessTokenStore } = await import("@/lib/auth");
      const { ApiError } = await importApiClient();
      mockRefresh.mockResolvedValueOnce("at-8");
      accessTokenStore.set("at-8", 900);
      mockGet.mockRejectedValueOnce(
        new ApiError({ code: "server_error", message: "down", status: 503, url: "/auth/me" }),
      );

      await expect(restoreSession()).rejects.toBeInstanceOf(ApiError);
      expect(accessTokenStore.get()).toBe("at-8");
    });
  });

  describe("emailed-link endpoints", () => {
    it("previewInvitation posts the link and returns the preview, without a refresh retry", async () => {
      const { previewInvitation } = await import("../auth-service");
      const preview = {
        email: "parent@example.com",
        school_name: "City School",
        expires_at: "2026-11-12T10:00:00Z",
      };
      mockPost.mockResolvedValueOnce({ data: preview });

      await expect(previewInvitation({ school: "city", token: "tok-1" })).resolves.toEqual(preview);
      expect(mockPost).toHaveBeenCalledWith(
        "/auth/invitations:preview",
        { school: "city", token: "tok-1" },
        { skipAuthRefresh: true },
      );
    });

    it("acceptInvitation posts the link and the password", async () => {
      const { acceptInvitation } = await import("../auth-service");
      mockPost.mockResolvedValueOnce({ data: undefined });

      await acceptInvitation({ school: "city", token: "tok-1", password: "long-enough-pass" });

      expect(mockPost).toHaveBeenCalledWith(
        "/auth/invitations:accept",
        { school: "city", token: "tok-1", password: "long-enough-pass" },
        { skipAuthRefresh: true },
      );
    });

    it("requestPasswordReset posts the school and email", async () => {
      const { requestPasswordReset } = await import("../auth-service");
      mockPost.mockResolvedValueOnce({ data: undefined });

      await requestPasswordReset({ school: "city", email: "staff@example.com" });

      expect(mockPost).toHaveBeenCalledWith(
        "/auth/password-reset",
        { school: "city", email: "staff@example.com" },
        { skipAuthRefresh: true },
      );
    });

    it("confirmPasswordReset posts the link and the new password", async () => {
      const { confirmPasswordReset } = await import("../auth-service");
      mockPost.mockResolvedValueOnce({ data: undefined });

      await confirmPasswordReset({
        school: "city",
        uid: "dWlk",
        token: "tok-2",
        new_password: "long-enough-pass",
      });

      expect(mockPost).toHaveBeenCalledWith(
        "/auth/password-reset:confirm",
        { school: "city", uid: "dWlk", token: "tok-2", new_password: "long-enough-pass" },
        { skipAuthRefresh: true },
      );
    });
  });

  describe("impersonation (ADR-0037)", () => {
    afterEach(() => {
      window.sessionStorage.clear();
    });

    it("exchanges the handoff code straight with the API and makes its token the session", async () => {
      const { exchangeImpersonationCode } = await import("../auth-service");
      const { accessTokenStore, isImpersonating } = await import("@/lib/auth");
      const { impersonationToken, schoolToken } = await import("@/test-fixtures/impersonation");
      // Whatever this tab held before is replaced, never mixed with the new session.
      accessTokenStore.set(schoolToken(), 900);
      mockPost.mockResolvedValueOnce({ data: { access: impersonationToken(), expires_in: 1800 } });

      await exchangeImpersonationCode("handoff-code");

      expect(mockPost).toHaveBeenCalledWith(
        "/auth/impersonation:exchange",
        { code: "handoff-code" },
        expect.objectContaining({ skipAuthRefresh: true }),
      );
      expect(accessTokenStore.get()).toBe(impersonationToken());
      expect(isImpersonating()).toBe(true);
      expect(document.cookie).toContain("sh_session=1");
    });

    it("a refused code leaves no session behind", async () => {
      const { exchangeImpersonationCode } = await import("../auth-service");
      const { accessTokenStore } = await import("@/lib/auth");
      const { schoolToken } = await import("@/test-fixtures/impersonation");
      const { ApiError } = await importApiClient();
      accessTokenStore.set(schoolToken(), 900);
      const refused = new ApiError({
        code: "invalid_link",
        message: "This link is no longer valid.",
        status: 400,
        url: "/auth/impersonation:exchange",
      });
      mockPost.mockRejectedValueOnce(refused);

      await expect(exchangeImpersonationCode("spent")).rejects.toBe(refused);
      expect(accessTokenStore.get()).toBeNull();
    });

    it("ending releases the grant and drops the session, even when the grant already ended", async () => {
      const { endImpersonation } = await import("../auth-service");
      const { accessTokenStore, startImpersonatedSession } = await import("@/lib/auth");
      const { impersonationToken } = await import("@/test-fixtures/impersonation");
      const { ApiError } = await importApiClient();
      startImpersonatedSession(impersonationToken(), 1800);
      mockPost.mockRejectedValueOnce(
        new ApiError({ code: "impersonation_ended", message: "ended", status: 401, url: "/x" }),
      );

      await expect(endImpersonation()).resolves.toBeUndefined();

      expect(mockPost).toHaveBeenCalledWith(
        "/auth/impersonation:end",
        undefined,
        expect.objectContaining({ skipAuthRefresh: true }),
      );
      expect(accessTokenStore.get()).toBeNull();
      expect(document.cookie).not.toContain("sh_session=1");
    });

    it("signing out of an impersonated session ends the grant, never the browser's own cookie", async () => {
      const { logout } = await import("../auth-service");
      const { startImpersonatedSession } = await import("@/lib/auth");
      const { impersonationToken } = await import("@/test-fixtures/impersonation");
      startImpersonatedSession(impersonationToken(), 1800);
      mockPost.mockResolvedValueOnce({ data: undefined });

      await logout();

      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).toHaveBeenCalledWith(
        "/auth/impersonation:end",
        undefined,
        expect.objectContaining({ skipAuthRefresh: true }),
      );
    });
  });

  describe("a normal sign-in in a tab that held an impersonation", () => {
    afterEach(() => {
      window.sessionStorage.clear();
    });

    it("is a normal session again: sign-out revokes it through /logout", async () => {
      const { login, logout } = await import("../auth-service");
      const { isImpersonating, startImpersonatedSession, endImpersonatedSession } =
        await import("@/lib/auth");
      const { impersonationToken, schoolToken } = await import("@/test-fixtures/impersonation");
      startImpersonatedSession(impersonationToken(), 1800);
      endImpersonatedSession();
      mockPost.mockResolvedValueOnce({
        data: { access_token: schoolToken(), expires_in: 900, user: { id: "u1" } },
      });
      await login({ identifier: "admin", password: "secret" });
      expect(isImpersonating()).toBe(false);

      mockPost.mockResolvedValueOnce({ data: undefined });
      await logout();

      expect(mockPost).toHaveBeenLastCalledWith(
        "/logout",
        undefined,
        expect.objectContaining({ credentials: "include" }),
      );
      // Gone with the token, the tab is no longer read as an impersonation either.
      expect(isImpersonating()).toBe(false);
    });
  });
});
