import { z } from "zod";

import { Regex } from "@/lib/regex";
import {
  BANK_NAME_MAX,
  BANK_STATUSES,
  MARKS_PATTERN,
  MCQ_MIN_OPTIONS,
  PAPER_TITLE_MAX,
  QUESTION_DIFFICULTIES,
  QUESTION_TYPES,
  SECTION_COUNT_MAX,
  SECTION_TITLE_MAX,
  TOPIC_MAX,
} from "./question-banks-constant";
import type { QuestionBankStatus, QuestionDifficulty, QuestionType } from "./question-banks-type";

/** The bank, question and paper forms' schemas, with the API's own field names. */

const bankStatusEnum = z.enum(BANK_STATUSES as [QuestionBankStatus, ...QuestionBankStatus[]]);
const typeEnum = z.enum(QUESTION_TYPES as [QuestionType, ...QuestionType[]]);
const difficultyEnum = z.enum(
  QUESTION_DIFFICULTIES as [QuestionDifficulty, ...QuestionDifficulty[]],
);

export type BankFormMessages = Record<"required", string>;
export const BANK_FORM_MESSAGE_KEYS: BankFormMessages = { required: "required" };

/** `class_id` is `""` for a bank that covers every level. */
export function createBankFormSchema(messages: BankFormMessages) {
  return z.object({
    name: z.string().trim().min(1, messages.required).max(BANK_NAME_MAX),
    subject_id: z.string().min(1, messages.required),
    class_id: z.string(),
    description: z.string(),
    status: bankStatusEnum,
  });
}

export const bankFormSchema = createBankFormSchema(BANK_FORM_MESSAGE_KEYS);
export type BankFormValues = z.infer<typeof bankFormSchema>;

export type QuestionFormMessages = Record<"required" | "marksInvalid" | "optionsNeeded", string>;
export const QUESTION_FORM_MESSAGE_KEYS: QuestionFormMessages = {
  required: "required",
  marksInvalid: "marksInvalid",
  optionsNeeded: "optionsNeeded",
};

/** `options` is the choices one per line, read only for a multiple-choice question; the server
 * holds the same rule (`QuestionSerializer.validate`) and its sentence lands under `options`. */
export function createQuestionFormSchema(messages: QuestionFormMessages) {
  return z
    .object({
      question_text: z.string().trim().min(1, messages.required),
      question_type: typeEnum,
      difficulty: difficultyEnum,
      default_marks: z
        .string()
        .trim()
        .refine((value) => MARKS_PATTERN.test(value) && Number(value) > 0, messages.marksInvalid),
      topic: z.string().max(TOPIC_MAX),
      options: z.string(),
      answer_key: z.string(),
    })
    .superRefine((values, context) => {
      if (values.question_type !== "mcq") return;
      const choices = values.options.split("\n").filter((line) => line.trim() !== "");
      if (choices.length < MCQ_MIN_OPTIONS) {
        context.addIssue({ code: "custom", path: ["options"], message: messages.optionsNeeded });
      }
    });
}

export const questionFormSchema = createQuestionFormSchema(QUESTION_FORM_MESSAGE_KEYS);
export type QuestionFormValues = z.infer<typeof questionFormSchema>;

export type PaperFormMessages = Record<"required" | "countInvalid" | "marksInvalid", string>;
export const PAPER_FORM_MESSAGE_KEYS: PaperFormMessages = {
  required: "required",
  countInvalid: "countInvalid",
  marksInvalid: "marksInvalid",
};

/** One section of the blueprint: the count and marks are strings, so a cleared input is blank
 * rather than NaN. A blank topic draws from every topic at that difficulty; blank marks keep each
 * question's own. */
export function createPaperFormSchema(messages: PaperFormMessages) {
  const section = z.object({
    title: z.string().max(SECTION_TITLE_MAX),
    topic: z.string().max(TOPIC_MAX),
    difficulty: difficultyEnum,
    count: z
      .string()
      .trim()
      .refine(
        (value) => Regex.POSITIVE_INTEGER.test(value) && Number(value) <= SECTION_COUNT_MAX,
        messages.countInvalid,
      ),
    marks_each: z
      .string()
      .trim()
      .refine(
        (value) => value === "" || (MARKS_PATTERN.test(value) && Number(value) > 0),
        messages.marksInvalid,
      ),
  });
  return z.object({
    title: z.string().trim().min(1, messages.required).max(PAPER_TITLE_MAX),
    sections: z.array(section).min(1),
  });
}

export const paperFormSchema = createPaperFormSchema(PAPER_FORM_MESSAGE_KEYS);
export type PaperFormValues = z.infer<typeof paperFormSchema>;
