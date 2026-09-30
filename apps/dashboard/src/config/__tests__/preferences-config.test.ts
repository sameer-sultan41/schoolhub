import {
  parsePreference,
  PREFERENCE_DEFAULTS,
  PREFERENCE_KEYS,
  preferenceDataAttributes,
} from "../preferences-config";

describe("parsePreference", () => {
  it("accepts a value that is one of the key's real options", () => {
    expect(parsePreference("sidebar_variant", "floating")).toBe("floating");
  });

  it("falls back to the default when the cookie is missing", () => {
    expect(parsePreference("content_layout", undefined)).toBe(PREFERENCE_DEFAULTS.content_layout);
  });

  it("falls back to the default when the cookie holds a value this key never issues", () => {
    // A cookie is client-writable — a tampered or stale value must not reach a
    // `data-*` attribute unvalidated.
    expect(parsePreference("navbar_style", "attacker-value")).toBe(
      PREFERENCE_DEFAULTS.navbar_style,
    );
  });
});

describe("preferenceDataAttributes", () => {
  it("maps every registered preference to its own <html> attribute name", () => {
    const attributes = preferenceDataAttributes(PREFERENCE_DEFAULTS);

    expect(attributes["data-theme-preset"]).toBe(PREFERENCE_DEFAULTS.theme_preset);
    expect(attributes["data-sidebar-variant"]).toBe(PREFERENCE_DEFAULTS.sidebar_variant);
    expect(attributes["data-content-layout"]).toBe(PREFERENCE_DEFAULTS.content_layout);
    expect(attributes["data-navbar-style"]).toBe(PREFERENCE_DEFAULTS.navbar_style);
    expect(Object.keys(attributes)).toHaveLength(PREFERENCE_KEYS.length);
  });
});
