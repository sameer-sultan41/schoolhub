/**
 * @jest-environment node
 *
 * next/server's NextRequest/NextResponse need the real Web Request/Response globals,
 * which jsdom (this project's default testEnvironment) does not provide.
 */
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

// jest.setup.ts sets NEXT_PUBLIC_PLATFORM_DOMAIN=schoolhub.test, so `app.schoolhub.test` is the
// bare dashboard host and `<slug>.app.schoolhub.test` a school's.
const BARE_HOST = "app.schoolhub.test";
const TENANT_HOST = "city-school.app.schoolhub.test";

function makeRequest(
  path: string,
  { session = false, host = BARE_HOST }: { session?: boolean; host?: string } = {},
) {
  const url = `https://${host}${path}`;
  const headers: Record<string, string> = session ? { cookie: "sh_session=1" } : {};
  return new NextRequest(url, { headers });
}

describe("proxy", () => {
  it("lets an anonymous visitor reach a public path", () => {
    const response = proxy(makeRequest("/login"));
    expect(response.status).toBe(200);
  });

  it("redirects an anonymous visitor away from a protected path to /login", () => {
    const response = proxy(makeRequest("/dashboard"));
    expect(response.status).toBe(307);
    // Any non-root path carries itself forward as ?next= (see the dedicated test below) —
    // only the bare root is redirected without one.
    expect(response.headers.get("location")).toBe(
      "https://app.schoolhub.test/login?next=%2Fdashboard",
    );
  });

  it("carries the original path forward as ?next= for the post-login redirect", () => {
    const response = proxy(makeRequest("/students?tab=active"));
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/students?tab=active");
  });

  it("does not set ?next= when redirecting from the bare root", () => {
    const response = proxy(makeRequest("/"));
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.has("next")).toBe(false);
  });

  it("lets a signed-in visitor reach a protected path", () => {
    const response = proxy(makeRequest("/dashboard", { session: true }));
    expect(response.status).toBe(200);
  });

  it("sends a signed-in visitor at the bare root to /dashboard, not a 404", () => {
    // The bare root has no page of its own — only /dashboard, /staff, /students, etc.
    // do — so a signed-in visitor must be redirected, not passed through to a route
    // that doesn't exist.
    const response = proxy(makeRequest("/", { session: true }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.schoolhub.test/dashboard");
  });

  it("sends a signed-in visitor away from /login to /dashboard", () => {
    const response = proxy(makeRequest("/login", { session: true }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.schoolhub.test/dashboard");
  });

  it("honours a same-origin ?next= when redirecting a signed-in visitor off /login", () => {
    const response = proxy(makeRequest("/login?next=/students", { session: true }));
    expect(response.headers.get("location")).toBe("https://app.schoolhub.test/students");
  });

  it.each(["//evil.example", "/\\evil.example"])(
    "never follows %s, which a browser reads as another host",
    (next) => {
      const response = proxy(
        makeRequest(`/login?next=${encodeURIComponent(next)}`, { session: true }),
      );
      expect(response.headers.get("location")).toBe("https://app.schoolhub.test/dashboard");
    },
  );

  it("never treats an off-site next param as a redirect target", () => {
    const response = proxy(makeRequest("/login?next=https://evil.example.com", { session: true }));
    expect(response.headers.get("location")).toBe("https://app.schoolhub.test/dashboard");
  });

  it("treats /forgot-password and its subpaths as public", () => {
    expect(proxy(makeRequest("/forgot-password")).status).toBe(200);
    expect(proxy(makeRequest("/forgot-password/confirm")).status).toBe(200);
  });

  it("treats /accept-invite and /reset-password as public", () => {
    expect(proxy(makeRequest("/accept-invite")).status).toBe(200);
    expect(proxy(makeRequest("/reset-password")).status).toBe(200);
  });

  it("never redirects a signed-in visitor off an emailed-link page", () => {
    // The browser would carry the link's fragment, token and all, to wherever this
    // redirected; the page has to open so the link can be read and cleared.
    expect(proxy(makeRequest("/accept-invite", { session: true })).status).toBe(200);
    expect(proxy(makeRequest("/reset-password", { session: true })).status).toBe(200);
  });

  it("lets the impersonation handoff through on a school's host, with or without a session", () => {
    // The console's link opens a fresh tab with no session; a tab that already has one must not
    // be redirected either, or the browser would carry the code's fragment to /dashboard.
    expect(proxy(makeRequest("/impersonate", { host: TENANT_HOST })).status).toBe(200);
    expect(proxy(makeRequest("/impersonate", { host: TENANT_HOST, session: true })).status).toBe(
      200,
    );
    expect(proxy(makeRequest("/impersonate?ended=1", { host: TENANT_HOST })).status).toBe(200);
  });

  it("still sends a signed-in visitor away from /forgot-password", () => {
    const response = proxy(makeRequest("/forgot-password", { session: true }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.schoolhub.test/dashboard");
  });

  describe("platform console", () => {
    it("404s /platform/* on a school's host, signed in or not", () => {
      expect(proxy(makeRequest("/platform/tenants", { host: TENANT_HOST })).status).toBe(404);
      expect(
        proxy(makeRequest("/platform/tenants", { host: TENANT_HOST, session: true })).status,
      ).toBe(404);
      expect(proxy(makeRequest("/platform", { host: TENANT_HOST, session: true })).status).toBe(
        404,
      );
    });

    it("serves /platform/* on the bare app host to a signed-in visitor", () => {
      expect(proxy(makeRequest("/platform/tenants", { session: true })).status).toBe(200);
    });

    it("sends an anonymous visitor on the bare host to /login, like any protected page", () => {
      const response = proxy(makeRequest("/platform/tenants"));
      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
    });

    it("does not treat a path that merely starts with /platform as the console", () => {
      expect(proxy(makeRequest("/platforms", { host: TENANT_HOST, session: true })).status).toBe(
        200,
      );
    });
  });

  describe("second-factor pages", () => {
    it("lets an anonymous visitor reach /mfa/verify", () => {
      expect(proxy(makeRequest("/mfa/verify")).status).toBe(200);
    });

    it("never redirects a signed-in visitor off /mfa/*", () => {
      // A first sign-in holds a password-only session while it enrols; sending it to the
      // dashboard would loop it back here.
      expect(proxy(makeRequest("/mfa/enroll", { session: true })).status).toBe(200);
      expect(proxy(makeRequest("/mfa/verify", { session: true })).status).toBe(200);
    });
  });
});
