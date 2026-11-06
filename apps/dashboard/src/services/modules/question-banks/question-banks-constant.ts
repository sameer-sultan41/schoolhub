import { FILTER_ALL } from "@/lib/constants";
import { isUuid } from "@/lib/helpers";
import type {
  QuestionBankInput,
  QuestionBankPageQuery,
  QuestionBankStatus,
  QuestionDifficulty,
  QuestionInput,
  QuestionPageQuery,
  QuestionSource,
  QuestionType,
} from "./question-banks-type";

/** The question-banks module's constants. */

/** The query-key module every bank and question read lives under; any write invalidates it. */
export const QUESTION_BANKS_QUERY_MODULE = "question-banks";
export const QUESTION_BANKS_LIST_RESOURCE = "list";
export const QUESTION_BANKS_DETAIL_RESOURCE = "detail";
export const QUESTIONS_LIST_RESOURCE = "questions";
/** Namespaces the paper job's poll (`useJobPolling`). */
export const PAPER_JOB_MODULE = "question-paper";

/** Every bank status, keyed so the compiler checks the set against the generated enum. */
const BANK_STATUS_SET: Record<QuestionBankStatus, true> = { active: true, archived: true };
export const BANK_STATUSES = Object.keys(BANK_STATUS_SET) as QuestionBankStatus[];
export const DEFAULT_BANK_STATUS: QuestionBankStatus = "active";

const TYPE_SET: Record<QuestionType, true> = {
  mcq: true,
  true_false: true,
  short_answer: true,
  long_answer: true,
  fill_blank: true,
  numerical: true,
};
export const QUESTION_TYPES = Object.keys(TYPE_SET) as QuestionType[];
export const DEFAULT_QUESTION_TYPE: QuestionType = "short_answer";

/** A multiple-choice question prints at least two choices. */
export const MCQ_MIN_OPTIONS = 2;
/** A true/false question's two choices, in print order. */
export const TRUE_FALSE_OPTIONS = ["True", "False"] as const;

const DIFFICULTY_SET: Record<QuestionDifficulty, true> = { easy: true, medium: true, hard: true };
export const QUESTION_DIFFICULTIES = Object.keys(DIFFICULTY_SET) as QuestionDifficulty[];
/** The model's default. */
export const DEFAULT_DIFFICULTY: QuestionDifficulty = "medium";

const SOURCE_SET: Record<QuestionSource, true> = {
  manual: true,
  ai_generated: true,
  imported: true,
};
export const QUESTION_SOURCES = Object.keys(SOURCE_SET) as QuestionSource[];
/** The model's default: a question a person wrote. */
export const DEFAULT_QUESTION_SOURCE: QuestionSource = "manual";
/** The source whose questions wait for a person's approval (§7.2, invariant 5). */
export const AI_GENERATED_SOURCE: QuestionSource = "ai_generated";
/** The model's default marks for a question. */
export const DEFAULT_QUESTION_MARKS = "1.00";

/** The approved filter's values: every question, only approved, only awaiting approval. */
export const APPROVAL_FILTER_APPROVED = "approved";
export const APPROVAL_FILTER_PENDING = "pending";
const APPROVAL_FILTER_VALUES: readonly string[] = [
  FILTER_ALL,
  APPROVAL_FILTER_APPROVED,
  APPROVAL_FILTER_PENDING,
];
export const APPROVAL_FILTERS = [APPROVAL_FILTER_APPROVED, APPROVAL_FILTER_PENDING] as const;

/** The column limits (`examinations.models`, `PaperSectionSerializer`). */
export const BANK_NAME_MAX = 150;
export const TOPIC_MAX = 150;
export const PAPER_TITLE_MAX = 150;
export const SECTION_TITLE_MAX = 120;
export const SECTION_COUNT_MIN = 1;
export const SECTION_COUNT_MAX = 200;

/** A decimal as the API stores marks: digits, with up to two after the point. */
export const MARKS_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

/** Column id -> the `?ordering=` field `/question-banks` accepts. */
export const BANKS_SORT_FIELD: Record<string, string> = { name: "name" };
export const BANKS_SORTABLE_IDS = Object.keys(BANKS_SORT_FIELD);
export const BANKS_DEFAULT_SORTING: { id: string; desc: boolean }[] = [{ id: "name", desc: false }];
export const BANKS_ACTIONS_COLUMN_ID = "actions";

const BANK_STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...BANK_STATUSES];

/** The banks list's URL filters (`useDataGridUrlState`): every subject, every status. */
export const BANKS_URL_FILTERS = {
  subject: { default: "", isValid: (value: string) => value === "" || isUuid(value) },
  status: {
    default: FILTER_ALL,
    isValid: (value: string) => BANK_STATUS_FILTER_VALUES.includes(value),
  },
};

/** Rows per page of a bank's questions: the cursor list has no page-size picker. */
export const QUESTIONS_PAGE_SIZE = 25;
/** Oldest first, the model's own order, so a bank reads in the order it was written. */
export const QUESTIONS_ORDERING = "created_at";
export const QUESTIONS_SORTABLE_IDS: readonly string[] = [];
export const QUESTIONS_DEFAULT_SORTING: { id: string; desc: boolean }[] = [];
export const QUESTIONS_ACTIONS_COLUMN_ID = "actions";

const DIFFICULTY_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...QUESTION_DIFFICULTIES];
const TYPE_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...QUESTION_TYPES];
const SOURCE_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...QUESTION_SOURCES];

/** The question list's URL filters: the blueprint's own axes, plus source and approval. */
export const QUESTIONS_URL_FILTERS = {
  topic: { default: "", isValid: (value: string) => value.length <= TOPIC_MAX },
  difficulty: {
    default: FILTER_ALL,
    isValid: (value: string) => DIFFICULTY_FILTER_VALUES.includes(value),
  },
  type: {
    default: FILTER_ALL,
    isValid: (value: string) => TYPE_FILTER_VALUES.includes(value),
  },
  source: {
    default: FILTER_ALL,
    isValid: (value: string) => SOURCE_FILTER_VALUES.includes(value),
  },
  approved: {
    default: FILTER_ALL,
    isValid: (value: string) => APPROVAL_FILTER_VALUES.includes(value),
  },
};

/** camelCase `QuestionBankInput` key -> the API's body key. */
export const BANK_BODY_FIELDS: ReadonlyArray<readonly [keyof QuestionBankInput, string]> = [
  ["name", "name"],
  ["subjectId", "subject_id"],
  ["classId", "class_id"],
  ["description", "description"],
  ["status", "status"],
];

/** camelCase `QuestionInput` key -> the API's body key. */
export const QUESTION_BODY_FIELDS: ReadonlyArray<readonly [keyof QuestionInput, string]> = [
  ["questionText", "question_text"],
  ["questionType", "question_type"],
  ["difficulty", "difficulty"],
  ["defaultMarks", "default_marks"],
  ["topic", "topic"],
  ["options", "options"],
  ["answerKey", "answer_key"],
];

/** camelCase `QuestionBankPageQuery` key -> the `/question-banks` query param. */
export const BANK_QUERY_FIELDS: ReadonlyArray<readonly [keyof QuestionBankPageQuery, string]> = [
  ["search", "search"],
  ["ordering", "ordering"],
  ["subjectId", "subject_id"],
  ["status", "status"],
];

/** camelCase `QuestionPageQuery` key -> the questions list's query param. */
export const QUESTION_QUERY_FIELDS: ReadonlyArray<readonly [keyof QuestionPageQuery, string]> = [
  ["cursor", "cursor"],
  ["ordering", "ordering"],
  ["search", "search"],
  ["topic", "topic"],
  ["difficulty", "difficulty"],
  ["questionType", "question_type"],
  ["source", "source"],
  ["isApproved", "is_approved"],
];

/** The fields a server error may name on the bank form; any other shows as the form's message. */
export const BANK_ERROR_FIELDS = [
  "name",
  "subject_id",
  "class_id",
  "description",
  "status",
] as const;

/** The fields a server error may name on the question form. */
export const QUESTION_ERROR_FIELDS = [
  "question_text",
  "question_type",
  "difficulty",
  "default_marks",
  "topic",
  "options",
  "answer_key",
] as const;

/** The paper form's one top-level field; a section's own refusal folds into the form message. */
export const PAPER_ERROR_FIELDS = ["title"] as const;

/** The class picker's stand-in for no class: a bank for every level (a `SelectItem` cannot hold
 * `""`). */
export const EVERY_LEVEL_OPTION = "every-level";
