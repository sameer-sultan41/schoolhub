import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import {
  toBankBody,
  toBankQueryParams,
  toQuestionBody,
  toQuestionQueryParams,
} from "./question-banks-helper";
import type {
  PaperAssemblyAccepted,
  PaperBlueprint,
  QuestionBankInput,
  QuestionBankPageQuery,
  QuestionBankRecord,
  QuestionInput,
  QuestionPageQuery,
  QuestionRecord,
} from "./question-banks-type";

/** The question-bank API calls (`/question-banks`, its questions and colon-actions), reached
 * through `Services.questionBanks.*`. */

/** One page of the banks the caller's record scope reaches (an `assigned` teacher: their
 * subjects'). */
export async function fetchBanksPage(
  query: QuestionBankPageQuery,
): Promise<Page<QuestionBankRecord>> {
  return fetchPage<QuestionBankRecord>(apiClient, endpoints.questionBanks.list, {
    query: toBankQueryParams(query),
  });
}

export async function fetchBank(id: string): Promise<QuestionBankRecord> {
  const { data } = await apiClient.get<QuestionBankRecord>(endpoints.questionBanks.detail(id));
  return data;
}

export async function createBank(input: QuestionBankInput): Promise<QuestionBankRecord> {
  const { data } = await apiClient.post<QuestionBankRecord>(
    endpoints.questionBanks.list,
    toBankBody(input),
  );
  return data;
}

export async function updateBank(
  id: string,
  input: QuestionBankInput,
): Promise<QuestionBankRecord> {
  const { data } = await apiClient.patch<QuestionBankRecord>(
    endpoints.questionBanks.detail(id),
    toBankBody(input),
  );
  return data;
}

export async function deleteBank(id: string): Promise<void> {
  await apiClient.delete(endpoints.questionBanks.detail(id));
}

/** One cursor page of a bank's questions, filtered on the blueprint's axes. */
export async function fetchQuestionsPage(query: QuestionPageQuery): Promise<Page<QuestionRecord>> {
  return fetchPage<QuestionRecord>(apiClient, endpoints.questionBanks.questions(query.bankId), {
    query: toQuestionQueryParams(query),
  });
}

export async function createQuestion(
  bankId: string,
  input: QuestionInput,
): Promise<QuestionRecord> {
  const { data } = await apiClient.post<QuestionRecord>(
    endpoints.questionBanks.questions(bankId),
    toQuestionBody(input),
  );
  return data;
}

export async function updateQuestion(
  bankId: string,
  id: string,
  input: QuestionInput,
): Promise<QuestionRecord> {
  const { data } = await apiClient.patch<QuestionRecord>(
    endpoints.questionBanks.question(bankId, id),
    toQuestionBody(input),
  );
  return data;
}

export async function deleteQuestion(bankId: string, id: string): Promise<void> {
  await apiClient.delete(endpoints.questionBanks.question(bankId, id));
}

/** Puts a person's name to an AI draft, so a paper may use it (§7.2); a manual one is a 409. */
export async function approveQuestion(bankId: string, id: string): Promise<QuestionRecord> {
  const { data } = await apiClient.post<QuestionRecord>(
    endpoints.questionBanks.approveQuestion(bankId, id),
  );
  return data;
}

/** Starts the paper's render: `202` + a job whose `result` is `{result_file_id, questions,
 * total_marks}`. A blueprint the approved questions cannot fill is a 422 naming every short
 * section in `error.meta.sections`, before any job exists. */
export async function assemblePaper(
  bankId: string,
  blueprint: PaperBlueprint,
): Promise<{ jobId: string }> {
  const { data } = await apiClient.post<PaperAssemblyAccepted>(
    endpoints.questionBanks.assemblePaper(bankId),
    blueprint,
  );
  return { jobId: data.job_id };
}
