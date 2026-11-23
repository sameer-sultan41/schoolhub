import { makeSection } from "@/test-utils";
import { DEFAULT_THEME_NAME, getTheme, resolveSection, THEMES } from "../index";
import type { SectionType } from "../index";

describe("THEMES / DEFAULT_THEME_NAME", () => {
  it("registers the default theme under its own name", () => {
    expect(THEMES[DEFAULT_THEME_NAME]).toBeDefined();
    expect(DEFAULT_THEME_NAME).toBe("default");
  });
});

describe("getTheme", () => {
  it("resolves the default theme by its API code", () => {
    expect(getTheme("default")).toBe(THEMES.default);
  });

  it("falls back to the default theme for an unknown code", () => {
    expect(getTheme("nonexistent")).toBe(THEMES.default);
  });

  it("falls back to the default theme for null/undefined", () => {
    expect(getTheme(null)).toBe(THEMES.default);
    expect(getTheme(undefined)).toBe(THEMES.default);
  });
});

describe("resolveSection", () => {
  const theme = getTheme("default");

  it("resolves an implemented section type to its component", () => {
    expect(resolveSection(theme, makeSection({}, { type: "hero" }))).toBe(theme.sections.hero);
  });

  it("resolves the rich-text and FAQ sections", () => {
    expect(resolveSection(theme, makeSection({}, { type: "faq" }))).toBe(theme.sections.faq);
    expect(resolveSection(theme, makeSection({}, { type: "rich_text" }))).toBe(
      theme.sections.rich_text,
    );
  });

  it("returns null for a declared type a theme does not render", () => {
    const partial = { ...theme, sections: { ...theme.sections, faq: null } };
    expect(resolveSection(partial, makeSection({}, { type: "faq" }))).toBeNull();
  });

  it("returns null for a type the API added before the renderer knows it", () => {
    // A newer API can emit a type this build's generated enum does not list yet.
    const type = "not_a_real_section_type" as SectionType;
    expect(resolveSection(theme, makeSection({}, { type }))).toBeNull();
  });

  it("never resolves an inherited object key", () => {
    const type = "constructor" as SectionType;
    expect(resolveSection(theme, makeSection({}, { type }))).toBeNull();
  });
});
