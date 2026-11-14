import type { QueryParams } from "@schoolhub/api-client";
import { copyMappedFields } from "@/lib/helpers";
import { FILTER_ALL } from "@/lib/constants";
import {
  VOUCHER_PROVIDERS,
  VOUCHER_STATUS_VOIDABLE,
  VOUCHER_STATUSES,
  VOUCHERS_QUERY_FIELDS,
} from "./vouchers-constant";
import type {
  IssueVoucherInput,
  VoucherProvider,
  VoucherRecord,
  VoucherStatus,
  VouchersQuery,
} from "./vouchers-type";
import type { IssueVoucherFormValues } from "./vouchers.schema";

/** The list's query string: only the filters given are sent. */
export function toVouchersQueryParams(query: VouchersQuery): QueryParams {
  const params: Record<string, unknown> = {};
  copyMappedFields(
    query,
    VOUCHERS_QUERY_FIELDS,
    (value) => value !== undefined && value !== "" && value !== 0,
    params,
  );
  return params as QueryParams;
}

/** `:issue`'s body: the validity only when one was given (the school's default applies otherwise). */
export function toIssueVoucherBody(input: IssueVoucherInput): Record<string, unknown> {
  const body: Record<string, unknown> = { provider: input.provider };
  if (input.validityDays) body.validity_days = input.validityDays;
  return body;
}

export function buildIssueVoucherInput(values: IssueVoucherFormValues): IssueVoucherInput {
  const days = values.validity_days.trim();
  return { provider: values.provider, validityDays: days ? Number(days) : null };
}

/** A status filter's URL value as the API's: `undefined` for "all" or a value that is not a status. */
export function voucherStatusFilter(value: string): VoucherStatus | undefined {
  return value === FILTER_ALL ? undefined : VOUCHER_STATUSES.find((status) => status === value);
}

export function voucherProviderFilter(value: string): VoucherProvider | undefined {
  return value === FILTER_ALL
    ? undefined
    : VOUCHER_PROVIDERS.find((provider) => provider === value);
}

/** Whether Void is offered: only on an issued slip. The server refuses a paid one regardless. */
export function canVoidVoucher(voucher: Pick<VoucherRecord, "status">): boolean {
  return voucher.status === VOUCHER_STATUS_VOIDABLE;
}
