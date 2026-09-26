import { PREFERENCE_DEFAULTS, PREFERENCE_REGISTRY } from "../preferences-config";
import { writePreferenceCookie } from "../preferences-cookies.client";
import { createPreferencesStore } from "../preferences-store";

jest.mock("../preferences-cookies.client", () => ({ writePreferenceCookie: jest.fn() }));

const mockWritePreferenceCookie = writePreferenceCookie as jest.MockedFunction<
  typeof writePreferenceCookie
>;

describe("createPreferencesStore", () => {
  beforeEach(() => {
    mockWritePreferenceCookie.mockReset();
    document.documentElement.removeAttribute("data-sidebar-variant");
  });

  it("setPreference updates the DOM attribute, the cookie, and the store together", () => {
    const store = createPreferencesStore(PREFERENCE_DEFAULTS);

    store.getState().setPreference("sidebar_variant", "floating");

    expect(document.documentElement.getAttribute("data-sidebar-variant")).toBe("floating");
    expect(mockWritePreferenceCookie).toHaveBeenCalledWith("sidebar_variant", "floating");
    expect(store.getState().values.sidebar_variant).toBe("floating");
  });

  it("resetPreferences restores every preference's own default, leaving others untouched", () => {
    const store = createPreferencesStore({
      ...PREFERENCE_DEFAULTS,
      sidebar_variant: "floating",
      navbar_style: "scroll",
    });

    store.getState().resetPreferences();

    expect(store.getState().values).toEqual(PREFERENCE_DEFAULTS);
    expect(document.documentElement.getAttribute("data-sidebar-variant")).toBe(
      PREFERENCE_REGISTRY.sidebar_variant.defaultValue,
    );
  });
});
