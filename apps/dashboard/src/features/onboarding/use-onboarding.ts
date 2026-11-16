"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { ONBOARDING_VIEW_PERMISSION } from "@/services/modules/onboarding/onboarding-constant";

/** The checklist, read only by someone who may read it: anyone else would get a 403. */
export function useOnboarding() {
  const { data: user } = useCurrentUser();
  const canView = hasPermission(user, ONBOARDING_VIEW_PERMISSION);
  const query = useQuery({
    queryKey: queryKeys.onboarding(),
    queryFn: () => Services.onboarding.fetchOnboarding(),
    enabled: canView,
  });
  return { user, canView, query };
}

/**
 * While the wizard is open, every successful mutation refreshes the checklist. The embedded School
 * sections save through their own dialogs and know nothing of onboarding; a `MutationCache`
 * subscription (TanStack's documented way to observe every mutation) covers all of them without
 * threading an `onSaved` prop through each unit, and stops when the wizard unmounts.
 */
export function useRefreshOnboardingOnWrites() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      queryClient.getMutationCache().subscribe((event) => {
        if (event.type === "updated" && event.action.type === "success") {
          void queryClient.invalidateQueries({ queryKey: queryKeys.onboarding() });
        }
      }),
    [queryClient],
  );
}
