import {
  activityToIsActive,
  bytesToGib,
  formatLimit,
  limitsFromText,
  localInputToIso,
  parseLimit,
  readOverUsage,
  statusFilterToStatus,
  toPlanQueryParams,
  toTenantQueryParams,
} from "../platform-helper";

describe("platform-helper", () => {
  it("reads only well-formed breaches out of meta.over_usage", () => {
    // `apps/api/apps/platform_admin/usage/limits.py`'s `breaches`, plus junk the reader drops.
    const meta = {
      over_usage: [
        { tenant_id: "t1", metric: "students", limit: 100, usage: 320 },
        { tenant_id: "t2", metric: "staff", limit: "10", usage: 12 },
        null,
      ],
    };

    expect(readOverUsage(meta)).toEqual([
      { tenant_id: "t1", metric: "students", limit: 100, usage: 320 },
    ]);
    expect(readOverUsage({})).toEqual([]);
    expect(readOverUsage({ over_usage: "nope" })).toEqual([]);
  });

  it("treats a blank limit as unlimited, both ways", () => {
    expect(parseLimit("  ")).toBeNull();
    expect(parseLimit("250")).toBe(250);
    expect(formatLimit(null)).toBe("");
    expect(formatLimit(undefined)).toBe("");
    expect(formatLimit(0)).toBe("0");
    expect(limitsFromText(["students", "staff"], { students: "5", staff: "" })).toEqual({
      students: 5,
      staff: null,
    });
  });

  it("maps the list filters to the API's query", () => {
    expect(statusFilterToStatus("all")).toBeUndefined();
    expect(statusFilterToStatus("bogus")).toBeUndefined();
    expect(statusFilterToStatus("past_due")).toBe("past_due");
    expect(activityToIsActive("active")).toBe(true);
    expect(activityToIsActive("retired")).toBe(false);
    expect(activityToIsActive("all")).toBeUndefined();
    expect(toTenantQueryParams({ search: "", currentPlan: "" })).toEqual(
      expect.objectContaining({ search: undefined, current_plan: undefined }),
    );
    expect(toPlanQueryParams({ isActive: true })).toEqual(
      expect.objectContaining({ is_active: true }),
    );
  });

  it("converts storage bytes to GiB and a local date-time to an instant", () => {
    expect(bytesToGib(3 * 1024 ** 3)).toBe(3);
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("not a date")).toBeNull();
    expect(localInputToIso("2026-12-01T09:30")).toBe(new Date("2026-12-01T09:30").toISOString());
  });
});
