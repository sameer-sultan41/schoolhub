import {
  buildPeriodInput,
  kindToIsBreak,
  lessonPeriodsOn,
  periodWeekdayOf,
  periodWeekdays,
  recordToPeriodFormValues,
  toPeriodQueryParams,
} from "../periods-helper";
import { periodFormSchema } from "../periods.schema";
import { periodRecord } from "./periods-fixtures";

describe("periods-helper", () => {
  it("maps a record to the form, cutting the times to HH:MM and null days to none", () => {
    expect(recordToPeriodFormValues(periodRecord())).toEqual({
      campus_id: "",
      name: "Period 1",
      sequence: 1,
      start_time: "08:00",
      end_time: "08:45",
      is_break: false,
      weekdays: [],
    });
  });

  it("sends null for every campus and for no days, and puts picked days in week order", () => {
    const values = recordToPeriodFormValues(periodRecord());

    expect(buildPeriodInput(values)).toMatchObject({ campusId: null, weekdays: null });
    expect(buildPeriodInput({ ...values, weekdays: [4, 0, 2] }).weekdays).toEqual([0, 2, 4]);
  });

  it("reads the record's days, with none as null", () => {
    expect(periodWeekdays(periodRecord({ weekdays: [1, 3] }))).toEqual([1, 3]);
    expect(periodWeekdays(periodRecord({ weekdays: null }))).toBeNull();
  });

  it("maps the kind filter to is_break, keeping false", () => {
    expect(kindToIsBreak("teaching")).toBe(false);
    expect(kindToIsBreak("break")).toBe(true);
    expect(kindToIsBreak("all")).toBeUndefined();
    expect(toPeriodQueryParams({ page: 1, pageSize: 10, isBreak: false, forCampusId: "" })).toEqual(
      { page: 1, page_size: 10, is_break: false },
    );
  });

  it("refuses an end time that isn't after the start, on end_time", () => {
    const result = periodFormSchema.safeParse({
      ...recordToPeriodFormValues(periodRecord()),
      start_time: "09:00",
      end_time: "08:30",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["end_time"]);
  });
});

describe("lesson periods on a date", () => {
  it("numbers a date's weekday from Monday", () => {
    expect(periodWeekdayOf("2026-10-19")).toBe(0); // a Monday
    expect(periodWeekdayOf("2026-10-24")).toBe(5); // a Saturday
    expect(periodWeekdayOf("2026-10-25")).toBe(6); // a Sunday
  });

  it("keeps the lessons that run that day and drops breaks", () => {
    const daily = periodRecord({ id: "p-daily", weekdays: null });
    const mondays = periodRecord({ id: "p-monday", weekdays: [0] });
    const fridays = periodRecord({ id: "p-friday", weekdays: [4] });
    const recess = periodRecord({ id: "p-recess", is_break: true, weekdays: null });

    const ids = lessonPeriodsOn([daily, mondays, fridays, recess], "2026-10-19").map(
      (period) => period.id,
    );

    expect(ids).toEqual(["p-daily", "p-monday"]);
  });
});
