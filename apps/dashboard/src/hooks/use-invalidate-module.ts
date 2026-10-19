"use client";

import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";

/** Returns a function that marks every query under `module` stale, for after a write. A screen
 * whose write also stales another module's reads wraps this (`useInvalidateCurriculum`). */
export function useInvalidateModule(module: string) {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.module(module) });
  };
}
