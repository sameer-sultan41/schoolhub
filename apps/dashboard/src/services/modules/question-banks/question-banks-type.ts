import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). A bank carries its subject's and class's names (a null
 * class covers every level); a question carries who approved it. */
export type QuestionBankRecord = ApiSchemas["QuestionBank"];
export type QuestionBankStatus = ApiSchemas["QuestionBankStatusEnum"];
export type QuestionRecord = ApiSchemas["Question"];
export type QuestionType = ApiSchemas["QuestionTypeEnum"];
export type QuestionDifficulty = ApiSchemas["QuestionDifficultyEnum"];
export type QuestionSource = ApiSchemas["QuestionSourceEnum"];
export type PaperSection = ApiSchemas["PaperSection"];
export type PaperAssemblyAccepted = ApiSchemas["PaperAssemblyAccepted"];

/** One page of the school's banks; the caller's record scope decides which it may see. */
export interface QuestionBankPageQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  ordering?: string;
  subjectId?: string;
  status?: QuestionBankStatus;
}

/** A null `classId` is a bank for every level; a null `description` clears it. */
export interface QuestionBankInput {
  name: string;
  subjectId: string;
  classId: string | null;
  description: string | null;
  status: QuestionBankStatus;
}

/** One cursor page of a bank's questions, on the blueprint's own axes. */
export interface QuestionPageQuery {
  bankId: string;
  cursor?: string;
  pageSize?: number;
  ordering?: string;
  search?: string;
  topic?: string;
  difficulty?: QuestionDifficulty;
  questionType?: QuestionType;
  source?: QuestionSource;
  isApproved?: boolean;
}

/** `options` is the printed choices, in order (null for a type with none); the answer key is the
 * correct choice or a model answer. `source` is not here: a question written here is `manual`,
 * and an AI draft keeps its own. */
export interface QuestionInput {
  questionText: string;
  questionType: QuestionType;
  difficulty: QuestionDifficulty;
  defaultMarks: string;
  topic: string | null;
  options: string[] | null;
  answerKey: string | null;
}

/** `:assemble-paper`'s body: the paper's title and its sections, in print order. */
export interface PaperBlueprint {
  title: string;
  sections: PaperSection[];
}

/** One section the bank's approved questions cannot fill (`error.meta.sections[]`): its place in
 * the blueprint (from 0), and how many it asked for against how many there are. */
export interface PaperShortfall {
  index: number;
  difficulty: QuestionDifficulty;
  topic: string | null;
  requested: number;
  available: number;
}

/** A finished assembly job's `result`: the paper's file, its question count and total marks (a
 * decimal string). */
export interface PaperResult {
  result_file_id: string;
  questions: number;
  total_marks: string;
}
