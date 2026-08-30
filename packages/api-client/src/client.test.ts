import { ApiClient, buildQueryString } from "./client";
import { ApiError } from "./errors";
import { collectPages } from "./pagination";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  // Headers is a class, not a plain object — init.headers may be a real Headers instance
  // (HeadersInit's type includes it), and spreading one copies nothing useful. Merge
  // through the Headers constructor instead, which accepts any HeadersInit.
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("X-Request-ID", "req-1");
  return new Response(JSON.stringify(body), { status: 200, ...init, headers });
}

function authHeaderOf(mock: jest.Mock, call: number): string | null {
  const init = mock.mock.calls[call]?.[1] as RequestInit | undefined;
  return new Headers(init?.headers).get("Authorization");
}

describe("buildQueryString", () => {
  it("drops empty values and repeats array members", () => {
    expect(
      buildQueryString({ search: "khan", cursor: undefined, status: ["active", "trial"], page: 2 }),
    ).toBe("?search=khan&status=active&status=trial&page=2");
  });
});

describe("ApiClient", () => {
  it("unwraps the { data, meta } envelope and surfaces the request id", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: { id: "s1" }, meta: { pagination: { next_cursor: null } } }),
      );
    const client = new ApiClient({ baseUrl: "https://api.test/api/v1", fetchImpl });

    const result = await client.get<{ id: string }>("/students/s1");

    expect(result.data).toEqual({ id: "s1" });
    expect(result.meta?.pagination).toEqual({ next_cursor: null });
    expect(result.requestId).toBe("req-1");
  });

  it("sends the access token as a bearer header", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = new ApiClient({
      baseUrl: "https://api.test/api/v1",
      fetchImpl,
      getAccessToken: () => "token-abc",
    });

    await client.get("/students");

    expect(authHeaderOf(fetchImpl, 0)).toBe("Bearer token-abc");
  });

  it("normalizes the error envelope into an ApiError with field details", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "validation_error",
            message: "Invalid payload.",
            details: [{ field: "email", issue: "Enter a valid email address." }],
            request_id: "req-9",
          },
        },
        { status: 400 },
      ),
    );
    const client = new ApiClient({ baseUrl: "https://api.test/api/v1", fetchImpl });

    const error = (await client.post("/students", {}).catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("validation_error");
    expect(error.isValidation).toBe(true);
    expect(error.requestId).toBe("req-9");
    expect(error.fieldErrors()).toEqual({ email: "Enter a valid email address." });
  });

  it("normalizes a transport failure into code network_error", async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const client = new ApiClient({ baseUrl: "https://api.test/api/v1", fetchImpl });

    const error = (await client.get("/students").catch((e: unknown) => e)) as ApiError;

    expect(error.code).toBe("network_error");
    expect(error.status).toBe(0);
  });

  it("refreshes once on a 401 and replays the request with the new token", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "token_expired", message: "expired", request_id: "r" } },
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { id: "s1" } }));
    const refreshAccessToken = jest.fn().mockResolvedValue("fresh-token");

    const client = new ApiClient({
      baseUrl: "https://api.test/api/v1",
      fetchImpl,
      getAccessToken: () => "stale-token",
      refreshAccessToken,
    });

    const result = await client.get<{ id: string }>("/students/s1");

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(result.data).toEqual({ id: "s1" });
    expect(authHeaderOf(fetchImpl, 1)).toBe("Bearer fresh-token");
  });

  it("shares one refresh across concurrent 401s", async () => {
    const fetchImpl = jest.fn().mockImplementation((_url: string, init: RequestInit) => {
      const auth = new Headers(init.headers).get("Authorization");
      return Promise.resolve(
        auth === "Bearer fresh-token"
          ? jsonResponse({ data: { ok: true } })
          : jsonResponse(
              { error: { code: "token_expired", message: "expired", request_id: "r" } },
              { status: 401 },
            ),
      );
    });
    // The refresh resolves on a timer so every concurrent 401 lands while it is in flight.
    const refreshAccessToken = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => {
            resolve("fresh-token");
          }, 10);
        }),
    );
    let token = "stale-token";
    const client = new ApiClient({
      baseUrl: "https://api.test/api/v1",
      fetchImpl,
      getAccessToken: () => token,
      refreshAccessToken: async () => {
        token = await refreshAccessToken();
        return token;
      },
    });

    await Promise.all([client.get("/students"), client.get("/staff"), client.get("/classes")]);

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("gives up when the refresh fails and reports it exactly once", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "authentication_failed", message: "nope", request_id: "r" } },
          { status: 401 },
        ),
      );
    const onUnauthorized = jest.fn();
    const client = new ApiClient({
      baseUrl: "https://api.test/api/v1",
      fetchImpl,
      refreshAccessToken: () => Promise.resolve(null),
      onUnauthorized,
    });

    await expect(client.get("/students")).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("returns undefined data for 204 responses", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new ApiClient({ baseUrl: "https://api.test/api/v1", fetchImpl });

    const result = await client.delete("/students/s1");

    expect(result.status).toBe(204);
    expect(result.data).toBeUndefined();
  });
});

describe("cursor pagination", () => {
  it("follows next_cursor until it is null", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "a" }],
          meta: { pagination: { next_cursor: "c2", previous_cursor: null, page_size: 1 } },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "b" }],
          meta: { pagination: { next_cursor: null, previous_cursor: "c1", page_size: 1 } },
        }),
      );
    const client = new ApiClient({ baseUrl: "https://api.test/api/v1", fetchImpl });

    const items = await collectPages<{ id: string }>(client, "/students", {
      query: { page_size: 1 },
    });

    expect(items).toEqual([{ id: "a" }, { id: "b" }]);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("cursor=c2");
  });

  it("clamps page_size to the documented maximum of 100", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = new ApiClient({ baseUrl: "https://api.test/api/v1", fetchImpl });

    await collectPages(client, "/students", { query: { page_size: 5000 } });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("page_size=100");
  });
});
