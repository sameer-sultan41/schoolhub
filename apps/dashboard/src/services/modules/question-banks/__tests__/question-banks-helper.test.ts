import { ApiError } from "@schoolhub/api-client";

import {
  approvalFilterToFlag,
  bankStatusFilter,
  buildBankInput,
  buildPaperBlueprint,
  buildQuestionInput,
  defaultBankFormValues,
  defaultQuestionFormValues,
  difficultyFilter,
  isAwaitingApproval,
  paperFilename,
  recordToBankFormValues,
  recordToQuestionFormValues,
  shortfallsFromError,
  sourceFilter,
  typeFilter,
} from "../question-banks-helper";
import {
  createPaperFormSchema,
  createQuestionFormSchema,
  PAPER_FORM_MESSAGE_KEYS,
  QUESTION_FORM_MESSAGE_KEYS,
} from "../question-banks.schema";
import { aiDraftRecord, bankRecord, questionRecord, SUBJECT_ID } from "./question-banks-fixtures";

const CLASS = "3a7b8c9d-0e1f-4a2b-8c3d-5e6f70819203";

function shortfallError(sections: unknown): ApiError {
  return new ApiError({
    status: 422,
    url: "/question-banks/b1:assemble-paper",
    code: "domain_rule_violation",
    message: "2 section(s) of this blueprint cannot be filled from the bank's approved questions.",
    meta: { sections },
  });
}

describe("question-banks-helper", () => {
  it("reads each filter's URL value, with `all` as no filter", () => {
    expect(bankStatusFilter("all")).toBeUndefined();
    expect(bankStatusFilter("archived")).toBe("archived");
    expect(difficultyFilter("hard")).toBe("hard");
    expect(typeFilter("all")).toBeUndefined();
    expect(typeFilter("mcq")).toBe("mcq");
    expect(sourceFilter("ai_generated")).toBe("ai_generated");
    expect(approvalFilterToFlag("approved")).toBe(true);
    expect(approvalFilterToFlag("pending")).toBe(false);
    expect(approvalFilterToFlag("all")).toBeUndefined();
  });

  it("offers approval only for an AI draft nobody has approved", () => {
    expect(isAwaitingApproval(aiDraftRecord())).toBe(true);
    expect(isAwaitingApproval(aiDraftRecord({ is_approved: true }))).toBe(false);
    expect(isAwaitingApproval(questionRecord({ is_approved: false }))).toBe(false);
  });

  it("maps a bank to its form and back, with no class as every level", () => {
    expect(buildBankInput(defaultBankFormValues())).toEqual({
      name: "",
      subjectId: "",
      classId: null,
      description: null,
      status: "active",
    });
    const values = recordToBankFormValues(bankRecord({ class_id: CLASS, description: "Term 1" }));
    expect(buildBankInput({ ...values, name: "  Algebra  " })).toEqual({
      name: "Algebra",
      subjectId: SUBJECT_ID,
      classId: CLASS,
      description: "Term 1",
      status: "active",
    });
  });

  it("sends each question type its own fields", () => {
    const values = { ...defaultQuestionFormValues(), question_text: " Q ", options: "a\n\n b \n" };
    const mcq = buildQuestionInput({ ...values, question_type: "mcq", answer_key: "b" });
    const trueFalse = buildQuestionInput({ ...values, question_type: "true_false" });
    const essay = buildQuestionInput({ ...values, question_type: "long_answer" });

    expect(mcq).toMatchObject({ questionText: "Q", options: ["a", "b"], answerKey: "b" });
    expect(mcq.topic).toBeNull();
    expect(trueFalse.options).toEqual(["True", "False"]);
    expect(essay).toMatchObject({ options: null, answerKey: null });
  });

  it("reads a stored question back into the form, choices one per line", () => {
    const draft = recordToQuestionFormValues(aiDraftRecord());
    const numeric = recordToQuestionFormValues(questionRecord({ answer_key: 12, topic: null }));

    expect(draft).toMatchObject({ question_type: "mcq", options: "4\n6\n7\n9", answer_key: "7" });
    expect(numeric).toMatchObject({ answer_key: "12", topic: "", options: "" });
  });

  it("refuses a multiple-choice question with fewer than two choices, and marks of zero", () => {
    const schema = createQuestionFormSchema(QUESTION_FORM_MESSAGE_KEYS);
    const base = { ...defaultQuestionFormValues(), question_text: "Q", question_type: "mcq" };
    const accepts = (overrides: Record<string, string>) =>
      schema.safeParse({ ...base, ...overrides }).success;

    expect(accepts({ options: "only" })).toBe(false);
    expect(accepts({ options: "a\nb" })).toBe(true);
    expect(accepts({ question_type: "numerical", default_marks: "0" })).toBe(false);
  });

  it("builds the blueprint, leaving out a blank topic, title or marks", () => {
    expect(
      buildPaperBlueprint({
        title: " Term test ",
        sections: [
          { title: "", topic: " Primes ", difficulty: "easy", count: "3", marks_each: "" },
          { title: "Part B", topic: "", difficulty: "hard", count: "1", marks_each: "5" },
        ],
      }),
    ).toEqual({
      title: "Term test",
      sections: [
        { difficulty: "easy", count: 3, topic: "Primes" },
        { difficulty: "hard", count: 1, title: "Part B", marks_each: "5" },
      ],
    });
  });

  it("refuses a section count outside 1 to 200", () => {
    const schema = createPaperFormSchema(PAPER_FORM_MESSAGE_KEYS);
    const section = { title: "", topic: "", difficulty: "easy", marks_each: "" };
    const accepts = (count: string) =>
      schema.safeParse({ title: "T", sections: [{ ...section, count }] }).success;

    expect(accepts("0")).toBe(false);
    expect(accepts("201")).toBe(false);
    expect(accepts("200")).toBe(true);
  });

  it("reads every short section from a refused blueprint, and nothing from another error", () => {
    const short = { index: 1, difficulty: "hard", topic: null, requested: 8, available: 3 };
    expect(shortfallsFromError(shortfallError([short, { index: "x" }]))).toEqual([short]);
    expect(shortfallsFromError(shortfallError("not a list"))).toEqual([]);
    expect(shortfallsFromError(new Error("network"))).toEqual([]);
    expect(paperFilename(" Term test ")).toBe("Term test.pdf");
  });
});
