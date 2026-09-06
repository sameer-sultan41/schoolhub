import { NAV_GROUPS, NAV_ITEMS } from "./nav-items";

/** The modules with no route behind them yet — see NavItem.status. */
const PLANNED_KEYS = ["attendance", "fees", "admissions", "communication", "website"];

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

  it("gives every entry an icon", () => {
    // The sidebar renders item.icon unconditionally; an entry without one is a crash,
    // not a missing decoration.
    for (const item of NAV_ITEMS) {
      expect(item.icon).toBeDefined();
    }
  });

  it("marks exactly the five unbuilt modules as planned", () => {
    const planned = NAV_ITEMS.filter((item) => item.status === "planned").map((item) => item.key);
    expect(planned.sort()).toEqual([...PLANNED_KEYS].sort());
  });

  it("marks every module that has a route as ready", () => {
    const ready = NAV_ITEMS.filter((item) => item.status === "ready").map((item) => item.key);
    expect(ready).toEqual(["dashboard", "students", "staff", "academics", "timetable"]);
  });
});

describe("NAV_GROUPS", () => {
  it("lists the four groups in reading order", () => {
    expect(NAV_GROUPS.map((group) => group.key)).toEqual([
      "overview",
      "people",
      "teaching",
      "operations",
    ]);
  });

  it("places every item in exactly one group", () => {
    const counts = new Map<string, number>();
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        counts.set(item.key, (counts.get(item.key) ?? 0) + 1);
      }
    }

    expect(counts.size).toBe(NAV_ITEMS.length);
    for (const [key, count] of counts) {
      expect([key, count]).toEqual([key, 1]);
    }
  });

  it("flattens to NAV_ITEMS in group order", () => {
    expect(NAV_ITEMS.map((item) => item.key)).toEqual([
      "dashboard",
      "students",
      "staff",
      "admissions",
      "academics",
      "timetable",
      "attendance",
      "fees",
      "communication",
      "website",
    ]);
  });

  it("gives every group at least one entry no permission can hide", () => {
    // The shell renders a group unconditionally — it has no emptiness guard, because a
    // group that can go empty cannot exist while this holds.
    for (const group of NAV_GROUPS) {
      const alwaysVisible = group.items.filter(
        (item) => item.status === "planned" || item.module === "",
      );
      expect(alwaysVisible.length).toBeGreaterThan(0);
    }
  });
});
