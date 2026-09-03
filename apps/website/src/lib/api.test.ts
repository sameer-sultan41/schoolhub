import { ContentFetchError, pageTag, readJson, tenantTag } from "./api";

const mockFetch = jest.fn();

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
      query: { host: "cityschool.schoolhub.pk" },
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

    await expect(readJson("/public/pages/missing")).resolves.toBeNull();
  });

  it("throws ContentFetchError on any other non-2xx status", async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, null, "Internal Server Error"));

    await expect(readJson("/public/pages")).rejects.toBeInstanceOf(ContentFetchError);
  });

  it("omits undefined query values rather than sending 'undefined'", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { data: null }));

    await readJson("/public/pages", { query: { slug: "about", campus: undefined } });

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("https://api.test.invalid/api/v1/public/pages?slug=about");
  });

  it("passes through custom revalidate and tags via next options", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { data: null }));

    await readJson("/public/pages", { revalidate: 60, tags: ["tenant:t1"] });

    const [, init] = mockFetch.mock.calls[0] as [string, { next: Record<string, unknown> }];
    expect(init.next).toEqual({ revalidate: 60, tags: ["tenant:t1"] });
  });
});

describe("tenantTag", () => {
  it("namespaces a tenant id", () => {
    expect(tenantTag("t1")).toBe("tenant:t1");
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
