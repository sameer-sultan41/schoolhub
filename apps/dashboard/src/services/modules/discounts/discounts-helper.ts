import type { QueryParams } from "@schoolhub/api-client";
import { FILTER_ALL } from "@/lib/constants";
import { copyMappedFields } from "@/lib/helpers";
import {
  DEFAULT_DISCOUNT_TYPE,
  DISCOUNT_STATUS_REVOKABLE,
  DISCOUNTS_BODY_FIELDS,
  DISCOUNTS_QUERY_FIELDS,
} from "./discounts-constant";
import type { DiscountFormValues } from "./discounts.schema";
import type {
  DiscountInput,
  DiscountRecord,
  DiscountsQuery,
  DiscountStatus,
} from "./discounts-type";

/** The discounts module's pure helpers: plain data in, plain data out. */

/** The list's query string: only the filters given are sent. */
export function toDiscountsQueryParams(query: DiscountsQuery): QueryParams {
  const params: Record<string, unknown> = {};
  copyMappedFields(
    query,
    DISCOUNTS_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as QueryParams;
}

/** A create or update body: only the fields given, in the API's snake_case. `null` clears a nullable field. */
export function toDiscountBody(input: Partial<DiscountInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, DISCOUNTS_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}

/** A URL filter's picked status, or `undefined` for "all" (no filter sent). */
export function discountStatusFilter(value: string): DiscountStatus | undefined {
  return value === FILTER_ALL ? undefined : (value as DiscountStatus);
}

/** Whether a discount can still be revoked: only while it is active. */
export function canRevokeDiscount(discount: DiscountRecord): boolean {
  return discount.status === DISCOUNT_STATUS_REVOKABLE;
}

export function defaultDiscountFormValues(): DiscountFormValues {
  return {
    student: "",
    academic_session: "",
    name: "",
    discount_type: DEFAULT_DISCOUNT_TYPE,
    value: "",
    fee_head: "",
    valid_from: "",
    valid_to: "",
    reason: "",
  };
}

/** A blank optional field is sent as `null`, so the server stores nothing rather than an empty string. */
export function buildDiscountInput(values: DiscountFormValues): DiscountInput {
  return {
    studentId: values.student,
    academicSessionId: values.academic_session,
    name: values.name.trim(),
    discountType: values.discount_type,
    value: values.value.trim(),
    feeHeadId: values.fee_head || null,
    validFrom: values.valid_from || null,
    validTo: values.valid_to || null,
    reason: values.reason.trim() || null,
  };
}
