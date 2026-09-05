import {
  SUBSTITUTION_REASON_MAX_LENGTH,
  substitutionSchema,
} from "@/features/timetable/substitution-schema";

const VALID = {
  timetable_slot_id: "slot1",
  date: "2026-09-08",
  substitute_staff_id: "staff2",
  reason: "Medical leave",
};

describe("substitutionSchema", () => {
  it("accepts a well-formed proposal", () => {
    expect(substitutionSchema.safeParse(VALID).success).toBe(true);
  });

  it("requires the slot, the date and the covering teacher", () => {
    expect(substitutionSchema.safeParse({ ...VALID, timetable_slot_id: "" }).success).toBe(false);
    expect(substitutionSchema.safeParse({ ...VALID, date: "" }).success).toBe(false);
    expect(substitutionSchema.safeParse({ ...VALID, substitute_staff_id: "" }).success).toBe(false);
  });

  it("treats an empty reason as valid — the column is nullable", () => {
    expect(substitutionSchema.safeParse({ ...VALID, reason: "" }).success).toBe(true);
  });

  it("rejects a reason longer than the column", () => {
    expect(
      substitutionSchema.safeParse({
        ...VALID,
        reason: "x".repeat(SUBSTITUTION_REASON_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });
});
