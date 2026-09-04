import { staffSchema } from "@/features/staff/staff-schema";

const validValues = {
  first_name: "Bilal",
  last_name: "Ahmed",
  gender: "male" as const,
  date_of_birth: "1985-06-01",
  staff_type: "teaching" as const,
  campus_id: "campus-1",
  department_id: "",
  designation_id: "",
  employment_type: "full_time" as const,
  joining_date: "2026-04-01",
  email: "bilal@cityschool.test",
  phone: "+923001234567",
  national_id: "",
  public_bio: "",
};

describe("staffSchema", () => {
  it("accepts a fully valid payload", () => {
    expect(staffSchema.safeParse(validValues).success).toBe(true);
  });

  it("rejects an empty first_name", () => {
    const result = staffSchema.safeParse({ ...validValues, first_name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a first_name over 100 characters", () => {
    const result = staffSchema.safeParse({ ...validValues, first_name: "a".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown staff_type value", () => {
    const result = staffSchema.safeParse({ ...validValues, staff_type: "unknown" });
    expect(result.success).toBe(false);
  });

  it.each(["teaching", "non_teaching"] as const)("accepts staff_type %s", (staff_type) => {
    expect(staffSchema.safeParse({ ...validValues, staff_type }).success).toBe(true);
  });

  it("rejects a date of birth in the future", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const result = staffSchema.safeParse({
      ...validValues,
      date_of_birth: future.toISOString().slice(0, 10),
    });
    expect(result.success).toBe(false);
  });

  it("allows date_of_birth to be empty (optional)", () => {
    expect(staffSchema.safeParse({ ...validValues, date_of_birth: "" }).success).toBe(true);
  });

  it("rejects a missing campus_id", () => {
    const result = staffSchema.safeParse({ ...validValues, campus_id: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing joining_date", () => {
    const result = staffSchema.safeParse({ ...validValues, joining_date: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing phone", () => {
    const result = staffSchema.safeParse({ ...validValues, phone: "" });
    expect(result.success).toBe(false);
  });

  it("allows department_id and designation_id to be empty (optional)", () => {
    const result = staffSchema.safeParse({
      ...validValues,
      department_id: "",
      designation_id: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed email", () => {
    const result = staffSchema.safeParse({ ...validValues, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("allows email to be empty (optional)", () => {
    expect(staffSchema.safeParse({ ...validValues, email: "" }).success).toBe(true);
  });
});
