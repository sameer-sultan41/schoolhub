import { studentSchema } from "@/features/students/student-schema";

const validValues = {
  first_name: "Amina",
  last_name: "Khan",
  preferred_name: "",
  date_of_birth: "2015-06-01",
  gender: "female" as const,
  campus_id: "campus-1",
  house_id: "",
  admission_date: "2026-04-01",
  blood_group: "",
  nationality: "",
  religion: "",
  previous_school: "",
  medical_notes: "",
};

describe("studentSchema", () => {
  it("accepts a fully valid payload", () => {
    expect(studentSchema.safeParse(validValues).success).toBe(true);
  });

  it("rejects an empty first_name", () => {
    const result = studentSchema.safeParse({ ...validValues, first_name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a first_name over 100 characters", () => {
    const result = studentSchema.safeParse({ ...validValues, first_name: "a".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown gender value", () => {
    const result = studentSchema.safeParse({ ...validValues, gender: "unknown" });
    expect(result.success).toBe(false);
  });

  it.each(["male", "female", "other", "unspecified"] as const)("accepts gender %s", (gender) => {
    expect(studentSchema.safeParse({ ...validValues, gender }).success).toBe(true);
  });

  it("rejects a date of birth in the future", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const result = studentSchema.safeParse({
      ...validValues,
      date_of_birth: future.toISOString().slice(0, 10),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an admission_date before date_of_birth", () => {
    const result = studentSchema.safeParse({
      ...validValues,
      date_of_birth: "2026-04-01",
      admission_date: "2015-06-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing campus_id", () => {
    const result = studentSchema.safeParse({ ...validValues, campus_id: "" });
    expect(result.success).toBe(false);
  });

  it("allows house_id to be empty (optional)", () => {
    expect(studentSchema.safeParse({ ...validValues, house_id: "" }).success).toBe(true);
  });
});
