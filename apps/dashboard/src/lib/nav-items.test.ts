import { NAV_ITEMS } from "./nav-items";

describe("NAV_ITEMS", () => {
  it("has a unique key and href per entry", () => {
    const keys = NAV_ITEMS.map((item) => item.key);
    const hrefs = NAV_ITEMS.map((item) => item.href);
    expect(new Set(keys).size).toBe(NAV_ITEMS.length);
    expect(new Set(hrefs).size).toBe(NAV_ITEMS.length);
  });

  it("includes the dashboard home with no module gate", () => {
    const home = NAV_ITEMS.find((item) => item.key === "dashboard");
    expect(home).toBeDefined();
    expect(home?.module).toBe("");
  });

  it("scopes every other entry to a named module", () => {
    for (const item of NAV_ITEMS.filter((entry) => entry.key !== "dashboard")) {
      expect(item.module.length).toBeGreaterThan(0);
    }
  });
});
