"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { CUSTOM_DOMAINS_RESOURCE } from "@/services/modules/website/custom-domains/custom-domains-constant";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";

/** The domains list's key: under `website`, so any website write refreshes it. */
export const CUSTOM_DOMAINS_KEY = queryKeys.list(WEBSITE_QUERY_MODULE, CUSTOM_DOMAINS_RESOURCE, {});

/** Every domain the school has added (at most `CUSTOM_DOMAIN_LIMIT`). */
export function useCustomDomains() {
  return useQuery({
    queryKey: CUSTOM_DOMAINS_KEY,
    queryFn: () => Services.customDomains.fetchCustomDomains(),
  });
}
