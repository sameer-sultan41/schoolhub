import { themeStyle } from "./tokens";

describe("themeStyle", () => {
  it("emits nothing for an unbranded tenant, so :root's dark-mode override still applies", () => {
    expect(themeStyle(null)).toEqual({});
    expect(themeStyle(undefined)).toEqual({});
  });

  it("emits only the tokens a partially-branded tenant actually set", () => {
    expect(themeStyle({ primary_color: "#0f766e", radius: "0.75rem" })).toEqual({
      "--sh-color-primary": "#0f766e",
      "--sh-radius": "0.75rem",
    });
  });
});
