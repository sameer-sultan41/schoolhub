import { toFeeScheduleBody, toFeeSchedulesQueryParams } from "../fee-schedules-helper";

describe("toFeeSchedulesQueryParams", () => {
  it("maps every filter to the API's name", () => {
    expect(toFeeSchedulesQueryParams({ feeStructureId: "f1", cursor: "c1", pageSize: 20 })).toEqual(
      { fee_structure_id: "f1", cursor: "c1", page_size: 20 },
    );
  });

  it("drops undefined and empty filters", () => {
    expect(toFeeSchedulesQueryParams({ search: "", ordering: undefined })).toEqual({});
  });
});

describe("toFeeScheduleBody", () => {
  it("maps the input to the snake_case body", () => {
    expect(
      toFeeScheduleBody({
        feeStructureId: "f1",
        feeHeadId: "h1",
        amount: "1500.00",
        frequency: "monthly" as const,
        termId: null,
        dueDay: 10,
        dueDate: null,
      }),
    ).toEqual({
      fee_structure: "f1",
      fee_head: "h1",
      amount: "1500.00",
      frequency: "monthly",
      term: null,
      due_day: 10,
      due_date: null,
    });
  });

  it("sends nothing for an empty input", () => {
    expect(toFeeScheduleBody({})).toEqual({});
  });
});
