import type { QueryParams } from "@schoolhub/api-client";
import { copyMappedFields } from "@/lib/helpers";
import { FEE_STRUCTURES_BODY_FIELDS, FEE_STRUCTURES_QUERY_FIELDS } from "./fee-structures-constant";
import type { FeeStructureInput, FeeStructuresQuery } from "./fee-structures-type";

/** The fee-structures module's pure helpers: plain data in, plain data out. */

/** The list's query string: only the filters given are sent. */
export function toFeeStructuresQueryParams(query: FeeStructuresQuery): QueryParams {
  const params: Record<string, unknown> = {};
  copyMappedFields(
    query,
    FEE_STRUCTURES_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as QueryParams;
}

/** A create or update body: only the fields given, in the API's snake_case. */
export function toFeeStructureBody(input: Partial<FeeStructureInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, FEE_STRUCTURES_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}
