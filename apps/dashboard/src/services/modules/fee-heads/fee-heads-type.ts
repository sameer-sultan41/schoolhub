import type { ApiSchemas } from "@schoolhub/api-client";

/** Fee heads (`/fee-heads`, `fees.fee-head.*`): a charge type, each posting to one ledger account. The generated wire shape (ADR-0017). */
export type FeeHeadRecord = ApiSchemas["FeeHead"];
export type FeeHeadCategory = ApiSchemas["FeeHeadCategoryEnum"];

export interface FeeHeadsQuery {
  search?: string;
  ordering?: string;
  category?: FeeHeadCategory;
  ledgerAccountId?: string;
  isActive?: boolean;
  isRefundable?: boolean;
  cursor?: string;
  pageSize?: number;
}

/** A create sends the required fields; an update sends only the fields given (a PATCH). A `null` clears a nullable field. */
export interface FeeHeadInput {
  name: string;
  code: string;
  category?: FeeHeadCategory;
  ledgerAccountId: string;
  isRefundable?: boolean;
  isActive?: boolean;
}
