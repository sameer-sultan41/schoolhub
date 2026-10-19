import {
  buildRoomInput,
  recordToRoomFormValues,
  roomLocation,
  statusToIsActive,
  typeFilterToRoomType,
} from "../rooms-helper";
import { roomFormSchema } from "../rooms.schema";
import { roomRecord } from "./rooms-fixtures";

describe("rooms-helper", () => {
  it("round-trips a record through the form", () => {
    const values = recordToRoomFormValues(roomRecord());

    expect(values.capacity).toBe("40");
    expect(buildRoomInput(values)).toEqual({
      campusId: roomRecord().campus_id,
      name: "Room 101",
      code: "R-101",
      roomType: "classroom",
      capacity: 40,
      building: "Main block",
      floor: "1",
      isActive: true,
    });
  });

  it("sends null for a blank capacity, building and floor, which clears them", () => {
    const values = {
      ...recordToRoomFormValues(roomRecord()),
      capacity: " ",
      building: "",
      floor: "",
    };

    expect(buildRoomInput(values)).toMatchObject({ capacity: null, building: null, floor: null });
  });

  it("accepts a blank capacity and refuses zero or a fraction", () => {
    const values = recordToRoomFormValues(roomRecord());

    expect(roomFormSchema.safeParse({ ...values, capacity: "" }).success).toBe(true);
    expect(roomFormSchema.safeParse({ ...values, capacity: "0" }).success).toBe(false);
    expect(roomFormSchema.safeParse({ ...values, capacity: "2.5" }).success).toBe(false);
  });

  it("maps the filters, with all as no filter", () => {
    expect(statusToIsActive("inactive")).toBe(false);
    expect(statusToIsActive("all")).toBeUndefined();
    expect(typeFilterToRoomType("lab")).toBe("lab");
    expect(typeFilterToRoomType("all")).toBeUndefined();
  });

  it("joins building and floor, skipping what is missing", () => {
    expect(roomLocation({ building: "Main block", floor: "1" })).toBe("Main block · 1");
    expect(roomLocation({ building: null, floor: "2" })).toBe("2");
    expect(roomLocation({ building: null, floor: null })).toBe("");
  });
});
