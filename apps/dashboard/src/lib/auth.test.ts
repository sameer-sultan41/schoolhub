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

// A static `import { ApiError } from "@schoolhub/api-client"` here would be hoisted by
// the ES module loader ABOVE the `const mock* = jest.fn()` declarations above (imports
// always run first, regardless of source order or jest.mock's own hoisting) — the mock
// factory would then run before those consts are initialized, throwing a TDZ
// ReferenceError. jest.requireActual is a plain function call, not hoisted, so it runs
// exactly where it's written; ApiError itself is unaffected by the mock (spread through
// from `actual` above) so this is the real class either way.
const { ApiError } = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");

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
  });

  describe("setUnauthorizedHandler", () => {
    it("lets the app override the default 401 handler", async () => {
      const { setUnauthorizedHandler, accessTokenStore } = await import("./auth");
      const handler = jest.fn();
      setUnauthorizedHandler(handler);

      const directClientConfig = mockClientConfigs[0];
      accessTokenStore.set("at-4", 900);
      directClientConfig?.onUnauthorized?.(
        new ApiError({ code: "unauthenticated", message: "gone", status: 401, url: "/x" }),
      );

      expect(accessTokenStore.get()).toBeNull();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
