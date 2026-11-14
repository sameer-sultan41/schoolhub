import { toFeeStructureBody, toFeeStructuresQueryParams } from "../fee-structures-helper";

describe("toFeeStructuresQueryParams", () => {
  it("maps every filter to the API's name", () => {
    expect(
      toFeeStructuresQueryParams({
        academicSessionId: "s1",
        classId: "k1",
        campusId: "m1",
        status: "draft",
        cursor: "c1",
        pageSize: 20,
      }),
    ).toEqual({
      academic_session_id: "s1",
      class_id: "k1",
      campus_id: "m1",
      status: "draft",
      cursor: "c1",
      page_size: 20,
    });
  });

  it("drops undefined and empty filters", () => {
    expect(toFeeStructuresQueryParams({ search: "", ordering: undefined })).toEqual({});
  });
});

describe("toFeeStructureBody", () => {
  it("maps the input to the snake_case body", () => {
    expect(
      toFeeStructureBody({
        name: "Grade 5",
        academicSessionId: "s1",
        classId: null,
        campusId: "m1",
      }),
    ).toEqual({ name: "Grade 5", academic_session: "s1", school_class: null, campus: "m1" });
  });

  it("sends nothing for an empty input", () => {
    expect(toFeeStructureBody({})).toEqual({});
  });
});
