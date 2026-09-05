import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockPost = jest.fn();
const mockGet = jest.fn();
const mockRefreshAccessToken = jest.fn();
const mockClientConfigs: ApiClientConfig[] = [];

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((config: ApiClientConfig) => {
      mockClientConfigs.push(config);
      return { post: mockPost, get: mockGet };
    }),
    refreshAccessToken: mockRefreshAccessToken,
  };
});

// Every test below re-imports "@schoolhub/api-client" fresh (never a stale top-level
// capture): jest.resetModules() in beforeEach means each test's jest.mock factory calls
// its own jest.requireActual, producing a NEW ApiError class each time — a class
// captured once at file-load time would fail `instanceof` checks against errors thrown
// by that test's own (later, different) module instance.
async function importApiClient() {
  return import("@schoolhub/api-client");
}

describe("auth", () => {
  beforeEach(() => {
    jest.resetModules();
    mockPost.mockReset();
    mockGet.mockReset();
    mockRefreshAccessToken.mockReset();
    mockClientConfigs.length = 0;
    document.cookie = "sh_session=; path=/; max-age=0";
  });

  it("wires two clients: one direct, one through the auth proxy", async () => {
    await import("./auth");
    expect(mockClientConfigs).toHaveLength(2);
    expect(mockClientConfigs[1]?.baseUrl).toBe("/api/auth");
  });

  describe("login", () => {
    it("stores the access token and sets the session cookie", async () => {
      const { login, accessTokenStore } = await import("./auth");
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
      const { login, logout, accessTokenStore } = await import("./auth");
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
      const { logout } = await import("./auth");
      mockPost.mockRejectedValueOnce(new Error("network down"));

      await expect(logout()).rejects.toThrow("network down");
    });
  });

  describe("fetchCurrentUser", () => {
    it("returns the authenticated user payload", async () => {
      const { fetchCurrentUser } = await import("./auth");
      mockGet.mockResolvedValueOnce({ data: { id: "u1", email: "a@test.invalid" } });

      const user = await fetchCurrentUser();

      expect(mockGet).toHaveBeenCalledWith("/auth/me", { credentials: "include" });
      expect(user).toEqual({ id: "u1", email: "a@test.invalid" });
    });
  });

  describe("restoreSession", () => {
    it("returns null when the refresh cookie has nothing to offer", async () => {
      const { restoreSession } = await import("./auth");
      mockRefreshAccessToken.mockResolvedValueOnce(null);

      await expect(restoreSession()).resolves.toBeNull();
      expect(mockGet).not.toHaveBeenCalled();
    });

    it("refreshes, then fetches the user, on a cold load", async () => {
      const { restoreSession, accessTokenStore } = await import("./auth");
      mockRefreshAccessToken.mockResolvedValueOnce({ accessToken: "at-2", expiresIn: 900 });
      mockGet.mockResolvedValueOnce({ data: { id: "u2" } });

      const user = await restoreSession();

      expect(accessTokenStore.get()).toBe("at-2");
      expect(user).toEqual({ id: "u2" });
      expect(document.cookie).toContain("sh_session=1");
    });

    it("clears state and returns null when the user fetch fails", async () => {
      const { restoreSession, accessTokenStore } = await import("./auth");
      mockRefreshAccessToken.mockResolvedValueOnce({ accessToken: "at-3", expiresIn: 900 });
      mockGet.mockRejectedValueOnce(new Error("boom"));

      await expect(restoreSession()).resolves.toBeNull();
      expect(accessTokenStore.get()).toBeNull();
    });

    it("rethrows a throttled refresh instead of reporting a signed-out session", async () => {
      // Returning null here reads as "signed out" all the way up to the app shell, so a
      // cold load during a throttle window used to drop a still-valid session at /login.
      const { restoreSession } = await import("./auth");
      const { ApiError } = await importApiClient();
      const throttled = new ApiError({
        code: "rate_limited",
        message: "Too many requests.",
        status: 429,
        url: "/api/auth/refresh",
      });
      mockRefreshAccessToken.mockRejectedValueOnce(throttled);

      await expect(restoreSession()).rejects.toBe(throttled);
      expect(mockGet).not.toHaveBeenCalled();
    });

    it("rethrows a transient user-fetch failure and keeps the session intact", async () => {
      const { restoreSession, accessTokenStore } = await import("./auth");
      const { ApiError } = await importApiClient();
      mockRefreshAccessToken.mockResolvedValueOnce({ accessToken: "at-8", expiresIn: 900 });
      mockGet.mockRejectedValueOnce(
        new ApiError({ code: "server_error", message: "down", status: 503, url: "/auth/me" }),
      );

      await expect(restoreSession()).rejects.toBeInstanceOf(ApiError);
      expect(accessTokenStore.get()).toBe("at-8");
    });
  });

  describe("setUnauthorizedHandler", () => {
    it("lets the app override the default 401 handler", async () => {
      const { setUnauthorizedHandler, accessTokenStore } = await import("./auth");
      const handler = jest.fn();
      setUnauthorizedHandler(handler);

      const { ApiError } = await importApiClient();
      const directClientConfig = mockClientConfigs[0];
      accessTokenStore.set("at-4", 900);
      directClientConfig?.onUnauthorized?.(
        new ApiError({ code: "unauthenticated", message: "gone", status: 401, url: "/x" }),
      );

      expect(accessTokenStore.get()).toBeNull();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("the default handler (before any override) just clears the token store", async () => {
      const { accessTokenStore } = await import("./auth");
      const { ApiError } = await importApiClient();
      const directClientConfig = mockClientConfigs[0];
      accessTokenStore.set("at-5", 900);

      expect(() =>
        directClientConfig?.onUnauthorized?.(
          new ApiError({ code: "unauthenticated", message: "gone", status: 401, url: "/x" }),
        ),
      ).not.toThrow();

      expect(accessTokenStore.get()).toBeNull();
    });
  });

  describe("the direct client's getAccessToken/refreshAccessToken config", () => {
    it("getAccessToken reads whatever is currently in the token store", async () => {
      const { accessTokenStore } = await import("./auth");
      const directClientConfig = mockClientConfigs[0];
      accessTokenStore.set("at-6", 900);

      expect(directClientConfig?.getAccessToken?.()).toBe("at-6");
    });

    it("refreshAccessToken clears the store and resolves null when the proxy has nothing", async () => {
      const { accessTokenStore } = await import("./auth");
      const directClientConfig = mockClientConfigs[0];
      accessTokenStore.set("stale", 900);
      mockRefreshAccessToken.mockResolvedValueOnce(null);

      await expect(directClientConfig?.refreshAccessToken?.()).resolves.toBeNull();
      expect(accessTokenStore.get()).toBeNull();
    });

    it("refreshAccessToken stores and returns the new token when the proxy refreshes", async () => {
      const { accessTokenStore } = await import("./auth");
      const directClientConfig = mockClientConfigs[0];
      mockRefreshAccessToken.mockResolvedValueOnce({ accessToken: "at-7", expiresIn: 900 });

      await expect(directClientConfig?.refreshAccessToken?.()).resolves.toBe("at-7");
      expect(accessTokenStore.get()).toBe("at-7");
    });

    it("refreshAccessToken lets a transient failure through with the token untouched", async () => {
      // The `.catch(() => null)` that used to wrap this call turned a throttled or
      // unreachable refresh into "session over", clearing a perfectly good session.
      const { accessTokenStore } = await import("./auth");
      const { ApiError } = await importApiClient();
      const directClientConfig = mockClientConfigs[0];
      accessTokenStore.set("still-good", 900);
      mockRefreshAccessToken.mockRejectedValueOnce(
        new ApiError({
          code: "rate_limited",
          message: "Too many requests.",
          status: 429,
          url: "/api/auth/refresh",
        }),
      );

      await expect(directClientConfig?.refreshAccessToken?.()).rejects.toBeInstanceOf(ApiError);
      expect(accessTokenStore.get()).toBe("still-good");
    });
  });

  describe("the auth-proxy client's getAccessToken config", () => {
    it("also reads from the shared token store", async () => {
      const { accessTokenStore } = await import("./auth");
      const authProxyClientConfig = mockClientConfigs[1];
      accessTokenStore.set("at-8", 900);

      expect(authProxyClientConfig?.getAccessToken?.()).toBe("at-8");
    });
  });
});
