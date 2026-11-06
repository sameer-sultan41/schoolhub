import {
  buildFeeScheduleInput,
  defaultFeeScheduleFormValues,
  feeScheduleErrorFields,
  recordToFeeScheduleFormValues,
  toFeeScheduleBody,
  toFeeSchedulesQueryParams,
} from "../fee-schedules-helper";

describe("toFeeSchedulesQueryParams", () => {
  it("maps every filter to the API's name", () => {
    expect(toFeeSchedulesQueryParams({ feeStructureId: "f1", cursor: "c1", pageSize: 20 })).toEqual(
      { fee_structure_id: "f1", cursor: "c1", page_size: 20 },
    );
  });

  it("maps the head, frequency and term filters", () => {
    expect(
      toFeeSchedulesQueryParams({ feeHeadId: "h1", frequency: "per_term", termId: "t1" }),
    ).toEqual({ fee_head_id: "h1", frequency: "per_term", term_id: "t1" });
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

describe("buildFeeScheduleInput", () => {
  const base = { ...defaultFeeScheduleFormValues(), fee_head: "h1", amount: " 1500 " };

  it("sends only the due rule the frequency uses, the others null", () => {
    expect(
      buildFeeScheduleInput(
        { ...base, frequency: "monthly", due_day: "10", term: "t1", due_date: "2026-12-01" },
        "s1",
      ),
    ).toEqual({
      feeStructureId: "s1",
      feeHeadId: "h1",
      amount: "1500",
      frequency: "monthly",
      termId: null,
      dueDay: 10,
      dueDate: null,
    });
    expect(
      buildFeeScheduleInput({ ...base, frequency: "per_term", term: "t1", due_day: "10" }, "s1"),
    ).toMatchObject({ termId: "t1", dueDay: null, dueDate: null });
    expect(
      buildFeeScheduleInput({ ...base, frequency: "annual", due_date: "2026-12-01" }, "s1"),
    ).toMatchObject({ termId: null, dueDay: null, dueDate: "2026-12-01" });
  });

  it("sends null for a blank rule the frequency needs, so the server names the field", () => {
    expect(buildFeeScheduleInput({ ...base, frequency: "monthly" }, "s1")).toMatchObject({
      dueDay: null,
    });
  });

  it("never sends the late-fee policy, so an edit keeps it", () => {
    expect(buildFeeScheduleInput(base, "s1")).not.toHaveProperty("lateFeePolicy");
  });
});

describe("recordToFeeScheduleFormValues", () => {
  it("fills the blanks for a record with no rule", () => {
    expect(
      recordToFeeScheduleFormValues({
        id: "x",
        fee_structure: "s1",
        fee_head: "h1",
        amount: "10.00",
        frequency: "one_time",
        term: null,
        due_day: null,
        due_date: "2026-12-01",
        created_at: "",
        updated_at: "",
      }),
    ).toEqual({
      fee_head: "h1",
      amount: "10.00",
      frequency: "one_time",
      term: "",
      due_day: "",
      due_date: "2026-12-01",
    });
  });
});

describe("feeScheduleErrorFields", () => {
  it("adds the one due-rule field the frequency shows", () => {
    expect(feeScheduleErrorFields("monthly")).toEqual([
      "fee_head",
      "amount",
      "frequency",
      "due_day",
    ]);
    expect(feeScheduleErrorFields("per_term")).toContain("term");
    expect(feeScheduleErrorFields("annual")).toContain("due_date");
    expect(feeScheduleErrorFields("annual")).not.toContain("due_day");
  });
});
