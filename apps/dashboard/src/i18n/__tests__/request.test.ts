import { cookies } from "next/headers";
import requestConfig from "../request";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));

const mockCookies = cookies as jest.MockedFunction<typeof cookies>;

function cookieStore(value: string | undefined) {
  return {
    get: (name: string) => (name === "sh_locale" && value !== undefined ? { value } : undefined),
  };
}

describe("i18n request config", () => {
  it("uses the cookie's locale when it names a real, supported one", async () => {
    mockCookies.mockResolvedValue(cookieStore("ur") as never);

    const config = await requestConfig();

    expect(config.locale).toBe("ur");
    expect(config.messages).toBeDefined();
  });

  it("falls back to the default locale with no cookie", async () => {
    mockCookies.mockResolvedValue(cookieStore(undefined) as never);

    const config = await requestConfig();

    expect(config.locale).toBe("en");
  });

  it("falls back to the default locale for a cookie naming an unsupported one", async () => {
    // A cookie is client-writable — a stale or tampered value must not select a locale
    // file that was never shipped.
    mockCookies.mockResolvedValue(cookieStore("fr") as never);

    const config = await requestConfig();

    expect(config.locale).toBe("en");
  });
});
