import type { FeeFrequency, FeeScheduleInput, FeeSchedulesQuery } from "./fee-schedules-type";

/** The fee-schedules module's constants. */

/** The query-key module every feeSchedule read lives under; a write invalidates it. */
export const FEE_SCHEDULES_QUERY_MODULE = "fee-schedules";
export const FEE_SCHEDULES_LIST_RESOURCE = "list";
export const FEE_SCHEDULES_DETAIL_RESOURCE = "detail";

/** Every FeeFrequency value, keyed so the compiler checks the set against the generated enum (L32). */
const FEE_FREQUENCIES_SET: Record<FeeFrequency, true> = {
  one_time: true,
  monthly: true,
  per_term: true,
  annual: true,
};
export const FEE_FREQUENCIES = Object.keys(FEE_FREQUENCIES_SET) as FeeFrequency[];

/** camelCase `FeeScheduleInput` key -> the API's body key. */
export const FEE_SCHEDULES_BODY_FIELDS: ReadonlyArray<readonly [keyof FeeScheduleInput, string]> = [
  ["feeStructureId", "fee_structure"],
  ["feeHeadId", "fee_head"],
  ["amount", "amount"],
  ["frequency", "frequency"],
  ["termId", "term"],
  ["dueDay", "due_day"],
  ["dueDate", "due_date"],
  ["lateFeePolicy", "late_fee_policy"],
];

/** camelCase `FeeSchedulesQuery` key -> the list's query param. */
export const FEE_SCHEDULES_QUERY_FIELDS: ReadonlyArray<readonly [keyof FeeSchedulesQuery, string]> =
  [
    ["search", "search"],
    ["ordering", "ordering"],
    ["feeStructureId", "fee_structure_id"],
    ["cursor", "cursor"],
    ["pageSize", "page_size"],
  ];
