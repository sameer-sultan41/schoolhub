"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Gavel } from "lucide-react";

import { useCurrentUser } from "@/hooks/use-current-user";
import { enumLabel } from "@/lib/enum-label";
import { hasPermission } from "@/lib/permissions";
import { Services, type FineRecord } from "@/services";
import {
  FINE_REASON_MAX,
  FINE_STATUSES,
  FINE_WAIVE_ERROR_FIELDS,
  FINES_DEFAULT_SORTING,
  FINES_LIST_RESOURCE,
  FINES_PAGE_SIZE,
  FINES_QUERY_MODULE,
  FINES_SORT_FIELD,
  FINES_URL_FILTERS,
} from "@/services/modules/fines/fines-constant";
import { fineStatusFilter } from "@/services/modules/fines/fines-helper";
import { FeesTabHeader } from "@/features/fees/shared/fees-tab-header";
import { FINE_STATUS_LABEL_KEY } from "@/features/fees/shared/grant-labels";
import { NameLookupProvider } from "@/features/fees/shared/name-lookup";
import { ReasonDialog } from "@/features/fees/shared/reason-dialog";
import { useFineColumns } from "./fine-columns";
import { FineFormDialog } from "./fine-form-dialog";
import { GrantsListCard } from "./grants-list-card";
import { useGrantList } from "./use-grant-list";
import { useGrantReferences } from "./use-grant-references";

/**
 * The Fines tab of `/fees/grants`, read with `fees.fine.view`. Raise follows `fees.fine.create`
 * and needs the student picker's and the fee heads' reads too (L59: the head is required); Waive
 * follows `fees.fine.waive` and shows only on a pending fine. Each dialog is mounted only while
 * open.
 */
export function FinesTab() {
  const t = useTranslations("fees");
  const [creating, setCreating] = useState(false);
  const [waiveTarget, setWaiveTarget] = useState<FineRecord | null>(null);

  const { data: user } = useCurrentUser();
  const references = useGrantReferences();
  const canCreate =
    hasPermission(user, "fees.fine.create") && references.canPickStudent && references.canReadHeads;
  const canWaive = hasPermission(user, "fees.fine.waive");

  const handleWaive = useCallback((record: FineRecord) => {
    setWaiveTarget(record);
  }, []);
  const columns = useFineColumns({ canWaive, onWaive: handleWaive });

  const { list, table, state, hasActiveFilter } = useGrantList({
    columns,
    queryModule: FINES_QUERY_MODULE,
    listResource: FINES_LIST_RESOURCE,
    urlFilters: FINES_URL_FILTERS,
    sortField: FINES_SORT_FIELD,
    defaultSorting: FINES_DEFAULT_SORTING,
    pageSize: FINES_PAGE_SIZE,
    fetchPage: ({ status, ...params }) =>
      Services.fines.listFines({ ...params, status: fineStatusFilter(status) }),
  });

  return (
    <NameLookupProvider value={references.lookups}>
      <FeesTabHeader
        createLabel={t("grants.fines.actions.create")}
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
        scope="fines"
        icon={Gavel}
        hasActiveFilter={hasActiveFilter}
        searchInput={state.searchInput}
        onSearchInputChange={state.setSearchInput}
        status={state.filters.status}
        onStatusChange={(status) => {
          state.setFilters({ status });
        }}
        statusOptions={FINE_STATUSES.map((status) => ({
          id: status,
          name: enumLabel(t, FINE_STATUS_LABEL_KEY, status),
        }))}
        student={state.filters.student}
        onClearStudent={() => {
          state.setFilters({ student: "" });
        }}
      />
      {creating && (
        <FineFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setCreating(false);
          }}
        />
      )}
      {waiveTarget && (
        <ReasonDialog
          open
          onOpenChange={(open) => {
            if (!open) setWaiveTarget(null);
          }}
          title={t("grants.fines.waive.title", { name: waiveTarget.student_name })}
          intro={t("grants.fines.waive.intro")}
          reasonLabel={t("grants.fines.waive.reason")}
          reasonMax={FINE_REASON_MAX}
          submitLabel={t("grants.fines.waive.submit")}
          doneMessage={t("grants.fines.waive.done")}
          queryModule={FINES_QUERY_MODULE}
          action={(reason) => Services.fines.waiveFine(waiveTarget.id, reason)}
          knownFields={FINE_WAIVE_ERROR_FIELDS}
        />
      )}
    </NameLookupProvider>
  );
}
