import type { AuthenticatedUser } from "@schoolhub/types";

import { buildUser } from "@/test-utils";
import {
  canDecideCorrection,
  correctionChanges,
  isOwnCorrection,
  mineFilterToMine,
  toCorrectionQueryParams,
} from "../attendance-corrections-helper";
import { correctionRecord, REQUESTER_ID } from "./attendance-corrections-fixtures";

const REQUESTER: AuthenticatedUser = { ...buildUser([]), id: REQUESTER_ID };
const APPROVER = buildUser(["attendance.correction.approve"]);

describe("correctionChanges", () => {
  it("lists only the fields that differ, in the form's order", () => {
    expect(correctionChanges(correctionRecord())).toEqual([
      { field: "status", from: "late", to: "present" },
      { field: "remarks", from: null, to: "Gate log" },
    ]);
  });

  it("shows a time as HH:MM and a cleared value as null", () => {
    const changes = correctionChanges(
      correctionRecord({
        old_values: { check_in_time: "08:20:00", check_out_time: "13:00:00" },
        new_values: { check_in_time: "08:05:00", check_out_time: null },
      }),
    );

    expect(changes).toEqual([
      { field: "check_in_time", from: "08:20", to: "08:05" },
      { field: "check_out_time", from: "13:00", to: null },
    ]);
  });

  it("ignores a field the proposal does not name, and any key that is not correctable", () => {
    const changes = correctionChanges(
      correctionRecord({
        old_values: { status: "late", remarks: "Old", marked_by: "someone" },
        new_values: { status: "present", marked_by: "someone-else" },
      }),
    );

    expect(changes).toEqual([{ field: "status", from: "late", to: "present" }]);
  });

  it("reads a malformed payload as no change instead of throwing", () => {
    expect(correctionChanges(correctionRecord({ old_values: null, new_values: "x" }))).toEqual([]);
  });
});

describe("canDecideCorrection", () => {
  const pending = correctionRecord();

  it("allows an approver on a pending request from someone else", () => {
    expect(canDecideCorrection(pending, APPROVER, true)).toBe(true);
  });

  it("refuses the approver's own request", () => {
    expect(isOwnCorrection(pending, REQUESTER)).toBe(true);
    expect(canDecideCorrection(pending, REQUESTER, true)).toBe(false);
  });

  it("is the shared pending / key / user gate plus the requester rule", () => {
    expect(canDecideCorrection(correctionRecord({ status: "approved" }), APPROVER, true)).toBe(
      false,
    );
    expect(canDecideCorrection(pending, APPROVER, false)).toBe(false);
    expect(canDecideCorrection(pending, undefined, true)).toBe(false);
    expect(isOwnCorrection(pending, undefined)).toBe(false);
  });
});

describe("query mapping", () => {
  it("maps the filters and drops the ones that are not set", () => {
    expect(
      toCorrectionQueryParams({
        cursor: "c2",
        pageSize: 25,
        ordering: "-created_at",
        status: "pending",
        mine: true,
      }),
    ).toEqual({
      page_size: 25,
      cursor: "c2",
      ordering: "-created_at",
      status: "pending",
      mine: true,
    });
    expect(toCorrectionQueryParams({ pageSize: 25 })).toEqual({ page_size: 25 });
  });

  it("reads a checked Mine as mine=true and an unchecked one as no filter, never false", () => {
    expect(mineFilterToMine("true")).toBe(true);
    expect(mineFilterToMine("")).toBeUndefined();
    expect(mineFilterToMine("false")).toBeUndefined();
  });
});
