import { normalizeHost, parseHost } from "./host";

const PLATFORM = "schoolhub.pk";

describe("normalizeHost", () => {
  it("lowercases and strips the port", () => {
    expect(normalizeHost("CitySchool.SchoolHub.pk:3001")).toBe("cityschool.schoolhub.pk");
  });

  it("rejects empty and malformed hosts", () => {
    expect(normalizeHost(null)).toBeNull();
    expect(normalizeHost("")).toBeNull();
    expect(normalizeHost("evil host/../etc")).toBeNull();
    expect(normalizeHost("http://cityschool.schoolhub.pk")).toBeNull();
  });
});

describe("parseHost", () => {
  it("resolves a wildcard subdomain to a tenant slug", () => {
    expect(parseHost("cityschool.schoolhub.pk", PLATFORM)).toEqual({
      kind: "subdomain",
      host: "cityschool.schoolhub.pk",
      slug: "cityschool",
    });
  });

  it("treats a verified-looking custom domain as a custom domain candidate", () => {
    expect(parseHost("www.cityschool.edu.pk", PLATFORM)).toEqual({
      kind: "custom-domain",
      host: "www.cityschool.edu.pk",
    });
  });

  it("returns null for the platform apex and reserved labels", () => {
    expect(parseHost("schoolhub.pk", PLATFORM)).toBeNull();
    expect(parseHost("www.schoolhub.pk", PLATFORM)).toBeNull();
    expect(parseHost("api.schoolhub.pk", PLATFORM)).toBeNull();
    expect(parseHost("dashboard.schoolhub.pk", PLATFORM)).toBeNull();
  });

  it("does not treat a nested label as a tenant slug", () => {
    expect(parseHost("a.b.schoolhub.pk", PLATFORM)).toBeNull();
  });

  it("does not let a lookalike domain impersonate the platform", () => {
    // "notschoolhub.pk" must not match the ".schoolhub.pk" suffix rule.
    expect(parseHost("cityschool.notschoolhub.pk", PLATFORM)).toEqual({
      kind: "custom-domain",
      host: "cityschool.notschoolhub.pk",
    });
    expect(parseHost("evilschoolhub.pk", PLATFORM)).toEqual({
      kind: "custom-domain",
      host: "evilschoolhub.pk",
    });
  });
});
