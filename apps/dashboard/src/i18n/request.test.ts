import { cookies } from "next/headers";
import getRequestConfig, { LOCALE_COOKIE_NAME } from "./request";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));

const mockCookies = cookies as jest.MockedFunction<typeof cookies>;

function mockCookieValue(value: string | undefined) {
  mockCookies.mockResolvedValue({
    get: (name: string) => (name === LOCALE_COOKIE_NAME ? { value } : undefined),
  } as Awaited<ReturnType<typeof cookies>>);
}

describe("i18n request config", () => {
  it("defaults to the configured default locale with no cookie", async () => {
    mockCookieValue(undefined);
    const config = await getRequestConfig({ requestLocale: Promise.resolve(undefined) });
    expect(config.locale).toBe("en");
    expect(config.messages).toBeDefined();
  });

  it("uses a supported locale cookie", async () => {
    mockCookieValue("ur");
    const config = await getRequestConfig({ requestLocale: Promise.resolve(undefined) });
    expect(config.locale).toBe("ur");
  });

  it("ignores an unsupported locale cookie", async () => {
    mockCookieValue("fr");
    const config = await getRequestConfig({ requestLocale: Promise.resolve(undefined) });
    expect(config.locale).toBe("en");
  });
});
