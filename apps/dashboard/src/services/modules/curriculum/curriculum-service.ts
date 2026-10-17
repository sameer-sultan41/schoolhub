import { fetchPage, MAX_PAGE_SIZE } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toCurriculumBody, toCurriculumQueryParams } from "./curriculum-helper";
import type {
  CloneCurriculumRequest,
  CloneCurriculumResult,
  CurriculumInput,
  CurriculumPageQuery,
  CurriculumRecord,
} from "./curriculum-type";

/**
 * The curriculum domain's API calls (`/class-subjects`). Every consumer reaches these
 * through `Services.curriculum.*` (see `@/services`) — never by importing this file
 * directly and never by importing `@schoolhub/api-client` directly.
 */

export async function fetchCurriculumPage(
  query: CurriculumPageQuery,
): Promise<Page<CurriculumRecord>> {
  return fetchPage<CurriculumRecord>(apiClient, endpoints.curriculum.list, {
    query: toCurriculumQueryParams(query),
  });
}

/** Every mapping of one class in one session, for a subject picker — a class studies a
 * handful of subjects, so one `MAX_PAGE_SIZE` page covers it. */
export async function fetchCurriculumForClass(
  academicSessionId: string,
  classId: string,
): Promise<CurriculumRecord[]> {
  const { items } = await fetchPage<CurriculumRecord>(apiClient, endpoints.curriculum.list, {
    query: {
      academic_session_id: academicSessionId,
      class_id: classId,
      page_size: MAX_PAGE_SIZE,
    },
  });
  return items;
}

export async function createCurriculum(input: CurriculumInput): Promise<CurriculumRecord> {
  const { data } = await apiClient.post<CurriculumRecord>(
    endpoints.curriculum.list,
    toCurriculumBody(input),
  );
  return data;
}

export async function updateCurriculum(
  id: string,
  input: Partial<CurriculumInput>,
): Promise<CurriculumRecord> {
  const { data } = await apiClient.patch<CurriculumRecord>(
    endpoints.curriculum.detail(id),
    toCurriculumBody(input),
  );
  return data;
}

export async function deleteCurriculum(id: string): Promise<void> {
  await apiClient.delete(endpoints.curriculum.detail(id));
}

/** Synchronous: answers `{created, skipped}` straight away. Rows the target already has are
 * skipped, so a retry converges; `idempotencyKey` also makes it replay rather than re-run.
 * The caller generates one key per dialog instance and resends it on retry. */
export async function cloneCurriculum(
  sourceSessionId: string,
  targetSessionId: string,
  idempotencyKey: string,
): Promise<CloneCurriculumResult> {
  const body: CloneCurriculumRequest = {
    source_academic_session_id: sourceSessionId,
    target_academic_session_id: targetSessionId,
  };
  const { data } = await apiClient.post<CloneCurriculumResult>(endpoints.curriculum.clone, body, {
    idempotencyKey,
  });
  return data;
}
