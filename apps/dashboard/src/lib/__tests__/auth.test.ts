import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockRefreshAccessToken = jest.fn();
const mockClientConfigs: ApiClientConfig[] = [];

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((config: ApiClientConfig) => {
      mockClientConfigs.push(config);
      return { post: jest.fn(), get: jest.fn(), refresh: jest.fn() };
    }),
    refreshAccessToken: mockRefreshAccessToken,
  };
});

async function importApiClient() {
  return import("@schoolhub/api-client");
}

describe("auth", () => {
  beforeEach(() => {
    jest.resetModules();
    mockRefreshAccessToken.mockReset();
    mockClientConfigs.length = 0;
  });

  it("wires two clients: one direct, one through the auth proxy", async () => {
    await import("../auth");
    expect(mockClientConfigs).toHaveLength(2);
    expect(mockClientConfigs[1]?.baseUrl).toBe("/api/auth");
  });

  describe("setUnauthorizedHandler", () => {
    it("lets the app override the default 401 handler", async () => {
      const { setUnauthorizedHandler, accessTokenStore } = await import("../auth");
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
      const { accessTokenStore } = await import("../auth");
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
      const { accessTokenStore } = await import("../auth");
      const directClientConfig = mockClientConfigs[0];
      accessTokenStore.set("at-6", 900);

      expect(directClientConfig?.getAccessToken?.()).toBe("at-6");
    });

    it("refreshAccessToken clears the store and resolves null when the proxy has nothing", async () => {
      const { accessTokenStore } = await import("../auth");
      const directClientConfig = mockClientConfigs[0];
      accessTokenStore.set("stale", 900);
      mockRefreshAccessToken.mockResolvedValueOnce(null);

      await expect(directClientConfig?.refreshAccessToken?.()).resolves.toBeNull();
      expect(accessTokenStore.get()).toBeNull();
    });

    it("refreshAccessToken stores and returns the new token when the proxy refreshes", async () => {
      const { accessTokenStore } = await import("../auth");
      const directClientConfig = mockClientConfigs[0];
      mockRefreshAccessToken.mockResolvedValueOnce({ accessToken: "at-7", expiresIn: 900 });

      await expect(directClientConfig?.refreshAccessToken?.()).resolves.toBe("at-7");
      expect(accessTokenStore.get()).toBe("at-7");
    });

    it("refreshAccessToken lets a transient failure through with the token untouched", async () => {
      // The `.catch(() => null)` that used to wrap this call turned a throttled or
      // unreachable refresh into "session over", clearing a perfectly good session.
      const { accessTokenStore } = await import("../auth");
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
      const { accessTokenStore } = await import("../auth");
      const authProxyClientConfig = mockClientConfigs[1];
      accessTokenStore.set("at-8", 900);

      expect(authProxyClientConfig?.getAccessToken?.()).toBe("at-8");
    });
  });
});
