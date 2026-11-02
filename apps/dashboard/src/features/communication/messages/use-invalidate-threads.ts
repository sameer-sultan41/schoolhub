"use client";

import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { MESSAGE_THREADS_QUERY_MODULE } from "@/services/modules/message-threads/message-threads-constant";
import { THREAD_OVERSIGHT_QUERY_MODULE } from "@/services/modules/thread-oversight/thread-oversight-constant";

/**
 * Returns a function that marks the inbox and oversight reads stale after a thread write (a new
 * thread, a post, mark-read, close, reopen), or after a 409 that says the thread changed.
 *
 * Invalidating is enough for the cursor-paged conversations: TanStack Query v5 refetches as many
 * pages as were loaded, the first from its own param and each later one from the cursor the fresh
 * page before it returns (`getNextPageParam`), so no stored cursor is replayed and no message the
 * user loaded is dropped.
 */
export function useInvalidateThreads() {
  const invalidateInbox = useInvalidateModule(MESSAGE_THREADS_QUERY_MODULE);
  const invalidateOversight = useInvalidateModule(THREAD_OVERSIGHT_QUERY_MODULE);

  return () => {
    invalidateInbox();
    invalidateOversight();
  };
}
