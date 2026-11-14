import type {
  FeeFrequency,
  FeeHeadCategory,
  FeeStructureStatus,
  LedgerAccountType,
} from "@/services";

/**
 * Each fees-setup enum's value to its message key in the `fees` namespace. Exhaustive records
 * (L32): a value the generated enum gains fails to compile here until it is labelled.
 */

export const STRUCTURE_STATUS_LABEL_KEY: Record<FeeStructureStatus, string> = {
  draft: "structures.status.draft",
  active: "structures.status.active",
  archived: "structures.status.archived",
};

export const FEE_HEAD_CATEGORY_LABEL_KEY: Record<FeeHeadCategory, string> = {
  tuition: "heads.category.tuition",
  admission: "heads.category.admission",
  transport: "heads.category.transport",
  library: "heads.category.library",
  exam: "heads.category.exam",
  fine: "heads.category.fine",
  other: "heads.category.other",
};

export const LEDGER_ACCOUNT_TYPE_LABEL_KEY: Record<LedgerAccountType, string> = {
  asset: "ledger.accounts.type.asset",
  liability: "ledger.accounts.type.liability",
  equity: "ledger.accounts.type.equity",
  income: "ledger.accounts.type.income",
  expense: "ledger.accounts.type.expense",
};

export const FEE_FREQUENCY_LABEL_KEY: Record<FeeFrequency, string> = {
  one_time: "structures.schedules.frequency.one_time",
  monthly: "structures.schedules.frequency.monthly",
  per_term: "structures.schedules.frequency.per_term",
  annual: "structures.schedules.frequency.annual",
};
