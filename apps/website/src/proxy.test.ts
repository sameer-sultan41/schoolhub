/**
 * @jest-environment node
 *
 * next/server's NextRequest/NextResponse need the real Web Request/Response globals,
 * which jsdom (this project's default testEnvironment) does not provide.
 */
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const ORIGINAL_PLATFORM_DOMAIN = process.env.NEXT_PUBLIC_PLATFORM_DOMAIN;

beforeEach(() => {
  process.env.NEXT_PUBLIC_PLATFORM_DOMAIN = "schoolhub.pk";
});

afterAll(() => {
  process.env.NEXT_PUBLIC_PLATFORM_DOMAIN = ORIGINAL_PLATFORM_DOMAIN;
});

function makeRequest(host: string, path = "/", extraHeaders: Record<string, string> = {}) {
  return new NextRequest(`https://${host}${path}`, {
    headers: { host, ...extraHeaders },
  });
}

describe("proxy", () => {
  it("rewrites an unresolvable host to the platform landing page", () => {
    const response = proxy(makeRequest("schoolhub.pk"));
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://schoolhub.pk/platform-landing",
    );
  });

  it("does not rewrite when already on the platform landing page", () => {
    const response = proxy(makeRequest("schoolhub.pk", "/platform-landing"));
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("tags a wildcard subdomain request with the resolved tenant slug and kind", () => {
    const response = proxy(makeRequest("cityschool.schoolhub.pk"));
    expect(response.headers.get("x-middleware-request-x-schoolhub-host")).toBe(
      "cityschool.schoolhub.pk",
    );
    expect(response.headers.get("x-middleware-request-x-schoolhub-host-kind")).toBe("subdomain");
    expect(response.headers.get("x-middleware-request-x-schoolhub-tenant-slug")).toBe("cityschool");
  });

  it("tags a custom-domain request without a slug", () => {
    const response = proxy(makeRequest("www.cityschool.edu.pk"));
    expect(response.headers.get("x-middleware-request-x-schoolhub-host-kind")).toBe(
      "custom-domain",
    );
    expect(response.headers.get("x-middleware-request-x-schoolhub-tenant-slug")).toBeNull();
  });

  it("strips a client-supplied tenant header before setting its own", () => {
    const response = proxy(
      makeRequest("cityschool.schoolhub.pk", "/", {
        "x-schoolhub-tenant-slug": "spoofed-tenant",
      }),
    );
    expect(response.headers.get("x-middleware-request-x-schoolhub-tenant-slug")).toBe("cityschool");
  });
});
