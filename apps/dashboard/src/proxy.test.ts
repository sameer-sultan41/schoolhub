/**
 * @jest-environment node
 *
 * next/server's NextRequest/NextResponse need the real Web Request/Response globals,
 * which jsdom (this project's default testEnvironment) does not provide.
 */
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function makeRequest(path: string, { session = false }: { session?: boolean } = {}) {
  const url = `https://app.schoolhub.test${path}`;
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
    expect(response.headers.get("location")).toBe("https://app.schoolhub.test/login");
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

  it("sends a signed-in visitor away from /login to /dashboard", () => {
    const response = proxy(makeRequest("/login", { session: true }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.schoolhub.test/dashboard");
  });

  it("honours a same-origin ?next= when redirecting a signed-in visitor off /login", () => {
    const response = proxy(makeRequest("/login?next=/students", { session: true }));
    expect(response.headers.get("location")).toBe("https://app.schoolhub.test/students");
  });

  it("never treats an off-site next param as a redirect target", () => {
    const response = proxy(makeRequest("/login?next=https://evil.example.com", { session: true }));
    expect(response.headers.get("location")).toBe("https://app.schoolhub.test/dashboard");
  });

  it("treats /forgot-password and its subpaths as public", () => {
    expect(proxy(makeRequest("/forgot-password")).status).toBe(200);
    expect(proxy(makeRequest("/forgot-password/confirm")).status).toBe(200);
  });
});
