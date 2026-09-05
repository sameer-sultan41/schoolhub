import { SLOT_NOTES_MAX_LENGTH, slotSchema } from "@/features/timetable/slot-schema";

const VALID = { subject_id: "sub1", staff_id: "staff1", room_id: "room1", notes: "" };

describe("slotSchema", () => {
  it("accepts a filled cell", () => {
    expect(slotSchema.safeParse(VALID).success).toBe(true);
  });

  it("accepts a cell with no subject, teacher or room — a homeroom slot", () => {
    expect(
      slotSchema.safeParse({ subject_id: "", staff_id: "", room_id: "", notes: "" }).success,
    ).toBe(true);
  });

  it("rejects a note longer than the column", () => {
    const result = slotSchema.safeParse({
      ...VALID,
      notes: "x".repeat(SLOT_NOTES_MAX_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it("accepts a note exactly at the column length", () => {
    expect(
      slotSchema.safeParse({ ...VALID, notes: "x".repeat(SLOT_NOTES_MAX_LENGTH) }).success,
    ).toBe(true);
  });
});
