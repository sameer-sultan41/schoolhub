import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type { JobAccepted } from "@/services/modules/jobs/jobs-service";
import { toDecisionBody, toPromotionQueryParams } from "./promotions-helper";
import type {
  CreatePromotionBatchInput,
  CreatePromotionBatchRequest,
  PromotionBatchCreated,
  PromotionBatchDetail,
  PromotionBatchesQuery,
  PromotionBatchRecord,
  PromotionDecisionRecord,
  PromotionTransition,
  PromotionTransitionResult,
  UpdateDecisionInput,
} from "./promotions-type";

/**
 * The promotions domain's API calls (`/student-promotions`). Every consumer reaches these
 * through `Services.promotions.*` (see `@/services`) — never by importing this file directly
 * and never by importing `@schoolhub/api-client` directly.
 */

/** One page of batches, newest first unless `ordering` says otherwise. */
export async function fetchPromotionBatches(
  query: PromotionBatchesQuery,
): Promise<Page<PromotionBatchRecord>> {
  return fetchPage<PromotionBatchRecord>(apiClient, endpoints.promotions.list, {
    query: toPromotionQueryParams(query),
  });
}

/** One batch with every one of its decisions: the server does not paginate them. */
export async function fetchPromotionBatch(batchId: string): Promise<PromotionBatchDetail> {
  const { data } = await apiClient.get<PromotionBatchDetail>(endpoints.promotions.detail(batchId));
  return data;
}

/** Drafts a batch for one class: one decision row per student, proposed by the server. */
export async function createPromotionBatch(
  input: CreatePromotionBatchInput,
): Promise<PromotionBatchCreated> {
  const body: CreatePromotionBatchRequest = {
    from_academic_session_id: input.fromAcademicSessionId,
    to_academic_session_id: input.toAcademicSessionId,
    class_id: input.classId,
  };
  const { data } = await apiClient.post<PromotionBatchCreated>(endpoints.promotions.list, body);
  return data;
}

/** Edits one student's decision in a draft batch; only the keys given are sent. */
export async function updateDecision(
  batchId: string,
  studentId: string,
  input: UpdateDecisionInput,
): Promise<PromotionDecisionRecord> {
  const { data } = await apiClient.patch<PromotionDecisionRecord>(
    endpoints.promotions.decision(batchId, studentId),
    toDecisionBody(input),
  );
  return data;
}

/**
 * Moves every row of the batch one step: how many moved comes back. Each `action` is also its
 * `endpoints.promotions` key.
 *
 * The server replays an `Idempotency-Key` only on `:execute` (`executeBatch`): none of these four
 * goes through `replay_or_execute`, so a retry after a lost response runs against the state
 * machine again and surfaces a `409`. The caller treats that `409` as "refetch the batch and
 * re-read its status", not as a failure. The key is sent anyway and is harmless, so a later
 * server-side replay needs no client change.
 */
export async function transitionBatch(
  batchId: string,
  action: PromotionTransition,
  idempotencyKey: string,
): Promise<PromotionTransitionResult> {
  const { data } = await apiClient.post<PromotionTransitionResult>(
    endpoints.promotions[action](batchId),
    undefined,
    { idempotencyKey },
  );
  return data;
}

/** Queues the execution as a job (`202`): poll it for the `PromotionExecutionReport`. A retry
 * with the same `idempotencyKey` rejoins the job already queued rather than starting another. */
export async function executeBatch(batchId: string, idempotencyKey: string): Promise<JobAccepted> {
  const { data } = await apiClient.post<JobAccepted>(
    endpoints.promotions.execute(batchId),
    undefined,
    { idempotencyKey },
  );
  return data;
}
