import type { QueryParams } from "@schoolhub/api-client";
import { FILTER_ALL } from "@/lib/constants";
import { copyMappedFields } from "@/lib/helpers";
import {
  DEFAULT_FEE_HEAD_CATEGORY,
  FEE_HEADS_BODY_FIELDS,
  FEE_HEADS_QUERY_FIELDS,
} from "./fee-heads-constant";
import type { FeeHeadFormValues } from "./fee-heads.schema";
import type { FeeHeadCategory, FeeHeadInput, FeeHeadRecord, FeeHeadsQuery } from "./fee-heads-type";

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

/** A URL filter's picked value, or `undefined` for "all" (no filter sent). */
export function feeHeadCategoryFilter(value: string): FeeHeadCategory | undefined {
  return value === FILTER_ALL ? undefined : (value as FeeHeadCategory);
}

/** The `active` filter -> `is_active`. */
export function feeHeadActiveFilterToFlag(value: string): boolean | undefined {
  if (value === "active") return true;
  if (value === "inactive") return false;
  return undefined;
}

export function defaultFeeHeadFormValues(): FeeHeadFormValues {
  return {
    name: "",
    code: "",
    category: DEFAULT_FEE_HEAD_CATEGORY,
    ledger_account: "",
    is_refundable: false,
    is_active: true,
  };
}

export function recordToFeeHeadFormValues(record: FeeHeadRecord): FeeHeadFormValues {
  return {
    name: record.name,
    code: record.code,
    category: record.category ?? DEFAULT_FEE_HEAD_CATEGORY,
    ledger_account: record.ledger_account,
    is_refundable: record.is_refundable ?? false,
    is_active: record.is_active ?? true,
  };
}

export function buildFeeHeadInput(values: FeeHeadFormValues): FeeHeadInput {
  return {
    name: values.name.trim(),
    code: values.code.trim(),
    category: values.category,
    ledgerAccountId: values.ledger_account,
    isRefundable: values.is_refundable,
    isActive: values.is_active,
  };
}
