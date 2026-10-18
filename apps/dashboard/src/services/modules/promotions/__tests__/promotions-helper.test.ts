import { toOrdering } from "@/lib/helpers";
import { CLASS_ID, PLANNED_SESSION_ID, SESSION_ID } from "@/test-fixtures/academics";
import {
  PROMOTION_ACTION,
  PROMOTION_ACTION_PERMISSION,
  PROMOTION_DECISION,
  PROMOTION_DECISIONS,
  PROMOTION_DEFAULT_SORTING,
  PROMOTION_DESTRUCTIVE_ACTIONS,
  PROMOTION_SECTION_ADVISORY_STATUSES,
  PROMOTION_SORT_FIELD,
  PROMOTION_STATUS,
  PROMOTION_STATUS_ACTIONS,
  PROMOTION_STATUSES,
  PROMOTION_URL_FILTERS,
} from "../promotions-constant";
import {
  buildDecisionUpdate,
  countMissingSections,
  decisionToFormValues,
  deviatesFromProposal,
  filterDecisionsBySearch,
  hasDecisionChanges,
  lacksTargetSection,
  promotionBatchRowId,
  readPromotionProposal,
  targetsAfterDecisionChange,
  toCreateBatchInput,
  toDecisionBody,
  toPromotionExecutionReport,
  toPromotionQueryParams,
} from "../promotions-helper";
import type { PromotionDecisionFormValues } from "../promotions.schema";
import {
  FAR_CLASS_ID,
  NEXT_CLASS_ID,
  NEXT_SECTION_ID,
  OTHER_SECTION_ID,
  promotionBatch,
  promotionDecision,
  studentUuid,
} from "./promotions-fixtures";

const UUID = "7b1f2d6e-3c4a-4d58-9e0b-1a2b3c4d5e6f";

describe("toPromotionQueryParams", () => {
  it("maps every key to its snake_case query param", () => {
    expect(
      toPromotionQueryParams({
        page: 3,
        pageSize: 50,
        ordering: "started_at",
        status: "draft",
        fromAcademicSessionId: "sess-1",
        fromClassId: "class-1",
      }),
    ).toEqual({
      page: 3,
      page_size: 50,
      ordering: "started_at",
      status: "draft",
      from_academic_session_id: "sess-1",
      from_class_id: "class-1",
    });
  });

  it("returns no params for an empty query", () => {
    expect(toPromotionQueryParams({})).toEqual({});
  });

  it("drops empty-string filters, so a cleared URL filter is never sent", () => {
    const params = toPromotionQueryParams({
      status: "",
      fromAcademicSessionId: "",
      fromClassId: "",
    });

    expect(params).toEqual({});
  });
});

describe("promotionBatchRowId", () => {
  it("tells the two status rows of one partly executed batch apart", () => {
    const executed = promotionBatchRowId(promotionBatch({ status: "executed" }));
    const approved = promotionBatchRowId(promotionBatch({ status: "approved" }));

    expect(executed).not.toBe(approved);
    expect(promotionBatchRowId(promotionBatch({ status: "executed" }))).toBe(executed);
  });
});

describe("toCreateBatchInput", () => {
  it("maps the snake_case form onto the service's camelCase input", () => {
    const values = {
      from_academic_session_id: SESSION_ID,
      to_academic_session_id: PLANNED_SESSION_ID,
      class_id: CLASS_ID,
    };

    expect(toCreateBatchInput(values)).toEqual({
      fromAcademicSessionId: SESSION_ID,
      toAcademicSessionId: PLANNED_SESSION_ID,
      classId: CLASS_ID,
    });
  });
});

describe("toDecisionBody", () => {
  it("maps every key to its snake_case body key", () => {
    expect(
      toDecisionBody({
        decision: "promoted_on_trial",
        toClassId: "class-2",
        toSectionId: "sec-1",
        overrideReason: "Strong finish to the year.",
        remarks: "On trial for one term.",
      }),
    ).toEqual({
      decision: "promoted_on_trial",
      to_class_id: "class-2",
      to_section_id: "sec-1",
      override_reason: "Strong finish to the year.",
      remarks: "On trial for one term.",
    });
  });

  it("sends an empty body for an empty input", () => {
    expect(toDecisionBody({})).toEqual({});
  });

  it("keeps nulls, which clear a stored value", () => {
    expect(toDecisionBody({ toSectionId: null, remarks: null })).toEqual({
      to_section_id: null,
      remarks: null,
    });
  });
});

const REPORT = {
  enrolled: [{ student_id: "s1" }, { student_id: "s2" }],
  graduated: [{ student_id: "s3" }],
  skipped: [{ student_id: "s4", reason: "already executed" }],
  failed: [{ student_id: "s5", error: "Enroll a guardian first." }],
};

describe("toPromotionExecutionReport", () => {
  it("returns the report from a well-formed job result", () => {
    expect(toPromotionExecutionReport(REPORT)).toEqual(REPORT);
  });

  it("accepts four empty lists", () => {
    const empty = { enrolled: [], graduated: [], skipped: [], failed: [] };

    expect(toPromotionExecutionReport(empty)).toEqual(empty);
  });

  it("returns null for a job with no result", () => {
    expect(toPromotionExecutionReport(null)).toBeNull();
  });

  it.each<[string, Record<string, unknown>]>([
    ["an empty result", {}],
    ["a missing list", { ...REPORT, failed: undefined }],
    ["a list that is not an array", { ...REPORT, enrolled: "s1" }],
    ["a null list", { ...REPORT, graduated: null }],
    ["an enrolled entry with no student_id", { ...REPORT, enrolled: [{}] }],
    ["a student_id that is not text", { ...REPORT, graduated: [{ student_id: 7 }] }],
    ["a null entry", { ...REPORT, enrolled: [null] }],
    ["a skipped entry with no reason", { ...REPORT, skipped: [{ student_id: "s4" }] }],
    ["a failed entry with no error", { ...REPORT, failed: [{ student_id: "s5" }] }],
    [
      "a failed entry whose error is not text",
      { ...REPORT, failed: [{ student_id: "s5", error: ["x"] }] },
    ],
  ])("returns null for %s", (_name, result) => {
    expect(toPromotionExecutionReport(result)).toBeNull();
  });
});

describe("promotions sorting", () => {
  it("sends no ordering by default, so the server's newest-first order applies", () => {
    expect(toOrdering(PROMOTION_DEFAULT_SORTING, PROMOTION_SORT_FIELD)).toBeUndefined();
  });

  it("maps a column id to the field the endpoint orders by, with a - for descending", () => {
    expect(toOrdering([{ id: "startedAt", desc: true }], PROMOTION_SORT_FIELD)).toBe("-started_at");
    expect(toOrdering([{ id: "students", desc: false }], PROMOTION_SORT_FIELD)).toBe("students");
    expect(toOrdering([{ id: "status", desc: false }], PROMOTION_SORT_FIELD)).toBe("status");
  });
});

describe("promotions enums", () => {
  it("names every status once, listing them in lifecycle order", () => {
    expect(PROMOTION_STATUSES).toEqual([
      PROMOTION_STATUS.draft,
      PROMOTION_STATUS.pending_approval,
      PROMOTION_STATUS.approved,
      PROMOTION_STATUS.executed,
      PROMOTION_STATUS.reverted,
    ]);
  });

  it("names every decision once, listing them in the API's order", () => {
    expect(PROMOTION_DECISIONS).toEqual([
      PROMOTION_DECISION.promoted,
      PROMOTION_DECISION.retained,
      PROMOTION_DECISION.promoted_on_trial,
      PROMOTION_DECISION.graduated,
    ]);
  });
});

describe("PROMOTION_URL_FILTERS", () => {
  it("takes every status and nothing else, defaulting to no filter", () => {
    const { status } = PROMOTION_URL_FILTERS;

    expect(status.default).toBe("");
    expect(Object.values(PROMOTION_STATUS).every((value) => status.isValid(value))).toBe(true);
    expect(status.isValid("")).toBe(false);
    expect(status.isValid("all")).toBe(false);
    expect(status.isValid("done")).toBe(false);
  });

  it.each([
    ["session", PROMOTION_URL_FILTERS.session],
    ["class", PROMOTION_URL_FILTERS.class],
  ])("takes only a UUID for the %s, defaulting to no filter", (_name, filter) => {
    expect(filter.default).toBe("");
    expect(filter.isValid(UUID)).toBe(true);
    expect(filter.isValid("not-a-uuid")).toBe(false);
    expect(filter.isValid("")).toBe(false);
  });
});

describe("PROMOTION_STATUS_ACTIONS", () => {
  it("offers no action twice, and every action under a permission key", () => {
    for (const actions of Object.values(PROMOTION_STATUS_ACTIONS)) {
      expect(new Set(actions).size).toBe(actions.length);
      for (const action of actions) {
        expect(PROMOTION_ACTION_PERMISSION[action]).toMatch(/^academics\.promotion\./);
      }
    }
  });

  it("lets reject share approve's key, so one approver does both", () => {
    expect(PROMOTION_ACTION_PERMISSION.reject).toBe(PROMOTION_ACTION_PERMISSION.approve);
    expect(PROMOTION_ACTION_PERMISSION.execute).not.toBe(PROMOTION_ACTION_PERMISSION.approve);
  });

  it("marks the actions that refuse or undo work as the destructive ones", () => {
    const destructive = [PROMOTION_ACTION.reject, PROMOTION_ACTION.revert];

    expect(PROMOTION_DESTRUCTIVE_ACTIONS).toEqual(destructive);
  });

  it("advises about sections only for a draft or approved batch", () => {
    expect(PROMOTION_SECTION_ADVISORY_STATUSES).toEqual([
      PROMOTION_STATUS.draft,
      PROMOTION_STATUS.approved,
    ]);
  });
});

/** Ayesha's decision as the editor opens it: promoted to Grade 2, section A, no notes. */
const OPENED: PromotionDecisionFormValues = {
  decision: "promoted",
  to_class_id: NEXT_CLASS_ID,
  to_section_id: NEXT_SECTION_ID,
  override_reason: "",
  remarks: "",
};

describe("decisionToFormValues", () => {
  it("reads a row into the form", () => {
    expect(decisionToFormValues(promotionDecision())).toEqual(OPENED);
  });

  it("reads a target or a note that is not set as an empty string", () => {
    const graduate = promotionDecision({
      decision: "graduated",
      to_class_id: null,
      to_section_id: undefined,
      override_reason: undefined,
      remarks: null,
    });

    expect(decisionToFormValues(graduate)).toEqual({
      decision: "graduated",
      to_class_id: "",
      to_section_id: "",
      override_reason: "",
      remarks: "",
    });
  });

  it("carries the notes the row has", () => {
    const noted = promotionDecision({ override_reason: "Moved up.", remarks: "Parents agreed." });

    expect(decisionToFormValues(noted)).toMatchObject({
      override_reason: "Moved up.",
      remarks: "Parents agreed.",
    });
  });
});

describe("buildDecisionUpdate", () => {
  it("is empty when nothing differs from what the editor opened with", () => {
    expect(buildDecisionUpdate(OPENED, OPENED)).toEqual({});
  });

  it("carries only the field that changed", () => {
    expect(buildDecisionUpdate({ ...OPENED, decision: "promoted_on_trial" }, OPENED)).toEqual({
      decision: "promoted_on_trial",
    });
    expect(buildDecisionUpdate({ ...OPENED, to_class_id: FAR_CLASS_ID }, OPENED)).toEqual({
      toClassId: FAR_CLASS_ID,
    });
    expect(buildDecisionUpdate({ ...OPENED, to_section_id: OTHER_SECTION_ID }, OPENED)).toEqual({
      toSectionId: OTHER_SECTION_ID,
    });
  });

  it("sends a graduate's emptied class and section as null, which clears them", () => {
    const graduating = {
      ...OPENED,
      decision: PROMOTION_DECISION.graduated,
      to_class_id: "",
      to_section_id: "",
    };

    expect(buildDecisionUpdate(graduating, OPENED)).toEqual({
      decision: "graduated",
      toClassId: null,
      toSectionId: null,
    });
  });

  it("sends an emptied note as null, and a changed one trimmed", () => {
    const noted = { ...OPENED, override_reason: "Moved up.", remarks: "Parents agreed." };

    expect(buildDecisionUpdate({ ...noted, remarks: "" }, noted)).toEqual({ remarks: null });
    expect(buildDecisionUpdate({ ...OPENED, remarks: "  Late  " }, OPENED)).toEqual({
      remarks: "Late",
    });
  });

  it("does not count a stray space as an edit", () => {
    expect(buildDecisionUpdate({ ...OPENED, override_reason: "   " }, OPENED)).toEqual({});
  });
});

describe("hasDecisionChanges", () => {
  it("is false for nothing, and true for any key, a null clearing a field included", () => {
    expect(hasDecisionChanges({})).toBe(false);
    expect(hasDecisionChanges({ toClassId: null })).toBe(true);
    expect(hasDecisionChanges({ remarks: "Late" })).toBe(true);
  });
});

describe("targetsAfterDecisionChange", () => {
  const KEPT = [PROMOTION_DECISION.promoted, PROMOTION_DECISION.promoted_on_trial] as const;
  const promotedTo = { to_class_id: NEXT_CLASS_ID, to_section_id: NEXT_SECTION_ID };

  it("empties both targets for a graduate", () => {
    expect(targetsAfterDecisionChange("graduated", promotedTo, CLASS_ID)).toEqual({
      to_class_id: "",
      to_section_id: "",
    });
  });

  it("puts a retained student in the class they are in, and drops the section of another", () => {
    expect(targetsAfterDecisionChange("retained", promotedTo, CLASS_ID)).toEqual({
      to_class_id: CLASS_ID,
      to_section_id: "",
    });
  });

  it("keeps a retained student's section when it is already their own class's", () => {
    const own = { to_class_id: CLASS_ID, to_section_id: OTHER_SECTION_ID };

    expect(targetsAfterDecisionChange("retained", own, CLASS_ID)).toEqual(own);
  });

  it.each(KEPT)("leaves a %s student's targets alone", (decision) => {
    expect(targetsAfterDecisionChange(decision, promotedTo, CLASS_ID)).toEqual(promotedTo);
  });

  it("takes a retained student's class off them when they are promoted instead", () => {
    const retainedIn = { to_class_id: CLASS_ID, to_section_id: OTHER_SECTION_ID };

    expect(targetsAfterDecisionChange("promoted", retainedIn, CLASS_ID)).toEqual({
      to_class_id: "",
      to_section_id: "",
    });
  });
});

describe("readPromotionProposal", () => {
  const unknownDecision = { proposed_decision: "expelled", proposed_to_class_id: null };
  const classNotAnId = { proposed_decision: "promoted", proposed_to_class_id: 2 };

  it("reads the decision and class the server proposed", () => {
    const basis = { proposed_decision: "promoted", proposed_to_class_id: NEXT_CLASS_ID };
    const proposal = { decision: "promoted", toClassId: NEXT_CLASS_ID };

    expect(readPromotionProposal(basis)).toEqual(proposal);
  });

  it("reads a graduating proposal, whose class is null", () => {
    const basis = { proposed_decision: "graduated", proposed_to_class_id: null };

    expect(readPromotionProposal(basis)).toEqual({ decision: "graduated", toClassId: null });
  });

  it.each([
    ["no basis", null],
    ["a basis that is not an object", "level+1"],
    ["a row from before proposals were recorded", { rule: "level+1" }],
    ["a decision with no class key", { proposed_decision: "promoted" }],
    ["a class with no decision", { proposed_to_class_id: NEXT_CLASS_ID }],
    ["a decision the API does not know", unknownDecision],
    ["a class that is not an id", classNotAnId],
  ])("claims no proposal for %s", (_name, basis) => {
    expect(readPromotionProposal(basis)).toBeNull();
  });
});

describe("deviatesFromProposal", () => {
  const proposal = { decision: PROMOTION_DECISION.promoted, toClassId: NEXT_CLASS_ID };
  const asProposed = { decision: PROMOTION_DECISION.promoted, to_class_id: NEXT_CLASS_ID };

  it("is false for the proposal as made", () => {
    expect(deviatesFromProposal(proposal, asProposed)).toBe(false);
  });

  it("is true for another decision, or another class", () => {
    expect(deviatesFromProposal(proposal, { ...asProposed, decision: "retained" })).toBe(true);
    expect(deviatesFromProposal(proposal, { ...asProposed, to_class_id: FAR_CLASS_ID })).toBe(true);
    expect(deviatesFromProposal(proposal, { ...asProposed, to_class_id: "" })).toBe(true);
  });

  it("reads an empty class as the null a graduating proposal has", () => {
    const graduating = { decision: PROMOTION_DECISION.graduated, toClassId: null };
    const emptied = { decision: PROMOTION_DECISION.graduated, to_class_id: "" };

    expect(deviatesFromProposal(graduating, emptied)).toBe(false);
    expect(deviatesFromProposal(graduating, asProposed)).toBe(true);
  });

  it.each([PROMOTION_DECISION.retained, PROMOTION_DECISION.promoted_on_trial])(
    "claims a deviation for %s on a row with no recorded proposal, as the server does",
    (decision) => {
      expect(deviatesFromProposal(null, { decision, to_class_id: FAR_CLASS_ID })).toBe(true);
    },
  );

  it.each([PROMOTION_DECISION.promoted, PROMOTION_DECISION.graduated])(
    "claims nothing for %s on a row with no recorded proposal: that needs today's ladder",
    (decision) => {
      expect(deviatesFromProposal(null, { decision, to_class_id: FAR_CLASS_ID })).toBe(false);
    },
  );
});

describe("lacksTargetSection and countMissingSections", () => {
  const withSection = promotionDecision();
  const promotedWithout = promotionDecision({ to_section_id: null, to_section_name: null });
  const retainedWithout = promotionDecision({
    decision: "retained",
    to_section_id: null,
    to_section_name: null,
  });
  const graduate = promotionDecision({
    decision: "graduated",
    to_class_id: null,
    to_class_name: null,
    to_section_id: null,
    to_section_name: null,
  });

  it("flags a student who moves on to a class with no section", () => {
    expect(lacksTargetSection(promotedWithout)).toBe(true);
    expect(lacksTargetSection(retainedWithout)).toBe(true);
  });

  it("does not flag one with a section, or a graduate, who needs none", () => {
    expect(lacksTargetSection(withSection)).toBe(false);
    expect(lacksTargetSection(graduate)).toBe(false);
  });

  it("counts only the flagged", () => {
    const rows = [withSection, promotedWithout, retainedWithout, graduate];

    expect(countMissingSections(rows)).toBe(2);
    expect(countMissingSections([withSection, graduate])).toBe(0);
    expect(countMissingSections([])).toBe(0);
  });
});

describe("filterDecisionsBySearch", () => {
  const ayesha = promotionDecision({ student_name: "Ayesha Khan", admission_number: "ADM-0001" });
  const bilal = promotionDecision({
    student_id: studentUuid(2),
    student_name: "Bilal Ahmed",
    admission_number: "ADM-0002",
  });
  const rows = [ayesha, bilal];

  it("matches part of a name, ignoring case and surrounding space", () => {
    expect(filterDecisionsBySearch(rows, "  KHAN ")).toEqual([ayesha]);
  });

  it("matches an admission number", () => {
    expect(filterDecisionsBySearch(rows, "adm-0002")).toEqual([bilal]);
  });

  it("matches nobody for text that is in no name or number", () => {
    expect(filterDecisionsBySearch(rows, "zzz")).toEqual([]);
  });

  it("is every row for a blank search, as a new array", () => {
    const all = filterDecisionsBySearch(rows, "   ");

    expect(all).toEqual(rows);
    expect(all).not.toBe(rows);
  });
});
