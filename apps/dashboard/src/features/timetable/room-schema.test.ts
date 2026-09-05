import { ROOM_CODE_MAX_LENGTH, roomSchema } from "@/features/timetable/room-schema";

const VALID = {
  campus_id: "campus1",
  name: "Physics Lab",
  code: "L-12",
  room_type: "lab" as const,
  capacity: "30",
  building: "",
  floor: "",
  is_active: true,
};

describe("roomSchema", () => {
  it("accepts a well-formed room", () => {
    expect(roomSchema.safeParse(VALID).success).toBe(true);
  });

  it("requires a campus, a name and a code", () => {
    expect(roomSchema.safeParse({ ...VALID, campus_id: "" }).success).toBe(false);
    expect(roomSchema.safeParse({ ...VALID, name: "" }).success).toBe(false);
    expect(roomSchema.safeParse({ ...VALID, code: "" }).success).toBe(false);
  });

  it("rejects a code longer than the column", () => {
    expect(
      roomSchema.safeParse({ ...VALID, code: "x".repeat(ROOM_CODE_MAX_LENGTH + 1) }).success,
    ).toBe(false);
  });

  it("treats a blank capacity as valid — a hall with no fixed seating", () => {
    expect(roomSchema.safeParse({ ...VALID, capacity: "" }).success).toBe(true);
  });

  it("rejects a capacity that is not a whole number of at least 1", () => {
    expect(roomSchema.safeParse({ ...VALID, capacity: "0" }).success).toBe(false);
    expect(roomSchema.safeParse({ ...VALID, capacity: "12.5" }).success).toBe(false);
  });

  it("rejects a room type the model does not define", () => {
    expect(roomSchema.safeParse({ ...VALID, room_type: "dungeon" }).success).toBe(false);
  });
});
