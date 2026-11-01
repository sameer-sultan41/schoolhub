"use client";

import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { Page } from "@schoolhub/types";

import { queryKeys } from "@/lib/query-client";
import { MESSAGE_THREADS_QUERY_MODULE } from "@/services/modules/message-threads/message-threads-constant";
import type { MessageRecord } from "@/services/modules/message-threads/message-threads-type";

/**
 * Returns a function that refreshes the inbox after a write (a post, mark-read, close, reopen).
 *
 * The API pages with DRF cursors, which mark a position: a stored cursor read again after a new
 * message arrives starts after the old boundary, so the page before it would lose a message. The
 * conversations are therefore cut back to their first page before the module is marked stale
 * (TanStack Query v5 has no `refetchPage`); older pages load again through "Load earlier".
 */
export function useRefreshThreads() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.setQueriesData<InfiniteData<Page<MessageRecord>, string | undefined>>(
      { queryKey: queryKeys.list(MESSAGE_THREADS_QUERY_MODULE, "messages") },
      (data) => {
        if (!data) return data;
        return {
          pages: data.pages.slice(0, 1),
          pageParams: data.pageParams.slice(0, 1),
        };
      },
    );
    void queryClient.invalidateQueries({
      queryKey: queryKeys.module(MESSAGE_THREADS_QUERY_MODULE),
    });
  };
}
