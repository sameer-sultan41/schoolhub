import type { ApiSchemas } from "@schoolhub/api-client";

export type FeeInvoiceRecord = ApiSchemas["FeeInvoice"];

export interface FeeInvoicesQuery {
  studentId?: string;
  outstanding?: boolean;
  status?: string;
  cursor?: string;
  pageSize?: number;
}
