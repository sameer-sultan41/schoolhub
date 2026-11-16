import {
  brandingToCssText,
  brandingToCssVariables,
  sanitizeCssColour,
  sanitizeCssValue,
} from "../branding";

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

  it("accepts the functional colours the API emits for colour tokens", () => {
    expect(
      brandingToCssVariables({
        primary_color: "oklch(0.55 0.18 342)",
        secondary_color: "rgb(15, 118, 110)",
        accent_color: "hsla(200, 50%, 40%, 0.5)",
        background_color: "rgb(255 255 255 / 90%)",
      }),
    ).toEqual({
      "--sh-color-primary": "oklch(0.55 0.18 342)",
      "--sh-color-secondary": "rgb(15, 118, 110)",
      "--sh-color-accent": "hsla(200, 50%, 40%, 0.5)",
      "--sh-color-background": "rgb(255 255 255 / 90%)",
    });
  });

  it("still rejects a functional colour that breaks out of the declaration", () => {
    expect(sanitizeCssColour("rgb(1,2,3);}x")).toBeNull();
    expect(sanitizeCssColour("rgb(1,2,3)) body{")).toBeNull();
    expect(sanitizeCssColour("url(javascript:alert(1))")).toBeNull();
    expect(sanitizeCssColour("rgb(var(--x))")).toBeNull();
    expect(sanitizeCssColour("#0f766e")).toBe("#0f766e");
  });

  it("does not accept functional values outside colour tokens", () => {
    expect(brandingToCssVariables({ radius: "calc(1rem)", body_font: "rgb(1, 2, 3)" })).toEqual({});
  });

  it("renders an SSR-injectable style block", () => {
    expect(brandingToCssText({ primary_color: "#111111" })).toBe(
      ":root{--sh-color-primary:#111111}",
    );
    expect(brandingToCssText({})).toBe("");
  });
});
