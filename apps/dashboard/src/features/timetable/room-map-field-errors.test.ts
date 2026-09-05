import { mapRoomFieldErrors } from "@/features/timetable/room-map-field-errors";

describe("mapRoomFieldErrors", () => {
  it("routes a rendered field to that field", () => {
    expect(mapRoomFieldErrors({ code: "This code is already used on that campus." })).toEqual({
      known: { code: "This code is already used on that campus." },
      unknown: [],
    });
  });

  it("routes anything the form does not render to root", () => {
    expect(mapRoomFieldErrors({ tenant: "Nope." })).toEqual({ known: {}, unknown: ["Nope."] });
  });

  it("returns empty buckets for an empty response", () => {
    expect(mapRoomFieldErrors({})).toEqual({ known: {}, unknown: [] });
  });
});
