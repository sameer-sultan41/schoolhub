"use client";

import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { PARENT_PORTAL_QUERY_MODULE } from "@/services/modules/parent-portal/parent-portal-constant";
import { PORTAL_LEAVE_RESOURCE } from "./use-child-leave";

/** Stales every child's leave list after a submission or a withdrawal. */
export function useInvalidatePortalLeave() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.list(PARENT_PORTAL_QUERY_MODULE, PORTAL_LEAVE_RESOURCE),
    });
  };
}
