import { allocationSchema } from "@/features/academics/allocation-schema";

const VALID = {
  academic_session_id: "sess1",
  section_id: "sec1",
  subject_id: "sub1",
  staff_id: "staff1",
  is_primary: true,
  weekly_periods: "",
  effective_from: "",
};

describe("allocationSchema", () => {
  it("accepts an allocation with no period override and no start date", () => {
    expect(allocationSchema.safeParse(VALID).success).toBe(true);
  });

  it("requires the session, section, subject and teacher", () => {
    for (const field of ["academic_session_id", "section_id", "subject_id", "staff_id"] as const) {
      expect(allocationSchema.safeParse({ ...VALID, [field]: "" }).success).toBe(false);
    }
  });

  it("accepts a whole-number period override", () => {
    expect(allocationSchema.safeParse({ ...VALID, weekly_periods: "6" }).success).toBe(true);
  });

  it("rejects a period override below 1 or non-integer", () => {
    const zero = allocationSchema.safeParse({ ...VALID, weekly_periods: "0" });
    expect(zero.success).toBe(false);
    expect(zero.error?.issues[0]?.message).toBe(
      "Weekly periods must be a whole number of at least 1, or left blank.",
    );
    expect(allocationSchema.safeParse({ ...VALID, weekly_periods: "3.5" }).success).toBe(false);
  });
});
