import {
  isoToLocalDate,
  isoToLocalInput,
  localDateToIso,
  localDayEndToIso,
  localInputToIso,
} from "@/lib/date-time-input";

describe("date-time inputs", () => {
  it("carries a timestamp through a datetime-local input unchanged", () => {
    const iso = "2026-10-05T09:30:00.000Z";

    expect(localInputToIso(isoToLocalInput(iso))).toBe(iso);
    expect(isoToLocalInput(null)).toBe("");
    expect(isoToLocalInput("not a date")).toBe("");
    expect(localInputToIso("")).toBeNull();
  });

  it("reads a date input as that day's local midnight, and back", () => {
    const iso = localDateToIso("2026-12-10");

    expect(iso).toBe(new Date(2026, 11, 10).toISOString());
    expect(isoToLocalDate(iso)).toBe("2026-12-10");
    expect(localDateToIso("")).toBeNull();
    expect(isoToLocalDate(undefined)).toBe("");
  });

  it("reads a date input as an inclusive end: that day's last local millisecond", () => {
    expect(localDayEndToIso("2026-12-10")).toBe(
      new Date(2026, 11, 10, 23, 59, 59, 999).toISOString(),
    );
    expect(localDayEndToIso("")).toBeNull();
  });
});
