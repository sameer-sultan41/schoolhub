import {
  promotionBatchSchema,
  promotionDecisionSchema,
} from "@/features/academics/promotion-schema";

describe("promotionBatchSchema", () => {
  const VALID = {
    from_academic_session_id: "sess1",
    to_academic_session_id: "sess2",
    class_id: "class1",
  };

  it("accepts a source/target pair and a class", () => {
    expect(promotionBatchSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects a batch whose target session is the source", () => {
    const result = promotionBatchSchema.safeParse({
      ...VALID,
      to_academic_session_id: "sess1",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["to_academic_session_id"]);
  });

  it("requires all three fields", () => {
    for (const field of [
      "from_academic_session_id",
      "to_academic_session_id",
      "class_id",
    ] as const) {
      expect(promotionBatchSchema.safeParse({ ...VALID, [field]: "" }).success).toBe(false);
    }
  });
});

describe("promotionDecisionSchema", () => {
  const VALID = {
    decision: "promoted" as const,
    to_class_id: "class2",
    to_section_id: "",
    override_reason: "",
    remarks: "",
  };

  it("accepts a promotion with a target class", () => {
    expect(promotionDecisionSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects a non-graduating decision with no target class", () => {
    const result = promotionDecisionSchema.safeParse({ ...VALID, to_class_id: "" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "A target class is required unless the student is graduating.",
    );
  });

  it("rejects a graduating student that still names a target class", () => {
    const result = promotionDecisionSchema.safeParse({ ...VALID, decision: "graduated" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("A graduating student has no target class.");
  });

  it("accepts a graduating student with no target class", () => {
    const result = promotionDecisionSchema.safeParse({
      ...VALID,
      decision: "graduated",
      to_class_id: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown decision value", () => {
    expect(promotionDecisionSchema.safeParse({ ...VALID, decision: "expelled" }).success).toBe(
      false,
    );
  });
});
