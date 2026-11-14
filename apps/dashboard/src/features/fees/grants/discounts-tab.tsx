"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { BadgePercent } from "lucide-react";

import { useCurrentUser } from "@/hooks/use-current-user";
import { enumLabel } from "@/lib/enum-label";
import { hasPermission } from "@/lib/permissions";
import { Services, type DiscountRecord } from "@/services";
import {
  DISCOUNT_REASON_MAX,
  DISCOUNT_REVOKE_ERROR_FIELDS,
  DISCOUNT_STATUSES,
  DISCOUNTS_DEFAULT_SORTING,
  DISCOUNTS_LIST_RESOURCE,
  DISCOUNTS_PAGE_SIZE,
  DISCOUNTS_QUERY_MODULE,
  DISCOUNTS_SORT_FIELD,
  DISCOUNTS_URL_FILTERS,
} from "@/services/modules/discounts/discounts-constant";
import { discountStatusFilter } from "@/services/modules/discounts/discounts-helper";
import { FeesTabHeader } from "@/features/fees/shared/fees-tab-header";
import { DISCOUNT_STATUS_LABEL_KEY } from "@/features/fees/shared/grant-labels";
import { NameLookupProvider } from "@/features/fees/shared/name-lookup";
import { ReasonDialog } from "@/features/fees/shared/reason-dialog";
import { useDiscountColumns } from "./discount-columns";
import { DiscountFormDialog } from "./discount-form-dialog";
import { GrantsListCard } from "./grants-list-card";
import { useGrantList } from "./use-grant-list";
import { useGrantReferences } from "./use-grant-references";

/**
 * The Discounts tab of `/fees/grants`, read with `fees.discount.view`. Grant follows
 * `fees.discount.create` and needs the student and session pickers' reads too (L59); Revoke
 * follows `fees.discount.waive` and shows only on an active discount. Each dialog is mounted only
 * while open.
 */
export function DiscountsTab() {
  const t = useTranslations("fees");
  const [creating, setCreating] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<DiscountRecord | null>(null);

  const { data: user } = useCurrentUser();
  const references = useGrantReferences();
  const canCreate =
    hasPermission(user, "fees.discount.create") &&
    references.canPickStudent &&
    references.canReadSessions;
  const canRevoke = hasPermission(user, "fees.discount.waive");

  const handleRevoke = useCallback((record: DiscountRecord) => {
    setRevokeTarget(record);
  }, []);
  const columns = useDiscountColumns({ canRevoke, onRevoke: handleRevoke });

  const { list, table, state, hasActiveFilter } = useGrantList({
    columns,
    queryModule: DISCOUNTS_QUERY_MODULE,
    listResource: DISCOUNTS_LIST_RESOURCE,
    urlFilters: DISCOUNTS_URL_FILTERS,
    sortField: DISCOUNTS_SORT_FIELD,
    defaultSorting: DISCOUNTS_DEFAULT_SORTING,
    pageSize: DISCOUNTS_PAGE_SIZE,
    fetchPage: ({ status, ...params }) =>
      Services.discounts.listDiscounts({ ...params, status: discountStatusFilter(status) }),
  });

  return (
    <NameLookupProvider value={references.lookups}>
      <FeesTabHeader
        createLabel={t("grants.discounts.actions.create")}
        onCreate={
          canCreate
            ? () => {
                setCreating(true);
              }
            : undefined
        }
      />
      <GrantsListCard
        list={list}
        table={table}
        scope="discounts"
        icon={BadgePercent}
        hasActiveFilter={hasActiveFilter}
        searchInput={state.searchInput}
        onSearchInputChange={state.setSearchInput}
        status={state.filters.status}
        onStatusChange={(status) => {
          state.setFilters({ status });
        }}
        statusOptions={DISCOUNT_STATUSES.map((status) => ({
          id: status,
          name: enumLabel(t, DISCOUNT_STATUS_LABEL_KEY, status),
        }))}
        student={state.filters.student}
        onClearStudent={() => {
          state.setFilters({ student: "" });
        }}
      />
      {creating && (
        <DiscountFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setCreating(false);
          }}
        />
      )}
      {revokeTarget && (
        <ReasonDialog
          open
          onOpenChange={(open) => {
            if (!open) setRevokeTarget(null);
          }}
          title={t("grants.discounts.revoke.title", { name: revokeTarget.name })}
          intro={t("grants.discounts.revoke.intro")}
          reasonLabel={t("grants.discounts.revoke.reason")}
          reasonMax={DISCOUNT_REASON_MAX}
          submitLabel={t("grants.discounts.revoke.submit")}
          doneMessage={t("grants.discounts.revoke.done", { name: revokeTarget.name })}
          queryModule={DISCOUNTS_QUERY_MODULE}
          action={(reason) => Services.discounts.revokeDiscount(revokeTarget.id, reason)}
          knownFields={DISCOUNT_REVOKE_ERROR_FIELDS}
        />
      )}
    </NameLookupProvider>
  );
}
