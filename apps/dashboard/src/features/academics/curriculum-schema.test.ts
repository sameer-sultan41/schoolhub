import { cloneCurriculumSchema, curriculumSchema } from "@/features/academics/curriculum-schema";

const VALID = {
  academic_session_id: "sess1",
  class_id: "class1",
  subject_id: "sub1",
  campus_id: "",
  is_elective: false,
  elective_group: "",
  weekly_periods: "5",
  notes: "",
};

describe("curriculumSchema", () => {
  it("accepts a minimal core-subject mapping", () => {
    expect(curriculumSchema.safeParse(VALID).success).toBe(true);
  });

  it("requires the session, class and subject", () => {
    for (const field of ["academic_session_id", "class_id", "subject_id"] as const) {
      const result = curriculumSchema.safeParse({ ...VALID, [field]: "" });
      expect(result.success).toBe(false);
    }
  });

  it("rejects a weekly period target below 1", () => {
    const result = curriculumSchema.safeParse({ ...VALID, weekly_periods: "0" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Weekly periods must be a whole number of at least 1.",
    );
  });

  it("rejects a non-integer weekly period target", () => {
    expect(curriculumSchema.safeParse({ ...VALID, weekly_periods: "2.5" }).success).toBe(false);
    expect(curriculumSchema.safeParse({ ...VALID, weekly_periods: "" }).success).toBe(false);
  });

  it("requires an elective group once the row is marked elective", () => {
    const result = curriculumSchema.safeParse({ ...VALID, is_elective: true });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["elective_group"]);
  });

  it("accepts an elective that names its group", () => {
    const result = curriculumSchema.safeParse({
      ...VALID,
      is_elective: true,
      elective_group: "Languages",
    });
    expect(result.success).toBe(true);
  });
});

describe("cloneCurriculumSchema", () => {
  it("accepts two different sessions", () => {
    const result = cloneCurriculumSchema.safeParse({
      source_academic_session_id: "sess1",
      target_academic_session_id: "sess2",
    });
    expect(result.success).toBe(true);
  });

  it("rejects cloning a session onto itself", () => {
    const result = cloneCurriculumSchema.safeParse({
      source_academic_session_id: "sess1",
      target_academic_session_id: "sess1",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["target_academic_session_id"]);
  });

  it("requires both sessions", () => {
    expect(
      cloneCurriculumSchema.safeParse({
        source_academic_session_id: "",
        target_academic_session_id: "sess2",
      }).success,
    ).toBe(false);
  });
});
