import type { PageSection } from "@schoolhub/types";
import { DEFAULT_THEME_NAME, getTheme, resolveSection, THEMES } from "./index";

describe("THEMES / DEFAULT_THEME_NAME", () => {
  it("registers the default theme under its own name", () => {
    expect(THEMES[DEFAULT_THEME_NAME]).toBeDefined();
    expect(DEFAULT_THEME_NAME).toBe("default");
  });
});

describe("getTheme", () => {
  it("resolves the default theme by name", () => {
    expect(getTheme("default")).toBe(THEMES.default);
  });

  it("falls back to the default theme for an unknown name", () => {
    expect(getTheme("nonexistent")).toBe(THEMES.default);
  });

  it("falls back to the default theme for null/undefined", () => {
    expect(getTheme(null)).toBe(THEMES.default);
    expect(getTheme(undefined)).toBe(THEMES.default);
  });
});

function makeSection(type: PageSection["type"]): PageSection {
  return { id: "s1", type, position: 0, props: {} };
}

describe("resolveSection", () => {
  it("resolves an implemented section type to its component", () => {
    const theme = getTheme("default");
    expect(resolveSection(theme, makeSection("hero"))).toBe(theme.sections.hero);
  });

  it("returns null for a section type the theme does not implement", () => {
    const theme = getTheme("default");
    expect(resolveSection(theme, makeSection("not_a_real_section_type"))).toBeNull();
  });
});
