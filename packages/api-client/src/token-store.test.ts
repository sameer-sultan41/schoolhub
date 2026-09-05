import { ApiError } from "./errors";
import { createAccessTokenStore, refreshAccessToken } from "./token-store";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  new Headers(init.headers).forEach((value, key) => {
    headers.set(key, value);
  });
  return new Response(JSON.stringify(body), { status: 200, ...init, headers });
}

const BASE = { baseUrl: "https://api.test/api/v1" };

/** Narrow a rejection to ApiError; the fulfilled branch throws, so the type is exact. */
async function expectRejection(promise: Promise<unknown>): Promise<ApiError> {
  return promise.then(
    () => {
      throw new Error("expected the refresh to reject, but it resolved");
    },
    (caught: unknown) => caught as ApiError,
  );
}

describe("createAccessTokenStore", () => {
  it("holds a token and reports validity against its expiry", () => {
    const store = createAccessTokenStore();
    expect(store.get()).toBeNull();
    expect(store.isValid()).toBe(false);

    store.set("tok", 900);
    expect(store.get()).toBe("tok");
    expect(store.isValid()).toBe(true);

    store.clear();
    expect(store.get()).toBeNull();
    expect(store.isValid()).toBe(false);
  });

  it("treats a token inside the expiry skew window as already expired", () => {
    const store = createAccessTokenStore();
    // 30s skew: anything expiring sooner than that is refreshed rather than used.
    store.set("tok", 10);
    expect(store.isValid()).toBe(false);
  });

  it("notifies subscribers until they unsubscribe", () => {
    const store = createAccessTokenStore();
    const seen: (string | null)[] = [];
    const unsubscribe = store.subscribe((value) => seen.push(value));

    store.set("a", 900);
    store.clear();
    unsubscribe();
    store.set("b", 900);

    expect(seen).toEqual(["a", null]);
  });
});

describe("refreshAccessToken", () => {
  it("returns the new token on success", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse({ data: { access_token: "fresh", expires_in: 600 } }));

    await expect(refreshAccessToken({ ...BASE, fetchImpl })).resolves.toEqual({
      accessToken: "fresh",
      expiresIn: 600,
    });
  });

  it("defaults expires_in when the server omits it", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse({ data: { access_token: "fresh" } }));

    const result = await refreshAccessToken({ ...BASE, fetchImpl });

    expect(result?.expiresIn).toBe(900);
  });

  it.each([401, 403])("returns null on %s — the session is genuinely over", async (status) => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}, { status }));

    await expect(refreshAccessToken({ ...BASE, fetchImpl })).resolves.toBeNull();
  });

  it("returns null when a 2xx carries no token — the server answered, with nothing", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ data: {} }));

    await expect(refreshAccessToken({ ...BASE, fetchImpl })).resolves.toBeNull();
  });

  it.each([
    [429, "rate_limited"],
    [500, "server_error"],
    [503, "server_error"],
  ])("throws on %s rather than reporting a dead session", async (status, code) => {
    // These used to return null, indistinguishable from an expired refresh token, so a
    // rate-limited refresh signed the user out.
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}, { status }));

    const error = await expectRejection(refreshAccessToken({ ...BASE, fetchImpl }));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
    expect(error.isTransient).toBe(true);
  });

  it("surfaces Retry-After from a throttled refresh", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse({}, { status: 429, headers: { "Retry-After": "42" } }));

    await expect(refreshAccessToken({ ...BASE, fetchImpl })).rejects.toThrow("retry after 42s");
  });

  it("throws a network_error when the request never reaches the server", async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError("offline"));

    const error = await expectRejection(refreshAccessToken({ ...BASE, fetchImpl }));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("network_error");
    expect(error.status).toBe(0);
    expect(error.isTransient).toBe(true);
  });

  it("sends the refresh cookie and no bearer token", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse({ data: { access_token: "fresh" } }));

    await refreshAccessToken({ ...BASE, fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test/api/v1/auth/refresh");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
  });
});
