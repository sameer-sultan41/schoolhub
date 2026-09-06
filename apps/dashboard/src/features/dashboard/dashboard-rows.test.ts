import { DASHBOARD_MAX_ROWS } from "@/features/dashboard/dashboard-constants";
import { takeTopRows } from "@/features/dashboard/dashboard-rows";

describe("takeTopRows", () => {
  it("answers an empty, valid shape for nothing at all", () => {
    expect(takeTopRows([])).toEqual({ visible: [], remainder: 0 });
  });

  it("keeps every row, and counts no remainder, under the cap", () => {
    const rows = ["a", "b", "c"];

    expect(takeTopRows(rows)).toEqual({ visible: rows, remainder: 0 });
  });

  it("keeps exactly the cap, and still counts no remainder, at it", () => {
    const rows = Array.from({ length: DASHBOARD_MAX_ROWS }, (_, index) => index);

    expect(takeTopRows(rows)).toEqual({ visible: rows, remainder: 0 });
  });

  it("cuts at the cap and counts what it left out", () => {
    const rows = Array.from({ length: DASHBOARD_MAX_ROWS + 3 }, (_, index) => index);

    const { visible, remainder } = takeTopRows(rows);

    expect(visible).toHaveLength(DASHBOARD_MAX_ROWS);
    expect(remainder).toBe(3);
  });

  it("cuts from the front, leaving the caller's order alone", () => {
    // The cut is the only decision this makes. Which rows rank where is the caller's,
    // and a helper that re-sorted would silently overrule two charts that order by
    // deliberately different things.
    const rows = ["z", "y", "x", "w"];

    expect(takeTopRows(rows).visible).toEqual(rows);
  });
});
