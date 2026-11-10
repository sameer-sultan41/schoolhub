import { ApiError } from "@schoolhub/api-client";

import { FILTER_ALL } from "@/lib/constants";
import { copyMappedFields } from "@/lib/helpers";
import {
  AI_GENERATED_SOURCE,
  APPROVAL_FILTER_APPROVED,
  APPROVAL_FILTER_PENDING,
  BANK_BODY_FIELDS,
  BANK_QUERY_FIELDS,
  DEFAULT_BANK_STATUS,
  DEFAULT_DIFFICULTY,
  DEFAULT_QUESTION_MARKS,
  DEFAULT_QUESTION_TYPE,
  QUESTION_BODY_FIELDS,
  QUESTION_QUERY_FIELDS,
  TRUE_FALSE_OPTIONS,
} from "./question-banks-constant";
import type { BankFormValues, PaperFormValues, QuestionFormValues } from "./question-banks.schema";
import type {
  PaperBlueprint,
  PaperShortfall,
  QuestionBankInput,
  QuestionBankPageQuery,
  QuestionBankRecord,
  QuestionBankStatus,
  QuestionDifficulty,
  QuestionInput,
  QuestionPageQuery,
  QuestionRecord,
  QuestionSource,
  QuestionType,
} from "./question-banks-type";

/** The question-banks module's pure helpers: plain data in, plain data out. */

const isSent = (value: unknown) => value !== undefined && value !== "";

export function toBankBody(input: QuestionBankInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, BANK_BODY_FIELDS, () => true, body);
  return body;
}

export function toQuestionBody(input: QuestionInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, QUESTION_BODY_FIELDS, () => true, body);
  return body;
}

export function toBankQueryParams(
  query: QuestionBankPageQuery,
): Record<string, string | number | undefined> {
  const params: Record<string, unknown> = { page: query.page, page_size: query.pageSize };
  copyMappedFields(query, BANK_QUERY_FIELDS, isSent, params);
  return params as Record<string, string | number | undefined>;
}

export function toQuestionQueryParams(
  query: QuestionPageQuery,
): Record<string, string | number | boolean | undefined> {
  const params: Record<string, unknown> = { page_size: query.pageSize };
  copyMappedFields(query, QUESTION_QUERY_FIELDS, isSent, params);
  return params as Record<string, string | number | boolean | undefined>;
}

/** A filter's URL value -> the query's: `all` is no filter. The URL spec has already checked the
 * value is one of the set's (`QUESTIONS_URL_FILTERS`, `BANKS_URL_FILTERS`). */
function isFiltered(value: string): boolean {
  return value !== FILTER_ALL && value !== "";
}

export function bankStatusFilter(value: string): QuestionBankStatus | undefined {
  return isFiltered(value) ? (value as QuestionBankStatus) : undefined;
}

export function difficultyFilter(value: string): QuestionDifficulty | undefined {
  return isFiltered(value) ? (value as QuestionDifficulty) : undefined;
}

export function typeFilter(value: string): QuestionType | undefined {
  return isFiltered(value) ? (value as QuestionType) : undefined;
}

export function sourceFilter(value: string): QuestionSource | undefined {
  return isFiltered(value) ? (value as QuestionSource) : undefined;
}

/** The approved filter -> `is_approved`. */
export function approvalFilterToFlag(value: string): boolean | undefined {
  if (value === APPROVAL_FILTER_APPROVED) return true;
  if (value === APPROVAL_FILTER_PENDING) return false;
  return undefined;
}

/** An AI draft nobody has approved yet: the one question Approve is for (§7.2). */
export function isAwaitingApproval(question: QuestionRecord): boolean {
  return question.source === AI_GENERATED_SOURCE && !question.is_approved;
}

/** Trimmed, with a blank as `null`, which clears a stored value. */
function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function defaultBankFormValues(): BankFormValues {
  return { name: "", subject_id: "", class_id: "", description: "", status: DEFAULT_BANK_STATUS };
}

export function recordToBankFormValues(record: QuestionBankRecord): BankFormValues {
  return {
    name: record.name,
    subject_id: record.subject_id,
    class_id: record.class_id ?? "",
    description: record.description ?? "",
    status: record.status ?? DEFAULT_BANK_STATUS,
  };
}

/** Form values -> the service input; no class is a bank for every level. */
export function buildBankInput(values: BankFormValues): QuestionBankInput {
  return {
    name: values.name.trim(),
    subjectId: values.subject_id,
    classId: values.class_id === "" ? null : values.class_id,
    description: blankToNull(values.description),
    status: values.status,
  };
}

/** A JSON value the API stores (`options`, `answer_key`) as the text a form edits. */
export function jsonToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function defaultQuestionFormValues(): QuestionFormValues {
  return {
    question_text: "",
    question_type: DEFAULT_QUESTION_TYPE,
    difficulty: DEFAULT_DIFFICULTY,
    default_marks: DEFAULT_QUESTION_MARKS,
    topic: "",
    options: "",
    answer_key: "",
  };
}

export function recordToQuestionFormValues(record: QuestionRecord): QuestionFormValues {
  const options = Array.isArray(record.options) ? record.options.map(jsonToText) : [];
  return {
    question_text: record.question_text,
    question_type: record.question_type,
    difficulty: record.difficulty ?? DEFAULT_DIFFICULTY,
    default_marks: record.default_marks ?? DEFAULT_QUESTION_MARKS,
    topic: record.topic ?? "",
    options: options.join("\n"),
    answer_key: jsonToText(record.answer_key),
  };
}

/** The choices the form's options box holds: one per line, blanks dropped. */
export function splitOptions(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** Form values -> the service input. Each type sends its own fields: a multiple-choice question
 * its typed choices, a true/false one the two fixed ones, any other none. */
export function buildQuestionInput(values: QuestionFormValues): QuestionInput {
  let options: string[] | null = null;
  if (values.question_type === "mcq") options = splitOptions(values.options);
  else if (values.question_type === "true_false") options = [...TRUE_FALSE_OPTIONS];
  return {
    questionText: values.question_text.trim(),
    questionType: values.question_type,
    difficulty: values.difficulty,
    defaultMarks: values.default_marks.trim(),
    topic: blankToNull(values.topic),
    options,
    answerKey: blankToNull(values.answer_key),
  };
}

/** Form values -> `:assemble-paper`'s body; a blank topic, title or marks is left out, so the
 * section draws from every topic and each question keeps its own marks. */
export function buildPaperBlueprint(values: PaperFormValues): PaperBlueprint {
  return {
    title: values.title.trim(),
    sections: values.sections.map((section) => {
      const topic = section.topic.trim();
      const title = section.title.trim();
      const marks = section.marks_each.trim();
      return {
        difficulty: section.difficulty,
        count: Number(section.count),
        ...(title === "" ? {} : { title }),
        ...(topic === "" ? {} : { topic }),
        ...(marks === "" ? {} : { marks_each: marks }),
      };
    }),
  };
}

function isShortfall(value: unknown): value is PaperShortfall {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Partial<PaperShortfall>;
  return (
    typeof row.index === "number" &&
    typeof row.requested === "number" &&
    typeof row.available === "number"
  );
}

/** A refused blueprint's short sections, from the error's `meta` (never `details`, which the
 * server flattens), in blueprint order. Empty for any other error. */
export function shortfallsFromError(error: unknown): PaperShortfall[] {
  if (!(error instanceof ApiError)) return [];
  const sections = error.meta.sections;
  return Array.isArray(sections) ? sections.filter(isShortfall) : [];
}

/** The paper's download name: its title, as the job stores it. */
export function paperFilename(title: string): string {
  return `${title.trim()}.pdf`;
}
