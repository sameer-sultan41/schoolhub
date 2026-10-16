"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { HTTP_STATUS_CONFLICT } from "@/lib/constants";
import { queryKeys } from "@/lib/query-client";
import { ApiError } from "@/services";
import {
  PROMOTION_BATCH_RESOURCE,
  PROMOTION_BATCHES_RESOURCE,
  PROMOTION_QUERY_MODULE,
} from "@/services/modules/promotions/promotions-constant";

/** One batch's detail query: the review page reads it, every write to the batch refreshes it. */
export function promotionBatchKey(batchId: string) {
  return queryKeys.detail(PROMOTION_QUERY_MODULE, PROMOTION_BATCH_RESOURCE, batchId);
}

/**
 * What a write to one batch refreshes. Always the batch's own detail, and with a status change
 * the list prefix too; never the bare `["promotions"]`, whose prefix also matches the execute
 * job's `jobWatch` key and would refetch a poll that is running.
 */
export function usePromotionBatchCache(batchId: string) {
  const queryClient = useQueryClient();

  const refreshBatch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: promotionBatchKey(batchId) });
  }, [queryClient, batchId]);

  const refreshBatchAndList = useCallback(() => {
    refreshBatch();
    void queryClient.invalidateQueries({
      queryKey: queryKeys.list(PROMOTION_QUERY_MODULE, PROMOTION_BATCHES_RESOURCE),
    });
  }, [queryClient, refreshBatch]);

  /**
   * Runs a write and, if it loses a race (a `409`: the batch moved on while this screen was
   * open), reloads the batch so the page shows its real status. The refusal still reaches
   * the caller, which shows it.
   */
  const refreshOnConflict = useCallback(
    async <TResult>(run: () => Promise<TResult>): Promise<TResult> => {
      try {
        return await run();
      } catch (error) {
        if (error instanceof ApiError && error.status === HTTP_STATUS_CONFLICT) refreshBatch();
        throw error;
      }
    },
    [refreshBatch],
  );

  return { refreshBatch, refreshBatchAndList, refreshOnConflict };
}
