import { parseTenantSlug } from "./host";

describe("parseTenantSlug", () => {
  const PLATFORM = "localhost";

  it("resolves a tenant subdomain under app.<platform-domain>", () => {
    expect(parseTenantSlug("demo.app.localhost", PLATFORM)).toBe("demo");
  });

  it("strips a port before matching", () => {
    expect(parseTenantSlug("demo.app.localhost:3000", PLATFORM)).toBe("demo");
  });

  it("is case-insensitive", () => {
    expect(parseTenantSlug("Demo.App.Localhost", PLATFORM)).toBe("demo");
  });

  it("returns null for the bare dashboard apex (generic login)", () => {
    expect(parseTenantSlug("app.localhost", PLATFORM)).toBeNull();
  });

  it("returns null for a bare host with no app. prefix", () => {
    expect(parseTenantSlug("localhost", PLATFORM)).toBeNull();
  });

  it("returns null for a host outside the dashboard apex entirely", () => {
    expect(parseTenantSlug("demo.example.com", PLATFORM)).toBeNull();
  });

  it("returns null for more than one label before the apex", () => {
    expect(parseTenantSlug("a.b.app.localhost", PLATFORM)).toBeNull();
  });

  it("returns null for an empty label", () => {
    expect(parseTenantSlug(".app.localhost", PLATFORM)).toBeNull();
  });
});
