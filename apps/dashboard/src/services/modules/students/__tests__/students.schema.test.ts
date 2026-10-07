import {
  changeSectionFormSchema,
  emergencyContactSchema,
  enrollFormSchema,
} from "../students.schema";

function baseContact() {
  return { name: "Ayesha Khan", relationship: "Mother", phone: "0300-1234567" };
}

function priorityMessage(result: ReturnType<typeof emergencyContactSchema.safeParse>) {
  if (result.success) return undefined;
  return result.error.issues.find((issue) => issue.path[0] === "priority")?.message;
}

describe("emergencyContactSchema.priority", () => {
  it("accepts a valid priority", () => {
    const result = emergencyContactSchema.safeParse({ ...baseContact(), priority: 1 });

    expect(result.success).toBe(true);
  });

  it("shows the friendly required message when priority is undefined (the cleared-field case the UI normalizes to)", () => {
    const result = emergencyContactSchema.safeParse({ ...baseContact(), priority: undefined });

    expect(priorityMessage(result)).toBe("Priority is required.");
  });

  it("also shows the friendly required message for a raw NaN, the schema's own defensive case for a NaN that reaches it some other way than the form's onChange", () => {
    const result = emergencyContactSchema.safeParse({ ...baseContact(), priority: Number.NaN });

    expect(priorityMessage(result)).toBe("Priority is required.");
  });

  it("falls back to zod's own message for a non-numeric, non-undefined priority", () => {
    const result = emergencyContactSchema.safeParse({ ...baseContact(), priority: "oops" });
    const message = priorityMessage(result);

    expect(message).toBeDefined();
    expect(message).not.toBe("Priority is required.");
  });
});

describe("enrollFormSchema", () => {
  it("accepts a valid submission with only the required fields", () => {
    const result = enrollFormSchema.safeParse({
      academic_session_id: "sess-1",
      class_id: "c1",
      section_id: "sec1",
      enrollment_date: "2026-04-05",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a submission missing section_id", () => {
    const result = enrollFormSchema.safeParse({
      academic_session_id: "sess-1",
      class_id: "c1",
      enrollment_date: "2026-04-05",
    });

    expect(result.success).toBe(false);
  });
});

describe("changeSectionFormSchema", () => {
  it("accepts a valid submission with only section_id", () => {
    const result = changeSectionFormSchema.safeParse({ section_id: "sec2" });

    expect(result.success).toBe(true);
  });

  it("has no class_id field at all", () => {
    expect(changeSectionFormSchema.safeParse({ section_id: "sec2" }).success).toBe(true);
    expect("class_id" in changeSectionFormSchema.shape).toBe(false);
  });
});
