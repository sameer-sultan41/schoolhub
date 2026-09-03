import { directionFor, env, isSupportedLocale, SUPPORTED_LOCALES } from "./env";

describe("env", () => {
  it("parses the test environment's public config", () => {
    expect(env.NEXT_PUBLIC_API_BASE_URL).toBe("https://api.test.invalid/api/v1");
    expect(env.NEXT_PUBLIC_PLATFORM_DOMAIN).toBe("schoolhub.test");
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
