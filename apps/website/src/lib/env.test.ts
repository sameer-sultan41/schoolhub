import { env, RESERVED_SUBDOMAINS } from "./env";

describe("env", () => {
  it("parses the test environment's configuration", () => {
    expect(env.API_BASE_URL).toBe("https://api.test.invalid/api/v1");
    expect(env.WEBSITE_MACHINE_TOKEN).toBe("test-machine-token");
  });

  it("defaults the ISR revalidation window", () => {
    expect(env.CONTENT_REVALIDATE_SECONDS).toBe(300);
  });
});

describe("RESERVED_SUBDOMAINS", () => {
  it("reserves the platform's own operational subdomains", () => {
    expect(RESERVED_SUBDOMAINS.has("www")).toBe(true);
    expect(RESERVED_SUBDOMAINS.has("api")).toBe(true);
    expect(RESERVED_SUBDOMAINS.has("dashboard")).toBe(true);
  });

  it("does not reserve an ordinary tenant slug", () => {
    expect(RESERVED_SUBDOMAINS.has("cityschool")).toBe(false);
  });
});
