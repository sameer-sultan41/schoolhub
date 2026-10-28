import { fetchPage, type ApiResult } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { toDecisionBody } from "@/lib/approval-queue";

/**
 * The API calls every approval queue shares (attendance corrections, student leave): one
 * cursor page, and a `:approve` / `:reject` POST. Each domain's service passes its own
 * `endpoints.*` path and note field, and maps the answer.
 */

/** One cursor page of a queue's list; `query` is the domain's already-mapped params. */
export async function fetchApprovalPage<Item>(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
): Promise<Page<Item>> {
  return fetchPage<Item>(apiClient, path, { query });
}

/** Posts a decision with its optional note under `noteField`; answers with the call's result
 * (the record as `data`, and `meta`). */
export function postApprovalDecision<Decided>(
  path: string,
  noteField: string,
  note?: string,
): Promise<ApiResult<Decided>> {
  return apiClient.post<Decided>(path, toDecisionBody(noteField, note));
}
