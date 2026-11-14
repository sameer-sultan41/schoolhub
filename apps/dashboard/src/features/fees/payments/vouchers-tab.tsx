"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Landmark } from "lucide-react";

import { FilterSelect } from "@/components/filter-select";
import { useCurrentUser } from "@/hooks/use-current-user";
import { enumLabel } from "@/lib/enum-label";
import { hasPermission } from "@/lib/permissions";
import { Services, type VoucherRecord } from "@/services";
import {
  VOUCHER_PROVIDERS,
  VOUCHER_REASON_MAX,
  VOUCHER_STATUSES,
  VOUCHER_VOID_ERROR_FIELDS,
  VOUCHERS_DEFAULT_SORTING,
  VOUCHERS_LIST_RESOURCE,
  VOUCHERS_PAGE_SIZE,
  VOUCHERS_QUERY_MODULE,
  VOUCHERS_SORT_FIELD,
  VOUCHERS_URL_FILTERS,
} from "@/services/modules/vouchers/vouchers-constant";
import {
  voucherProviderFilter,
  voucherStatusFilter,
} from "@/services/modules/vouchers/vouchers-helper";
import { filterToPick, pickToFilter } from "@/features/fees/shared/filter-values";
import { ReasonDialog } from "@/features/fees/shared/reason-dialog";
import { useCollectionList } from "@/features/fees/shared/use-collection-list";
import {
  VOUCHER_PROVIDER_LABEL_KEY,
  VOUCHER_STATUS_LABEL_KEY,
} from "@/features/fees/shared/voucher-labels";
import { PaymentsListCard } from "./payments-list-card";
import { useVoucherColumns } from "./voucher-columns";

/**
 * The Vouchers tab: every bank slip, filtered by status and provider, with a download per row.
 * Issuing is from an invoice's page, not here (a slip needs its invoice). Void follows
 * `fees.payment.collect` and shows only on an issued slip; the dialog is mounted only while open.
 */
export function VouchersTab() {
  const t = useTranslations("fees");
  const providerT = useTranslations("portal.fees");
  const [voidTarget, setVoidTarget] = useState<VoucherRecord | null>(null);
  const { data: user } = useCurrentUser();
  const canVoid = hasPermission(user, "fees.payment.collect");

  const handleVoid = useCallback((voucher: VoucherRecord) => {
    setVoidTarget(voucher);
  }, []);
  const columns = useVoucherColumns({ canVoid, onVoid: handleVoid });

  const { list, table, state, hasActiveFilter } = useCollectionList({
    columns,
    queryModule: VOUCHERS_QUERY_MODULE,
    listResource: VOUCHERS_LIST_RESOURCE,
    urlFilters: VOUCHERS_URL_FILTERS,
    sortField: VOUCHERS_SORT_FIELD,
    defaultSorting: VOUCHERS_DEFAULT_SORTING,
    pageSize: VOUCHERS_PAGE_SIZE,
    fetchPage: ({ cursor, pageSize, ordering, filters }) =>
      Services.vouchers.listVouchers({
        cursor,
        pageSize,
        ordering,
        status: voucherStatusFilter(filters.status),
        provider: voucherProviderFilter(filters.provider),
      }),
  });
  const { filters } = state;

  return (
    <>
      <PaymentsListCard
        list={list}
        table={table}
        scope="vouchers"
        icon={Landmark}
        hasActiveFilter={hasActiveFilter}
        filters={
          <>
            <FilterSelect
              label={t("payments.vouchers.filters.status")}
              allLabel={t("payments.filters.all")}
              value={filterToPick(filters.status)}
              onChange={(pick) => {
                state.setFilters({ status: pickToFilter(pick) });
              }}
              options={VOUCHER_STATUSES.map((status) => ({
                id: status,
                name: enumLabel(t, VOUCHER_STATUS_LABEL_KEY, status),
              }))}
            />
            <FilterSelect
              label={t("payments.vouchers.filters.provider")}
              allLabel={t("payments.filters.all")}
              value={filterToPick(filters.provider)}
              onChange={(pick) => {
                state.setFilters({ provider: pickToFilter(pick) });
              }}
              options={VOUCHER_PROVIDERS.map((provider) => ({
                id: provider,
                name: enumLabel(providerT, VOUCHER_PROVIDER_LABEL_KEY, provider),
              }))}
            />
          </>
        }
      />
      {voidTarget && (
        <ReasonDialog
          open
          onOpenChange={(open) => {
            if (!open) setVoidTarget(null);
          }}
          title={t("payments.vouchers.void.title", { number: voidTarget.consumer_number })}
          intro={t("payments.vouchers.void.intro")}
          reasonLabel={t("payments.vouchers.void.reason")}
          reasonMax={VOUCHER_REASON_MAX}
          submitLabel={t("payments.vouchers.void.submit")}
          doneMessage={t("payments.vouchers.void.done", { number: voidTarget.consumer_number })}
          queryModule={VOUCHERS_QUERY_MODULE}
          action={(reason) => Services.vouchers.voidVoucher(voidTarget.id, reason)}
          knownFields={VOUCHER_VOID_ERROR_FIELDS}
        />
      )}
    </>
  );
}
