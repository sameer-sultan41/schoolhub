import type { QueryParams } from "@schoolhub/api-client";
import { copyMappedFields } from "@/lib/helpers";
import {
  DEFAULT_FEE_FREQUENCY,
  FEE_SCHEDULE_BASE_ERROR_FIELDS,
  FEE_SCHEDULES_BODY_FIELDS,
  FEE_SCHEDULES_QUERY_FIELDS,
  FREQUENCY_USES_DUE_DATE,
  FREQUENCY_USES_DUE_DAY,
  FREQUENCY_USES_TERM,
} from "./fee-schedules-constant";
import type { FeeScheduleFormValues } from "./fee-schedules.schema";
import type {
  FeeFrequency,
  FeeScheduleInput,
  FeeScheduleRecord,
  FeeSchedulesQuery,
} from "./fee-schedules-type";

/** The fee-schedules module's pure helpers: plain data in, plain data out. */

/** The list's query string: only the filters given are sent. */
export function toFeeSchedulesQueryParams(query: FeeSchedulesQuery): QueryParams {
  const params: Record<string, unknown> = {};
  copyMappedFields(
    query,
    FEE_SCHEDULES_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as QueryParams;
}

/** A create or update body: only the fields given, in the API's snake_case. */
export function toFeeScheduleBody(input: Partial<FeeScheduleInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, FEE_SCHEDULES_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}

export function defaultFeeScheduleFormValues(): FeeScheduleFormValues {
  return {
    fee_head: "",
    amount: "",
    frequency: DEFAULT_FEE_FREQUENCY,
    term: "",
    due_day: "",
    due_date: "",
  };
}

export function recordToFeeScheduleFormValues(record: FeeScheduleRecord): FeeScheduleFormValues {
  return {
    fee_head: record.fee_head,
    amount: record.amount,
    frequency: record.frequency ?? DEFAULT_FEE_FREQUENCY,
    term: record.term ?? "",
    due_day: record.due_day === null || record.due_day === undefined ? "" : String(record.due_day),
    due_date: record.due_date ?? "",
  };
}

/** Which due-rule inputs a frequency shows. */
export function dueRuleFor(frequency: FeeFrequency) {
  return {
    usesTerm: FREQUENCY_USES_TERM.includes(frequency),
    usesDueDay: FREQUENCY_USES_DUE_DAY.includes(frequency),
    usesDueDate: FREQUENCY_USES_DUE_DATE.includes(frequency),
  };
}

/** The fields with an input for `frequency`: a server error on any other folds into the form's message. */
export function feeScheduleErrorFields(frequency: FeeFrequency): readonly string[] {
  const rule = dueRuleFor(frequency);
  return [
    ...FEE_SCHEDULE_BASE_ERROR_FIELDS,
    ...(rule.usesTerm ? ["term"] : []),
    ...(rule.usesDueDay ? ["due_day"] : []),
    ...(rule.usesDueDate ? ["due_date"] : []),
  ];
}

/**
 * Form values -> the service input for `structureId`. Only the due rule the frequency uses is
 * sent; the others are `null`, so changing the frequency on edit clears the old rule. A blank
 * rule the frequency needs is sent as `null` too, and the server says which field is missing.
 * `lateFeePolicy` is not on the form, so it is left out and an edit keeps it.
 */
export function buildFeeScheduleInput(
  values: FeeScheduleFormValues,
  structureId: string,
): FeeScheduleInput {
  const rule = dueRuleFor(values.frequency);
  return {
    feeStructureId: structureId,
    feeHeadId: values.fee_head,
    amount: values.amount.trim(),
    frequency: values.frequency,
    termId: rule.usesTerm && values.term !== "" ? values.term : null,
    dueDay: rule.usesDueDay && values.due_day.trim() !== "" ? Number(values.due_day) : null,
    dueDate: rule.usesDueDate && values.due_date !== "" ? values.due_date : null,
  };
}
