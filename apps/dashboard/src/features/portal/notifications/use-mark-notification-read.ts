"use client";

import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";

import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type NotificationRecord } from "@/services";
import { NOTIFICATIONS_QUERY_MODULE } from "@/services/modules/notifications/notifications-constant";

/**
 * Marks a notification read when it is opened, at most once per id. The id is released when the
 * call fails (L33), so opening it again retries, and stays held after a success so a re-render
 * or a second open never repeats a call that already worked.
 */
export function useMarkNotificationRead() {
  const invalidate = useInvalidateModule(NOTIFICATIONS_QUERY_MODULE);
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
    onSuccess: invalidate,
  });

  function markRead(notification: NotificationRecord) {
    if (notification.read_at !== null || attempted.current.has(notification.id)) return;
    attempted.current.add(notification.id);
    mutation.mutate(notification.id);
  }

  return { markRead, isError: mutation.isError };
}
