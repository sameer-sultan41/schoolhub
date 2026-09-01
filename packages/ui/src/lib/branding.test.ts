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

  it("warns when secondary_color or accent_color is too close to the fixed platform indigo text", () => {
    // #3a3980 is a near-indigo tenant colour that would nearly vanish against the FIXED
    // (never tenant-overridable) --sh-color-secondary-foreground/--sh-color-accent-foreground
    // default of #2B2A6B — computed independently via the WCAG formula: ~1.26:1.
    const secondaryWarnings = checkBrandingContrast({ secondary_color: "#3a3980" });
    expect(secondaryWarnings).toHaveLength(1);
    expect(secondaryWarnings[0]).toMatchObject({ pair: "secondary_color/secondary_text" });
    expect(secondaryWarnings[0]?.ratio).toBeCloseTo(1.2616, 3);

    const accentWarnings = checkBrandingContrast({ accent_color: "#3a3980" });
    expect(accentWarnings).toHaveLength(1);
    expect(accentWarnings[0]).toMatchObject({ pair: "accent_color/accent_text" });
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

  it("defaults foreground_color to the platform default when the tenant set only background_color", () => {
    // #1a1a1a is a near-black tenant background left to pair against the theme's own
    // near-black default foreground (#18181b) — ~1.02:1, effectively invisible text. Before
    // foreground had a fallback to match background's, this pair was skipped entirely
    // (foreground stayed null), so a tenant could ship this and get no warning at all.
    const warnings = checkBrandingContrast({ background_color: "#1a1a1a" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ pair: "foreground_color/background_color" });
    expect(warnings[0]?.ratio).toBeLessThan(1.1);
  });

  it("skips a colour carrying an alpha channel rather than treating it as opaque", () => {
    // #33333380 (50% alpha) computes as a fully-opaque #333333 (12.6:1, passes) if alpha is
    // dropped, but renders far lower against a real backdrop — a false pass is worse than
    // not checking, so any explicit alpha is treated as unparseable, like an oklch() value.
    expect(
      checkBrandingContrast({ foreground_color: "#33333380", background_color: "#ffffff" }),
    ).toEqual([]);
    expect(
      checkBrandingContrast({
        foreground_color: "rgba(51, 51, 51, 0.5)",
        background_color: "#ffffff",
      }),
    ).toEqual([]);
    // An opaque 8-digit hex (alpha = ff) is rejected too, not just a genuinely translucent
    // one — parsing out and special-casing a literal "ff"/1.0 alpha isn't worth the added
    // complexity for what a colour-picker form would never actually produce.
    expect(
      checkBrandingContrast({ foreground_color: "#333333ff", background_color: "#ffffff" }),
    ).toEqual([]);
  });
});
