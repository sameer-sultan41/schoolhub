import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toDiscountBody, toDiscountsQueryParams } from "./discounts-helper";
import type { DiscountInput, DiscountRecord, DiscountsQuery } from "./discounts-type";

/** The discounts API calls (`/discounts`), reached through `Services.discounts.*`. There is no delete: the route does not exist. */

export async function listDiscounts(query: DiscountsQuery = {}): Promise<Page<DiscountRecord>> {
  return fetchPage<DiscountRecord>(apiClient, endpoints.discounts.list, {
    query: toDiscountsQueryParams(query),
  });
}

export async function createDiscount(input: DiscountInput): Promise<DiscountRecord> {
  const { data } = await apiClient.post<DiscountRecord>(
    endpoints.discounts.list,
    toDiscountBody(input),
  );
  return data;
}

export async function updateDiscount(
  id: string,
  input: Partial<DiscountInput>,
): Promise<DiscountRecord> {
  const { data } = await apiClient.patch<DiscountRecord>(
    endpoints.discounts.detail(id),
    toDiscountBody(input),
  );
  return data;
}

/** A colon-action (`/discounts/{id}:revoke`) with a required reason. Forward-looking: invoices already priced keep their figures. */
export async function revokeDiscount(id: string, reason: string): Promise<DiscountRecord> {
  const { data } = await apiClient.post<DiscountRecord>(endpoints.discounts.revoke(id), {
    reason,
  });
  return data;
}
