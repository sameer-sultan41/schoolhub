import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toExamBody, toExamQueryParams } from "./exams-helper";
import type { ExamInput, ExamPageQuery, ExamRecord } from "./exams-type";

/** The exams API calls (`/exams`), reached through `Services.exams.*`. */

export async function fetchExamsPage(query: ExamPageQuery): Promise<Page<ExamRecord>> {
  return fetchPage<ExamRecord>(apiClient, endpoints.exams.list, {
    query: toExamQueryParams(query),
  });
}

export async function fetchExam(id: string): Promise<ExamRecord> {
  const { data } = await apiClient.get<ExamRecord>(endpoints.exams.detail(id));
  return data;
}

export async function createExam(input: ExamInput): Promise<ExamRecord> {
  const { data } = await apiClient.post<ExamRecord>(endpoints.exams.list, toExamBody(input));
  return data;
}

export async function updateExam(id: string, input: ExamInput): Promise<ExamRecord> {
  const { data } = await apiClient.patch<ExamRecord>(endpoints.exams.detail(id), toExamBody(input));
  return data;
}

export async function deleteExam(id: string): Promise<void> {
  await apiClient.delete(endpoints.exams.detail(id));
}
