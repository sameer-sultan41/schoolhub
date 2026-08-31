import {
  brandingToCssText,
  brandingToCssVariables,
  checkBrandingContrast,
  sanitizeCssValue,
} from "./branding";

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

describe("checkBrandingContrast", () => {
  it("returns nothing for a passing pair (black text on white, 21:1)", () => {
    expect(
      checkBrandingContrast({ foreground_color: "#000000", background_color: "#ffffff" }),
    ).toEqual([]);
  });

  it("warns on foreground/background below 4.5:1", () => {
    // #cccccc on white is ~1.61:1 — computed independently via the WCAG formula, not
    // copied from the implementation, so this actually exercises the maths.
    const warnings = checkBrandingContrast({
      foreground_color: "#cccccc",
      background_color: "#ffffff",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ pair: "foreground_color/background_color" });
    expect(warnings[0]?.ratio).toBeCloseTo(1.6059, 3);
  });

  it("defaults background_color to platform white when the tenant did not set one", () => {
    const warnings = checkBrandingContrast({ foreground_color: "#cccccc" });
    expect(warnings).toHaveLength(1);
  });

  it("warns when primary_color is too close to the fixed platform primary-foreground (ivory)", () => {
    // #fdf6e3 is a near-ivory tenant colour that would nearly vanish against the FIXED
    // (never tenant-overridable) --sh-color-primary-foreground default of #FBF7EE.
    const warnings = checkBrandingContrast({ primary_color: "#fdf6e3" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ pair: "primary_color/primary_text" });
    expect(warnings[0]?.ratio).toBeLessThan(1.1);
  });

  it("skips a pair it cannot parse rather than guessing", () => {
    expect(
      checkBrandingContrast({
        foreground_color: "oklch(0.5 0.1 200)",
        background_color: "#ffffff",
      }),
    ).toEqual([]);
    expect(checkBrandingContrast({ primary_color: "papayawhip" })).toEqual([]);
  });

  it("returns nothing for absent branding", () => {
    expect(checkBrandingContrast(null)).toEqual([]);
    expect(checkBrandingContrast(undefined)).toEqual([]);
    expect(checkBrandingContrast({})).toEqual([]);
  });
});
