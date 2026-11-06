import type { QueryParams } from "@schoolhub/api-client";
import { copyMappedFields } from "@/lib/helpers";
import { FEE_SCHEDULES_BODY_FIELDS, FEE_SCHEDULES_QUERY_FIELDS } from "./fee-schedules-constant";
import type { FeeScheduleInput, FeeSchedulesQuery } from "./fee-schedules-type";

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
