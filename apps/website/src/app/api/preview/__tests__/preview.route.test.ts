/**
 * @jest-environment node
 *
 * next/server's NextRequest/NextResponse need the real Web Request/Response globals,
 * which jsdom (this project's default testEnvironment) does not provide.
 */
import { draftMode } from "next/headers";
import { NextRequest } from "next/server";
import { readJson } from "@/lib/api";
import { makePage } from "@/test-utils";
import { GET } from "../route";

jest.mock("next/headers", () => ({ draftMode: jest.fn(), cookies: jest.fn() }));
jest.mock("@/lib/api", () => ({ readJson: jest.fn() }));

const mockReadJson = readJson as jest.MockedFunction<typeof readJson>;
const mockDraftMode = draftMode as jest.MockedFunction<typeof draftMode>;
const enable = jest.fn();

const HOST = "cityschool.schoolhub.pk";

function makeRequest(query: string, host = HOST) {
  return new NextRequest(`https://${host}/api/preview${query}`, { headers: { host } });
}

beforeEach(() => {
  mockReadJson.mockReset();
  enable.mockReset();
  mockDraftMode.mockResolvedValue({ enable } as unknown as Awaited<ReturnType<typeof draftMode>>);
});

describe("GET /api/preview", () => {
  it("is a 400 without a token, and asks the API nothing", async () => {
    const response = await GET(makeRequest(""));

    expect(response.status).toBe(400);
    expect(mockReadJson).not.toHaveBeenCalled();
    expect(enable).not.toHaveBeenCalled();
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
    expect(enable).not.toHaveBeenCalled();
  });

  it("enables Draft Mode, stores the token and redirects to the API's page path", async () => {
    mockReadJson.mockResolvedValue(makePage({ slug: "about", path: "/about", status: "draft" }));
    const response = await GET(makeRequest("?token=tok-1"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/about");
    expect(enable).toHaveBeenCalledTimes(1);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("schoolhub_preview=tok-1");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Max-Age=600/i);
    expect(cookie).toMatch(/Path=\//i);
  });

  it("ignores a slug in the request: the redirect is the API's path (no open redirect)", async () => {
    mockReadJson.mockResolvedValue(makePage({ slug: "about", path: "/about" }));
    const response = await GET(makeRequest("?token=tok-1&slug=//evil.example/phish"));

    expect(response.headers.get("location")).toBe("/about");
    expect(mockReadJson).toHaveBeenCalledWith(
      "/public/pages",
      expect.not.objectContaining({ query: expect.anything() }),
    );
  });

  it("redirects the homepage to /", async () => {
    mockReadJson.mockResolvedValue(makePage());
    const response = await GET(makeRequest("?token=tok-1"));
    expect(response.headers.get("location")).toBe("/");
  });

  it("redirects a nested page to its full path", async () => {
    mockReadJson.mockResolvedValue(makePage({ slug: "about/history", path: "/about/history" }));
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
    mockReadJson.mockResolvedValue(makePage({ path }));
    const response = await GET(makeRequest("?token=tok-1"));

    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(enable).not.toHaveBeenCalled();
  });
});
