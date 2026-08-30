import { brandingToCssText, brandingToCssVariables, sanitizeCssValue } from "./branding";

describe("brandingToCssVariables", () => {
  it("maps tenant branding onto --sh-* custom properties", () => {
    expect(
      brandingToCssVariables({
        primary_color: "#0f766e",
        heading_font: "Inter, sans-serif",
        radius: "0.75rem",
      }),
    ).toEqual({
      "--sh-color-primary": "#0f766e",
      "--sh-font-heading": "Inter, sans-serif",
      "--sh-radius": "0.75rem",
    });
  });

  it("omits absent fields so the neutral defaults win", () => {
    expect(brandingToCssVariables({ primary_color: null, secondary_color: undefined })).toEqual({});
    expect(brandingToCssVariables(null)).toEqual({});
  });

  it("drops values that could break out of the declaration", () => {
    expect(sanitizeCssValue("red; background: url(http://evil.test/x)")).toBeNull();
    expect(sanitizeCssValue("}body{display:none")).toBeNull();
    expect(sanitizeCssValue("  #123456  ")).toBe("#123456");
    expect(brandingToCssVariables({ primary_color: "url(javascript:alert(1))" })).toEqual({});
  });

  it("renders an SSR-injectable style block", () => {
    expect(brandingToCssText({ primary_color: "#111111" })).toBe(
      ":root{--sh-color-primary:#111111}",
    );
    expect(brandingToCssText({})).toBe("");
  });
});
