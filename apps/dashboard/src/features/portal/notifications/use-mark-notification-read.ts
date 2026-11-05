"use client";

import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Page } from "@schoolhub/types";

import { Services, type NotificationRecord } from "@/services";
import { inboxListKey, UNREAD_COUNT_KEY } from "./notification-query-keys";

/**
 * Marks a notification read when it is opened, at most once per id. The id is released when the
 * call fails (L33), so opening it again retries, and stays held after a success so a re-render
 * or a second open never repeats a call that already worked.
 *
 * On success the row's `read_at` is patched in every cached inbox page, and only the unread
 * count refetches: refetching the list under the Unread filter would drop the row just opened.
 */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  const attempted = useRef(new Set<string>());

  const mutation = useMutation({
    mutationFn: async (id: string) => {
      try {
        return await Services.notifications.markNotificationRead(id);
      } catch (error) {
        attempted.current.delete(id);
        throw error;
      }
    },
    onSuccess: ({ read_at }, id) => {
      // An empty params object partially matches every page's key, so all filters and cursors.
      queryClient.setQueriesData<Page<NotificationRecord>>(
        { queryKey: inboxListKey() },
        (page) =>
          page && {
            ...page,
            items: page.items.map((row) => (row.id === id ? { ...row, read_at } : row)),
          },
      );
      void queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
    },
  });

  function markRead(notification: NotificationRecord) {
    if (notification.read_at !== null || attempted.current.has(notification.id)) return;
    attempted.current.add(notification.id);
    mutation.mutate(notification.id);
  }

  return { markRead, isError: mutation.isError };
}
