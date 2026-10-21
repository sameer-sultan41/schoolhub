import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";

import { buildUser } from "@/test-utils";

import {
  buildProposeInput,
  canCancelSubstitution,
  toSubstitutionQueryParams,
  weekdayOfIsoDate,
} from "../teacher-substitutions-helper";
import { PROPOSER_ID, substitutionRecord } from "./teacher-substitutions-fixtures";

const TODAY = "2099-01-01";

function user(id: string, ...keys: PermissionKey[]): AuthenticatedUser {
  return { ...buildUser(keys), id };
}

describe("canCancelSubstitution", () => {
  const approver = user("approver", "timetable.substitution.approve");
  const proposer = user(PROPOSER_ID, "timetable.substitution.create");
  const otherProposer = user("someone-else", "timetable.substitution.create");

  it("lets an approver cancel any open cover, today or later", () => {
    expect(canCancelSubstitution(substitutionRecord(), approver, TODAY)).toBe(true);
    expect(
      canCancelSubstitution(substitutionRecord({ status: "confirmed" }), approver, TODAY),
    ).toBe(true);
  });

  it("lets a proposer withdraw only their own proposal", () => {
    expect(canCancelSubstitution(substitutionRecord(), proposer, TODAY)).toBe(true);
    expect(canCancelSubstitution(substitutionRecord(), otherProposer, TODAY)).toBe(false);
    expect(
      canCancelSubstitution(substitutionRecord({ status: "confirmed" }), proposer, TODAY),
    ).toBe(false);
  });

  it("never offers past, declined or cancelled cover", () => {
    expect(canCancelSubstitution(substitutionRecord({ date: "2098-12-31" }), approver, TODAY)).toBe(
      false,
    );
    expect(canCancelSubstitution(substitutionRecord({ status: "declined" }), approver, TODAY)).toBe(
      false,
    );
    expect(
      canCancelSubstitution(substitutionRecord({ status: "cancelled" }), approver, TODAY),
    ).toBe(false);
  });
});

describe("the propose form", () => {
  it("reads a date's weekday Monday-based, whatever the viewer's timezone", () => {
    expect(weekdayOfIsoDate("2026-10-19")).toBe(0); // a Monday
    expect(weekdayOfIsoDate("2026-10-25")).toBe(6); // a Sunday
  });

  it("sends a kept room and an empty reason as null", () => {
    expect(
      buildProposeInput({
        date: "2026-10-19",
        absent_staff_id: "a",
        timetable_slot_id: "s",
        substitute_staff_id: "b",
        room_id: "",
        reason: "  ",
      }),
    ).toEqual({
      timetableSlotId: "s",
      date: "2026-10-19",
      absentStaffId: "a",
      substituteStaffId: "b",
      roomId: null,
      reason: null,
    });
  });

  it("maps the date range onto the list's inclusive filters", () => {
    expect(
      toSubstitutionQueryParams({ page: 1, pageSize: 10, dateFrom: "2026-10-01", dateTo: "" }),
    ).toEqual({ page: 1, page_size: 10, date__gte: "2026-10-01" });
  });
});
