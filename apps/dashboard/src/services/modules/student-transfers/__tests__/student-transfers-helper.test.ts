import { formValuesToRequestTransferInput } from "../student-transfers-helper";

describe("formValuesToRequestTransferInput", () => {
  it("maps an inter_campus submission to camelCase, including toCampusId", () => {
    const input = formValuesToRequestTransferInput({
      transfer_type: "inter_campus",
      from_campus_id: "campus-1",
      to_campus_id: "campus-2",
      reason: "Family relocation",
      effective_date: "2026-11-01",
    });

    expect(input).toEqual({
      transferType: "inter_campus",
      fromCampusId: "campus-1",
      toCampusId: "campus-2",
      reason: "Family relocation",
      effectiveDate: "2026-11-01",
    });
  });

  it("maps an outgoing submission to camelCase, including externalSchoolName", () => {
    const input = formValuesToRequestTransferInput({
      transfer_type: "outgoing",
      from_campus_id: "campus-1",
      external_school_name: "Another School",
      reason: "Relocating",
      effective_date: "2026-11-01",
    });

    expect(input).toEqual({
      transferType: "outgoing",
      fromCampusId: "campus-1",
      externalSchoolName: "Another School",
      reason: "Relocating",
      effectiveDate: "2026-11-01",
    });
  });
});
