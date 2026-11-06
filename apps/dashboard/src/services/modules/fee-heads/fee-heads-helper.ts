import type { QueryParams } from "@schoolhub/api-client";
import { copyMappedFields } from "@/lib/helpers";
import { FEE_HEADS_BODY_FIELDS, FEE_HEADS_QUERY_FIELDS } from "./fee-heads-constant";
import type { FeeHeadInput, FeeHeadsQuery } from "./fee-heads-type";

/** The fee-heads module's pure helpers: plain data in, plain data out. */

/** The list's query string: only the filters given are sent. */
export function toFeeHeadsQueryParams(query: FeeHeadsQuery): QueryParams {
  const params: Record<string, unknown> = {};
  copyMappedFields(
    query,
    FEE_HEADS_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as QueryParams;
}

/** A create or update body: only the fields given, in the API's snake_case. */
export function toFeeHeadBody(input: Partial<FeeHeadInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, FEE_HEADS_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}
