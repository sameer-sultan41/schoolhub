"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { FileSpreadsheet } from "lucide-react";

import { FilterSelect } from "@/components/filter-select";
import { useCurrentUser } from "@/hooks/use-current-user";
import { enumLabel } from "@/lib/enum-label";
import { hasPermission } from "@/lib/permissions";
import { Services, type SettlementImportRecord } from "@/services";
import {
  SETTLEMENT_IMPORT_STATUSES,
  SETTLEMENT_IMPORTS_DEFAULT_SORTING,
  SETTLEMENT_IMPORTS_LIST_RESOURCE,
  SETTLEMENT_IMPORTS_PAGE_SIZE,
  SETTLEMENT_IMPORTS_QUERY_MODULE,
  SETTLEMENT_IMPORTS_SORT_FIELD,
  SETTLEMENT_IMPORTS_URL_FILTERS,
} from "@/services/modules/settlement-imports/settlement-imports-constant";
import {
  settlementProviderFilter,
  settlementStatusFilter,
} from "@/services/modules/settlement-imports/settlement-imports-helper";
import { VOUCHER_PROVIDERS } from "@/services/modules/vouchers/vouchers-constant";
import { filterToPick, pickToFilter } from "@/features/fees/shared/filter-values";
import { FeesTabHeader } from "@/features/fees/shared/fees-tab-header";
import { SETTLEMENT_STATUS_LABEL_KEY } from "@/features/fees/shared/settlement-labels";
import { useCollectionList } from "@/features/fees/shared/use-collection-list";
import { VOUCHER_PROVIDER_LABEL_KEY } from "@/features/fees/shared/voucher-labels";
import { PaymentsListCard } from "./payments-list-card";
import { SettlementImportSheet } from "./settlement-import-sheet";
import { useSettlementImportColumns } from "./settlement-import-columns";
import { SettlementUploadDialog } from "./settlement-upload-dialog";

/**
 * The Settlement imports tab: every provider file reconciled, filtered by status and provider,
 * each opening a sheet with its matched count and exception rows. Upload follows
 * `fees.payment.collect`. The dialog is mounted only while open; the sheet is closed while no
 * import is chosen.
 */
export function SettlementImportsTab() {
  const t = useTranslations("fees");
  const providerT = useTranslations("portal.fees");
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const { data: user } = useCurrentUser();
  const canUpload = hasPermission(user, "fees.payment.collect");

  const handleView = useCallback((record: SettlementImportRecord) => {
    setViewing(record.id);
  }, []);
  const columns = useSettlementImportColumns({ onView: handleView });

  const { list, table, state, hasActiveFilter } = useCollectionList({
    columns,
    queryModule: SETTLEMENT_IMPORTS_QUERY_MODULE,
    listResource: SETTLEMENT_IMPORTS_LIST_RESOURCE,
    urlFilters: SETTLEMENT_IMPORTS_URL_FILTERS,
    sortField: SETTLEMENT_IMPORTS_SORT_FIELD,
    defaultSorting: SETTLEMENT_IMPORTS_DEFAULT_SORTING,
    pageSize: SETTLEMENT_IMPORTS_PAGE_SIZE,
    fetchPage: ({ cursor, pageSize, ordering, filters }) =>
      Services.settlementImports.listSettlementImports({
        cursor,
        pageSize,
        ordering,
        status: settlementStatusFilter(filters.status),
        provider: settlementProviderFilter(filters.provider),
      }),
  });
  const { filters } = state;

  return (
    <>
      <FeesTabHeader
        createLabel={t("payments.imports.actions.upload")}
        onCreate={
          canUpload
            ? () => {
                setUploading(true);
              }
            : undefined
        }
      />
      <PaymentsListCard
        list={list}
        table={table}
        scope="imports"
        icon={FileSpreadsheet}
        hasActiveFilter={hasActiveFilter}
        filters={
          <>
            <FilterSelect
              label={t("payments.imports.filters.status")}
              allLabel={t("payments.filters.all")}
              value={filterToPick(filters.status)}
              onChange={(pick) => {
                state.setFilters({ status: pickToFilter(pick) });
              }}
              options={SETTLEMENT_IMPORT_STATUSES.map((status) => ({
                id: status,
                name: enumLabel(t, SETTLEMENT_STATUS_LABEL_KEY, status),
              }))}
            />
            <FilterSelect
              label={t("payments.imports.filters.provider")}
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
      {uploading && (
        <SettlementUploadDialog
          open
          onOpenChange={(open) => {
            if (!open) setUploading(false);
          }}
        />
      )}
      <SettlementImportSheet
        importId={viewing}
        onOpenChange={(open) => {
          if (!open) setViewing(null);
        }}
      />
    </>
  );
}
