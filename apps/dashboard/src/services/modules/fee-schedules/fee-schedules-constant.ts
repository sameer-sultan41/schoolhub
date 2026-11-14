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
    ["feeHeadId", "fee_head_id"],
    ["frequency", "frequency"],
    ["termId", "term_id"],
    ["cursor", "cursor"],
    ["pageSize", "page_size"],
  ];

export const DEFAULT_FEE_FREQUENCY: FeeFrequency = "one_time";
export const DUE_DAY_MIN = 1;
export const DUE_DAY_MAX = 31;
/** A decimal amount as the API takes it: up to ten digits and two decimals. */
export const AMOUNT_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/** The due rule each frequency uses: a term, a day of the month, or a fixed date (the API's own
 * pairing, `FeeScheduleSerializer.validate`). */
export const FREQUENCY_USES_TERM: readonly FeeFrequency[] = ["per_term"];
export const FREQUENCY_USES_DUE_DAY: readonly FeeFrequency[] = ["monthly"];
export const FREQUENCY_USES_DUE_DATE: readonly FeeFrequency[] = ["one_time", "annual"];

/** The form's fields that have an input regardless of frequency. */
export const FEE_SCHEDULE_BASE_ERROR_FIELDS = ["fee_head", "amount", "frequency"] as const;
