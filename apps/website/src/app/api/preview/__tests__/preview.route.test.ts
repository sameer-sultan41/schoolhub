/**
 * @jest-environment node
 *
 * next/server's NextRequest/NextResponse need the real Web Request/Response globals,
 * which jsdom (this project's default testEnvironment) does not provide.
 */
import { NextRequest } from "next/server";
import { readJsonWithHeaders } from "@/lib/api";
import { makePage } from "@/test-utils";
import { GET } from "../route";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@/lib/api", () => ({ readJsonWithHeaders: jest.fn() }));

const mockReadJson = readJsonWithHeaders as jest.MockedFunction<typeof readJsonWithHeaders>;

/** A 200 from the API: the page plus the token's remaining seconds in its expiry header. */
function apiPage(page: ReturnType<typeof makePage>, expiresIn: number | string | null = 300) {
  const headers = new Headers();
  if (expiresIn !== null) headers.set("X-Preview-Expires-In", String(expiresIn));
  return { data: page, headers };
}

const HOST = "cityschool.schoolhub.pk";

function makeRequest(query: string, host = HOST) {
  return new NextRequest(`https://${host}/api/preview${query}`, { headers: { host } });
}

beforeEach(() => {
  mockReadJson.mockReset();
});

describe("GET /api/preview", () => {
  it("is a 400 without a token, and asks the API nothing", async () => {
    const response = await GET(makeRequest(""));

    expect(response.status).toBe(400);
    expect(mockReadJson).not.toHaveBeenCalled();
  });

  it("is a 400 for a token far longer than a signed one", async () => {
    const response = await GET(makeRequest(`?token=${"a".repeat(513)}`));
    expect(response.status).toBe(400);
    expect(mockReadJson).not.toHaveBeenCalled();
  });

  it("validates the token against the API for the request's host, with no slug", async () => {
    mockReadJson.mockResolvedValue(null);
    await GET(makeRequest("?token=tok-1"));

    expect(mockReadJson).toHaveBeenCalledWith("/public/pages", {
      host: HOST,
      previewToken: "tok-1",
    });
  });

  it("is a 404 with no draft cookie and no redirect when the API refuses the token", async () => {
    mockReadJson.mockResolvedValue(null);
    const response = await GET(makeRequest("?token=expired"));

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("stores the token and redirects to the API's page path", async () => {
    mockReadJson.mockResolvedValue(
      apiPage(makePage({ slug: "about", path: "/about", status: "draft" })),
    );
    const response = await GET(makeRequest("?token=tok-1"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/about");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("schoolhub_preview=tok-1");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Max-Age=300/i);
    expect(cookie).toMatch(/Path=\//i);
  });

  it("sets the cookie's maxAge to the token's remaining life, not a flat 600 s", async () => {
    mockReadJson.mockResolvedValue(apiPage(makePage(), 90));
    const response = await GET(makeRequest("?token=tok-1"));

    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=90(;|$)/i);
  });

  it("sets no cookie for a token with no seconds left", async () => {
    mockReadJson.mockResolvedValue(apiPage(makePage(), 0));
    const response = await GET(makeRequest("?token=tok-1"));

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("sets no cookie when the API sent no expiry (fails closed)", async () => {
    mockReadJson.mockResolvedValue(apiPage(makePage(), null));
    const response = await GET(makeRequest("?token=tok-1"));

    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("ignores a slug in the request: the redirect is the API's path (no open redirect)", async () => {
    mockReadJson.mockResolvedValue(apiPage(makePage({ slug: "about", path: "/about" })));
    const response = await GET(makeRequest("?token=tok-1&slug=//evil.example/phish"));

    expect(response.headers.get("location")).toBe("/about");
    expect(mockReadJson).toHaveBeenCalledWith(
      "/public/pages",
      expect.not.objectContaining({ query: expect.anything() }),
    );
  });

  it("redirects the homepage to /", async () => {
    mockReadJson.mockResolvedValue(apiPage(makePage()));
    const response = await GET(makeRequest("?token=tok-1"));
    expect(response.headers.get("location")).toBe("/");
  });

  it("redirects a nested page to its full path", async () => {
    mockReadJson.mockResolvedValue(
      apiPage(makePage({ slug: "about/history", path: "/about/history" })),
    );
    const response = await GET(makeRequest("?token=tok-1"));
    expect(response.headers.get("location")).toBe("/about/history");
  });

  it.each([
    "//evil.example",
    "/\\evil.example",
    // Browsers strip tabs and newlines from URLs, so these would read as `//evil.example`.
    "/\t/evil.example",
    "/\n/evil.example",
    "https://evil.example/",
    "/About",
    "/about/",
    "",
  ])("refuses a page path outside the page-slug grammar (%p)", async (path) => {
    mockReadJson.mockResolvedValue(apiPage(makePage({ path })));
    const response = await GET(makeRequest("?token=tok-1"));

    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("never sets Next's build-wide Draft Mode cookie, only the school's token cookie", async () => {
    // `__prerender_bypass` is one value per build: set here, it would open uncached renders on
    // every school's host. The token cookie is the only preview switch.
    mockReadJson.mockResolvedValue(apiPage(makePage({ slug: "about", path: "/about" })));
    const response = await GET(makeRequest("?token=tok-1"));

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).not.toContain("__prerender_bypass");
    expect(response.cookies.getAll().map(({ name }) => name)).toEqual(["schoolhub_preview"]);
  });
});
