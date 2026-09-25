import { cookies } from "next/headers";
import requestConfig from "../request";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));

// `getRequestConfig` (next-intl/server) is meant to run only in a real React Server
// Component request; under jsdom, next-intl's own conditional export resolves to a
// client-only stub that throws on purpose ("not supported in Client Components"). The
// real implementation is a pure identity function (confirmed against next-intl's own
// source) — this mock reproduces exactly that, letting `request.ts`'s default export be
// its callback unchanged.
jest.mock("next-intl/server", () => ({
  getRequestConfig: (createRequestConfig: unknown) => createRequestConfig,
}));

const mockCookies = cookies as jest.MockedFunction<typeof cookies>;

function cookieStore(value: string | undefined) {
  return {
    get: (name: string) => (name === "sh_locale" && value !== undefined ? { value } : undefined),
  };
}

describe("i18n request config", () => {
  it("uses the cookie's locale when it names a real, supported one", async () => {
    mockCookies.mockResolvedValue(cookieStore("ur") as never);

    const config = await requestConfig({} as never);

    expect(config.locale).toBe("ur");
    expect(config.messages).toBeDefined();
  });

  it("falls back to the default locale with no cookie", async () => {
    mockCookies.mockResolvedValue(cookieStore(undefined) as never);

    const config = await requestConfig({} as never);

    expect(config.locale).toBe("en");
  });

  it("falls back to the default locale for a cookie naming an unsupported one", async () => {
    // A cookie is client-writable — a stale or tampered value must not select a locale
    // file that was never shipped.
    mockCookies.mockResolvedValue(cookieStore("fr") as never);

    const config = await requestConfig({} as never);

    expect(config.locale).toBe("en");
  });
});
