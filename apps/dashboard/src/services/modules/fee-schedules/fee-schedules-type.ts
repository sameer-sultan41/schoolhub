import type { ApiSchemas } from "@schoolhub/api-client";

/** Fee schedules (`/fee-schedules`, `fees.fee-schedule.*`): one fee head's amount and due rule within a structure. `amount` is a decimal string, as the API sends it. The generated wire shape (ADR-0017). */
export type FeeScheduleRecord = ApiSchemas["FeeSchedule"];
export type FeeFrequency = ApiSchemas["FeeFrequencyEnum"];

export interface FeeSchedulesQuery {
  search?: string;
  ordering?: string;
  feeStructureId?: string;
  cursor?: string;
  pageSize?: number;
}

/** A create sends the required fields; an update sends only the fields given (a PATCH). A `null` clears a nullable field. */
export interface FeeScheduleInput {
  feeStructureId: string;
  feeHeadId: string;
  amount: string;
  frequency?: FeeFrequency;
  termId?: string | null;
  dueDay?: number | null;
  dueDate?: string | null;
  lateFeePolicy?: unknown;
}
