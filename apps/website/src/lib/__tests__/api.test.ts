import { ContentFetchError, hostTag, pageTag, readJson, tenantTag } from "../api";

const mockFetch = jest.fn();
const HOST = "cityschool.schoolhub.pk";

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch;
});

function jsonResponse(status: number, body: unknown, statusText = "") {
  return {
    status,
    statusText,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  };
}

describe("readJson", () => {
  it("GETs with the machine token and unwraps the envelope", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { data: { id: "t1" } }));

    const result = await readJson<{ id: string }>("/public/tenants/by-host", {
      host: "cityschool.schoolhub.pk",
    });

    expect(result).toEqual({ id: "t1" });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.test.invalid/api/v1/public/tenants/by-host?host=cityschool.schoolhub.pk",
    );
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-machine-token",
    );
  });

  it("returns null on a 404 instead of throwing", async () => {
    mockFetch.mockResolvedValue(jsonResponse(404, null));

    await expect(readJson("/public/pages", { host: HOST })).resolves.toBeNull();
  });

  it("throws ContentFetchError on any other non-2xx status", async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, null, "Internal Server Error"));

    await expect(readJson("/public/pages", { host: HOST })).rejects.toBeInstanceOf(
      ContentFetchError,
    );
  });

  it("omits undefined query values rather than sending 'undefined'", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { data: null }));

    await readJson("/public/pages", { host: HOST, query: { slug: "about", campus: undefined } });

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe(
      "https://api.test.invalid/api/v1/public/pages?host=cityschool.schoolhub.pk&slug=about",
    );
  });

  it("passes through custom revalidate and tags via next options", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { data: null }));

    await readJson("/public/pages", { host: HOST, revalidate: 60, tags: ["tenant:t1"] });

    const [, init] = mockFetch.mock.calls[0] as [string, { next: Record<string, unknown> }];
    expect(init.next).toEqual({ revalidate: 60, tags: ["tenant:t1"] });
  });

  it("sends a preview token as the header, uncached and untagged", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { data: null }));

    await readJson("/public/pages", { host: HOST, tags: ["tenant:t1"], previewToken: "tok-1" });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Preview-Token"]).toBe("tok-1");
    expect(init.cache).toBe("no-store");
    expect(init.next).toBeUndefined();
    // Never in the query string (SEC-57).
    expect(url).not.toContain("tok-1");
  });

  it("sends no preview header without a token", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { data: null }));

    await readJson("/public/pages", { host: HOST, previewToken: null });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers as Record<string, string>).not.toHaveProperty("X-Preview-Token");
    expect(init.cache).toBeUndefined();
  });
});

describe("tenantTag", () => {
  it("namespaces a tenant id", () => {
    expect(tenantTag("t1")).toBe("tenant:t1");
  });
});

describe("hostTag", () => {
  it("namespaces a host the way the API's domain-change webhook names it", () => {
    expect(hostTag("www.cityschool.edu.pk")).toBe("tenant-host:www.cityschool.edu.pk");
  });
});

describe("pageTag", () => {
  it("namespaces a tenant + path", () => {
    expect(pageTag("t1", "/about")).toBe("tenant:t1:page:/about");
  });

  it("treats an empty path as the home page", () => {
    expect(pageTag("t1", "")).toBe("tenant:t1:page:/");
  });
});
