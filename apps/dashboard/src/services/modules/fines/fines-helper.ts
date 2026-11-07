import type { QueryParams } from "@schoolhub/api-client";
import { FILTER_ALL } from "@/lib/constants";
import { copyMappedFields } from "@/lib/helpers";
import {
  DEFAULT_FINE_TYPE,
  FINE_STATUS_WAIVABLE,
  FINES_BODY_FIELDS,
  FINES_QUERY_FIELDS,
} from "./fines-constant";
import type { FineFormValues } from "./fines.schema";
import type { FineInput, FineRecord, FinesQuery, FineStatus } from "./fines-type";

/** The fines module's pure helpers: plain data in, plain data out. */

/** The list's query string: only the filters given are sent. */
export function toFinesQueryParams(query: FinesQuery): QueryParams {
  const params: Record<string, unknown> = {};
  copyMappedFields(
    query,
    FINES_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as QueryParams;
}

/** A create or update body: only the fields given, in the API's snake_case. */
export function toFineBody(input: Partial<FineInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, FINES_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}

/** A URL filter's picked status, or `undefined` for "all" (no filter sent). */
export function fineStatusFilter(value: string): FineStatus | undefined {
  return value === FILTER_ALL ? undefined : (value as FineStatus);
}

/** Whether a fine can still be waived: only while it is pending. */
export function canWaiveFine(fine: FineRecord): boolean {
  return fine.status === FINE_STATUS_WAIVABLE;
}

export function defaultFineFormValues(): FineFormValues {
  return { student: "", fee_head: "", fine_type: DEFAULT_FINE_TYPE, amount: "", reason: "" };
}

export function buildFineInput(values: FineFormValues): FineInput {
  return {
    studentId: values.student,
    feeHeadId: values.fee_head,
    fineType: values.fine_type,
    amount: values.amount.trim(),
    reason: values.reason.trim(),
  };
}
