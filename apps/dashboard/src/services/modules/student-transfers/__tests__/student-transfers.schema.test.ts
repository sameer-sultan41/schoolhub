import { requestTransferFormSchema } from "../student-transfers.schema";

describe("requestTransferFormSchema", () => {
  it("parses a valid inter_campus submission and omits external_school_name", () => {
    const result = requestTransferFormSchema.parse({
      transfer_type: "inter_campus",
      from_campus_id: "campus-1",
      to_campus_id: "campus-2",
      reason: "Family relocation",
      effective_date: "2026-11-01",
      external_school_name: "Should be stripped",
    });

    expect(result).not.toHaveProperty("external_school_name");
    if (result.transfer_type !== "inter_campus") throw new Error("expected inter_campus");
    expect(result.to_campus_id).toBe("campus-2");
  });

  it("parses a valid outgoing submission and omits to_campus_id", () => {
    const result = requestTransferFormSchema.parse({
      transfer_type: "outgoing",
      from_campus_id: "campus-1",
      external_school_name: "Another School",
      reason: "Relocating",
      effective_date: "2026-11-01",
      to_campus_id: "should be stripped",
    });

    expect(result).not.toHaveProperty("to_campus_id");
    if (result.transfer_type !== "outgoing") throw new Error("expected outgoing");
    expect(result.external_school_name).toBe("Another School");
  });

  it("rejects an inter_campus submission missing to_campus_id", () => {
    const result = requestTransferFormSchema.safeParse({
      transfer_type: "inter_campus",
      from_campus_id: "campus-1",
      reason: "x",
      effective_date: "2026-11-01",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an outgoing submission missing external_school_name", () => {
    const result = requestTransferFormSchema.safeParse({
      transfer_type: "outgoing",
      from_campus_id: "campus-1",
      reason: "x",
      effective_date: "2026-11-01",
    });

    expect(result.success).toBe(false);
  });
});
