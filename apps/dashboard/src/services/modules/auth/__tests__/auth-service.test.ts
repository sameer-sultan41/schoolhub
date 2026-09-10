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
      expect(result.access_token).toBe("at-1");
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
});
