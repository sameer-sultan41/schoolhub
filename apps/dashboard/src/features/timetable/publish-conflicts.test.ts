import { ApiError } from "@schoolhub/api-client";
import { conflictsFromError } from "@/features/timetable/publish-conflicts";

/**
 * The envelope `services.publish_section_timetable` produces: a human-readable
 * `non_field` reason in `details`, and the machine-readable findings in `meta`
 * where nothing between the raiser and here reshapes them.
 */
function publishRefusal(meta?: Record<string, unknown>): ApiError {
  return new ApiError({
    code: "domain_rule_violation",
    message: "unprocessable",
    status: 422,
    url: "/timetables/sec1:publish",
    requestId: "req-publish",
    details: [
      {
        field: "non_field",
        issue: "This timetable has unresolved hard conflicts and cannot be published.",
      },
    ],
    meta: meta ?? {
      conflicts: [
        {
          type: "teacher_double_booked",
          severity: "hard",
          slot_ids: ["slot-a", "slot-b"],
          message: "This teacher is already teaching in this period.",
        },
        {
          type: "room_over_capacity",
          severity: "soft",
          slot_ids: ["slot-c"],
          message: "This room seats 20; the section has 31 students.",
        },
      ],
    },
  });
}

describe("conflictsFromError", () => {
  it("reads the conflict list a refused publish carries", () => {
    expect(conflictsFromError(publishRefusal())).toEqual([
      {
        type: "teacher_double_booked",
        severity: "hard",
        slot_ids: ["slot-a", "slot-b"],
        message: "This teacher is already teaching in this period.",
      },
      {
        type: "room_over_capacity",
        severity: "soft",
        slot_ids: ["slot-c"],
        message: "This room seats 20; the section has 31 students.",
      },
    ]);
  });

  it("keeps every slot id — both sides of a clash must highlight", () => {
    const [first] = conflictsFromError(publishRefusal());
    // This is why the findings travel in `meta`. Flattened into `details` they
    // became one `conflicts[0].slot_ids` entry per id, and `fieldErrors()` keeps
    // only the first per field name, so "slot-b" would never reach the grid.
    expect(first?.slot_ids).toEqual(["slot-a", "slot-b"]);
  });

  it("preserves the server's order rather than re-sorting findings", () => {
    const error = publishRefusal({
      conflicts: [
        { type: "first", severity: "hard", slot_ids: [], message: "a" },
        { type: "second", severity: "hard", slot_ids: [], message: "b" },
      ],
    });

    expect(conflictsFromError(error).map((conflict) => conflict.type)).toEqual(["first", "second"]);
  });

  it("treats an unrecognised severity as blocking rather than downgrading it", () => {
    const error = publishRefusal({
      conflicts: [
        {
          type: "something_new",
          severity: "critical",
          message: "A detector this client has never heard of.",
        },
      ],
    });

    expect(conflictsFromError(error)[0]).toEqual({
      type: "something_new",
      severity: "hard",
      slot_ids: [],
      message: "A detector this client has never heard of.",
    });
  });

  it("drops a half-formed finding rather than rendering it blank", () => {
    const error = publishRefusal({ conflicts: [{ severity: "hard" }, "not an object"] });

    expect(conflictsFromError(error)).toEqual([]);
  });

  it("survives a refusal that carried no structured context at all", () => {
    // `meta` is optional on the envelope, and a publish can also be refused for
    // a reason that is not a conflict — "there is no draft to publish".
    const error = new ApiError({
      code: "domain_rule_violation",
      message: "unprocessable",
      status: 422,
      url: "/timetables/sec1:publish",
      details: [
        { field: "non_field", issue: "There is no draft timetable for this section to publish." },
      ],
    });

    expect(conflictsFromError(error)).toEqual([]);
  });

  it("ignores a meta whose conflicts key is not a list", () => {
    expect(conflictsFromError(publishRefusal({ conflicts: "lots" }))).toEqual([]);
  });

  it("returns nothing for anything that is not an ApiError", () => {
    expect(conflictsFromError(new Error("boom"))).toEqual([]);
    expect(conflictsFromError(undefined)).toEqual([]);
  });
});
