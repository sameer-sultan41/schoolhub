import type { ApiSchemas } from "@schoolhub/api-client";

/** The chart of accounts (`/ledger-accounts`, `fees.ledger-account.*`): a system account is seeded and cannot be deleted. The generated wire shape (ADR-0017). */
export type LedgerAccountRecord = ApiSchemas["LedgerAccount"];
export type LedgerAccountType = ApiSchemas["LedgerAccountTypeEnum"];

export interface LedgerAccountsQuery {
  search?: string;
  ordering?: string;
  accountType?: LedgerAccountType;
  parentId?: string;
  isActive?: boolean;
  isSystem?: boolean;
  cursor?: string;
  pageSize?: number;
}

/** A create sends the required fields; an update sends only the fields given (a PATCH). A `null` clears a nullable field. */
export interface LedgerAccountInput {
  code: string;
  name: string;
  accountType: LedgerAccountType;
  parentId?: string | null;
  isActive?: boolean;
}
