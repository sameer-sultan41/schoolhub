import {
  mapPromotionBatchFieldErrors,
  mapPromotionDecisionFieldErrors,
} from "@/features/academics/promotion-map-field-errors";

describe("mapPromotionBatchFieldErrors", () => {
  it("routes a rendered field to the known bucket", () => {
    expect(mapPromotionBatchFieldErrors({ class_id: "No actively enrolled students." })).toEqual({
      known: { class_id: "No actively enrolled students." },
      unknown: [],
    });
  });

  it("routes batch_id and non_field to the unknown bucket", () => {
    expect(
      mapPromotionBatchFieldErrors({ batch_id: "No such promotion batch.", non_field: "Locked." }),
    ).toEqual({ known: {}, unknown: ["No such promotion batch.", "Locked."] });
  });
});

describe("mapPromotionDecisionFieldErrors", () => {
  it("routes the editable decision fields to the known bucket", () => {
    expect(
      mapPromotionDecisionFieldErrors({
        to_class_id: "A graduating student has no target class.",
        override_reason: "Required for an override.",
      }),
    ).toEqual({
      known: {
        to_class_id: "A graduating student has no target class.",
        override_reason: "Required for an override.",
      },
      unknown: [],
    });
  });

  it("routes a read-only field to the unknown bucket", () => {
    expect(mapPromotionDecisionFieldErrors({ status: "This decision is approved." })).toEqual({
      known: {},
      unknown: ["This decision is approved."],
    });
  });

  it("returns empty buckets for an empty envelope", () => {
    expect(mapPromotionDecisionFieldErrors({})).toEqual({ known: {}, unknown: [] });
  });
});
