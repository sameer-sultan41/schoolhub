import { CLASS_ID, PLANNED_SESSION_ID, SESSION_ID } from "@/test-fixtures/academics";

import {
  OVERRIDE_REASON_MAX,
  PROMOTION_CREATE_FIELDS,
  PROMOTION_DECISION,
  PROMOTION_DECISION_FIELDS,
  PROMOTION_DECISIONS,
  REMARKS_MAX,
} from "../promotions-constant";
import {
  createPromotionBatchFormSchema,
  createPromotionDecisionFormSchema,
  type PromotionBatchFormValues,
  type PromotionDecisionFormValues,
} from "../promotions.schema";
import { NEXT_CLASS_ID, NEXT_SECTION_ID } from "./promotions-fixtures";

const REQUIRED = "Pick one.";

const VALID: PromotionBatchFormValues = {
  from_academic_session_id: SESSION_ID,
  to_academic_session_id: PLANNED_SESSION_ID,
  class_id: CLASS_ID,
};

/** The message of the first issue the schema finds on each field of `values`. */
function issuesOf(values: unknown): Record<string, string> {
  const result = createPromotionBatchFormSchema(REQUIRED).safeParse(values);
  if (result.success) return {};
  const issues: Record<string, string> = {};
  for (const issue of result.error.issues) {
    issues[issue.path.join(".")] ??= issue.message;
  }
  return issues;
}

describe("createPromotionBatchFormSchema", () => {
  it("accepts two sessions and a class", () => {
    expect(issuesOf(VALID)).toEqual({});
  });

  it.each(PROMOTION_CREATE_FIELDS)("asks for %s, and says so with the given message", (field) => {
    expect(issuesOf({ ...VALID, [field]: "" })).toEqual({ [field]: REQUIRED });
  });

  it("refuses an id that is not a UUID", () => {
    expect(issuesOf({ ...VALID, class_id: "grade-1" })).toEqual({ class_id: REQUIRED });
  });
});

describe("PROMOTION_CREATE_FIELDS", () => {
  it("names exactly the form's own fields", () => {
    expect([...PROMOTION_CREATE_FIELDS].sort()).toEqual(Object.keys(VALID).sort());
  });
});

const DECISION_MESSAGES = {
  required: "Pick a class.",
  overrideReasonTooLong: "Reason too long.",
  remarksTooLong: "Remarks too long.",
};

const PROMOTING: PromotionDecisionFormValues = {
  decision: "promoted",
  to_class_id: NEXT_CLASS_ID,
  to_section_id: NEXT_SECTION_ID,
  override_reason: "",
  remarks: "",
};

/** The message of the first issue the decision schema finds on each field of `values`. */
function decisionIssuesOf(values: unknown): Record<string, string> {
  const result = createPromotionDecisionFormSchema(DECISION_MESSAGES).safeParse(values);
  if (result.success) return {};
  const issues: Record<string, string> = {};
  for (const issue of result.error.issues) {
    issues[issue.path.join(".")] ??= issue.message;
  }
  return issues;
}

/** Every decision but graduating, which is the one that needs no class. */
const MOVING_ON = PROMOTION_DECISIONS.filter((value) => value !== PROMOTION_DECISION.graduated);

describe("createPromotionDecisionFormSchema", () => {
  it("accepts a promotion with a class, with or without a section and notes", () => {
    expect(decisionIssuesOf(PROMOTING)).toEqual({});
    expect(decisionIssuesOf({ ...PROMOTING, to_section_id: "" })).toEqual({});
    expect(decisionIssuesOf({ ...PROMOTING, remarks: "Late." })).toEqual({});
  });

  it("accepts a graduate with no class or section", () => {
    const graduate = { ...PROMOTING, decision: "graduated", to_class_id: "", to_section_id: "" };

    expect(decisionIssuesOf(graduate)).toEqual({});
  });

  it.each(MOVING_ON)("asks for a class for a %s student, under the class", (decision) => {
    const issues = decisionIssuesOf({ ...PROMOTING, decision, to_class_id: "" });

    expect(issues).toEqual({ to_class_id: DECISION_MESSAGES.required });
  });

  it("refuses a decision the API does not know", () => {
    const issues = decisionIssuesOf({ ...PROMOTING, decision: "expelled" });

    expect(Object.keys(issues)).toEqual(["decision"]);
  });

  it("bounds the override reason, and says so under it", () => {
    const atTheLimit = { ...PROMOTING, override_reason: "x".repeat(OVERRIDE_REASON_MAX) };
    const over = { ...PROMOTING, override_reason: "x".repeat(OVERRIDE_REASON_MAX + 1) };

    const message = DECISION_MESSAGES.overrideReasonTooLong;

    expect(decisionIssuesOf(atTheLimit)).toEqual({});
    expect(decisionIssuesOf(over)).toEqual({ override_reason: message });
  });

  it("bounds the remarks, and says so under them", () => {
    const atTheLimit = { ...PROMOTING, remarks: "x".repeat(REMARKS_MAX) };
    const over = { ...PROMOTING, remarks: "x".repeat(REMARKS_MAX + 1) };

    expect(decisionIssuesOf(atTheLimit)).toEqual({});
    expect(decisionIssuesOf(over)).toEqual({ remarks: DECISION_MESSAGES.remarksTooLong });
  });
});

describe("PROMOTION_DECISION_FIELDS", () => {
  it("names exactly the decision form's own fields", () => {
    expect([...PROMOTION_DECISION_FIELDS].sort()).toEqual(Object.keys(PROMOTING).sort());
  });
});
