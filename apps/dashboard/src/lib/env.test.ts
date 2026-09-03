import { directionFor, env, isSupportedLocale, SUPPORTED_LOCALES } from "./env";

describe("env", () => {
  it("parses the test environment's public config", () => {
    expect(env.NEXT_PUBLIC_API_BASE_URL).toBe("https://api.test.invalid/api/v1");
    expect(env.NEXT_PUBLIC_PLATFORM_DOMAIN).toBe("schoolhub.test");
  });

  it("fails loudly at import time when the config is invalid", async () => {
    const original = process.env.NEXT_PUBLIC_API_BASE_URL;
    process.env.NEXT_PUBLIC_API_BASE_URL = "not-a-url";
    jest.resetModules();

    await expect(import("./env")).rejects.toThrow("Invalid dashboard environment configuration");

    process.env.NEXT_PUBLIC_API_BASE_URL = original;
    jest.resetModules();
  });
});

describe("SUPPORTED_LOCALES", () => {
  it("ships English and Urdu", () => {
    expect(SUPPORTED_LOCALES).toEqual(["en", "ur"]);
  });
});

describe("isSupportedLocale", () => {
  it("accepts a shipped locale", () => {
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("ur")).toBe(true);
  });

  it("rejects an unshipped locale", () => {
    expect(isSupportedLocale("fr")).toBe(false);
  });
});

describe("directionFor", () => {
  it("is rtl for Urdu", () => {
    expect(directionFor("ur")).toBe("rtl");
  });

  it("is ltr for every other locale", () => {
    expect(directionFor("en")).toBe("ltr");
    expect(directionFor("fr")).toBe("ltr");
  });
});
