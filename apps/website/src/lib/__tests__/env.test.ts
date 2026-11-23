import { env, RESERVED_SUBDOMAINS } from "../env";

describe("env", () => {
  it("parses the test environment's configuration", () => {
    expect(env.API_BASE_URL).toBe("https://api.test.invalid/api/v1");
    expect(env.WEBSITE_MACHINE_TOKEN).toBe("test-machine-token");
  });

  it("reads the platform domain and the API's public origin at runtime, under server-only names", () => {
    expect(env.PLATFORM_DOMAIN).toBe("schoolhub.test");
    expect(env.API_PUBLIC_ORIGIN).toBe("https://api.schoolhub.test");
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

describe("API_PUBLIC_ORIGIN", () => {
  const ORIGINAL = process.env.API_PUBLIC_ORIGIN;

  // The top-level import above already parsed env.ts; each case needs a fresh parse.
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.API_PUBLIC_ORIGIN;
    else process.env.API_PUBLIC_ORIGIN = ORIGINAL;
    jest.resetModules();
  });

  it("is empty (same-origin) when unset", async () => {
    delete process.env.API_PUBLIC_ORIGIN;
    const { env: fresh } = await import("../env");
    expect(fresh.API_PUBLIC_ORIGIN).toBe("");
  });

  it("refuses an origin that is not http(s)", async () => {
    process.env.API_PUBLIC_ORIGIN = "ftp://files.example";
    await expect(import("../env")).rejects.toThrow(/Invalid website environment configuration/);
  });
});
