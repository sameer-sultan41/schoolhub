import { collectPages, MAX_PAGE_SIZE } from "@schoolhub/api-client";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toExamSubjectBody } from "./exam-subjects-helper";
import type { ExamSubjectInput, ExamSubjectRecord } from "./exam-subjects-type";

/** The exam-subjects API calls (`/exam-subjects`), reached through `Services.examSubjects.*`. */

/** Every subject of one exam: the endpoint is cursor-paginated, so this follows the cursor. */
export async function fetchExamSubjects(examId: string): Promise<ExamSubjectRecord[]> {
  return collectPages<ExamSubjectRecord>(apiClient, endpoints.examSubjects.list, {
    query: { exam_id: examId, page_size: MAX_PAGE_SIZE },
  });
}

export async function createExamSubject(input: ExamSubjectInput): Promise<ExamSubjectRecord> {
  const { data } = await apiClient.post<ExamSubjectRecord>(
    endpoints.examSubjects.list,
    toExamSubjectBody(input),
  );
  return data;
}

export async function updateExamSubject(
  id: string,
  input: ExamSubjectInput,
): Promise<ExamSubjectRecord> {
  const { data } = await apiClient.patch<ExamSubjectRecord>(
    endpoints.examSubjects.detail(id),
    toExamSubjectBody(input),
  );
  return data;
}

export async function deleteExamSubject(id: string): Promise<void> {
  await apiClient.delete(endpoints.examSubjects.detail(id));
}
