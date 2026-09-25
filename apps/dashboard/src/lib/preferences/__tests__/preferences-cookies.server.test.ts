import { cookies } from "next/headers";
import { PREFERENCE_DEFAULTS } from "../preferences-config";
import { readPreferencesFromCookies } from "../preferences-cookies.server";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));

const mockCookies = cookies as jest.MockedFunction<typeof cookies>;

function cookieStore(values: Record<string, string>) {
  return { get: (name: string) => (name in values ? { value: values[name] } : undefined) };
}

describe("readPreferencesFromCookies", () => {
  it("reads every registered preference from its own cookie", async () => {
    mockCookies.mockResolvedValue(
      cookieStore({ theme_preset: "tenant", sidebar_variant: "floating" }) as never,
    );

    const values = await readPreferencesFromCookies();

    expect(values.theme_preset).toBe("tenant");
    expect(values.sidebar_variant).toBe("floating");
  });

  it("falls back to defaults for a preference with no cookie, or an invalid one", async () => {
    mockCookies.mockResolvedValue(cookieStore({ navbar_style: "not-a-real-option" }) as never);

    const values = await readPreferencesFromCookies();

    expect(values.content_layout).toBe(PREFERENCE_DEFAULTS.content_layout);
    expect(values.navbar_style).toBe(PREFERENCE_DEFAULTS.navbar_style);
  });
});
