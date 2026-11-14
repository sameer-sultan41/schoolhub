"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { GraduationCap } from "lucide-react";

import { useCurrentUser } from "@/hooks/use-current-user";
import { enumLabel } from "@/lib/enum-label";
import { hasPermission } from "@/lib/permissions";
import { Services, type ScholarshipRecord, type ScholarshipStatus } from "@/services";
import {
  SCHOLARSHIP_STATUSES,
  SCHOLARSHIPS_DEFAULT_SORTING,
  SCHOLARSHIPS_LIST_RESOURCE,
  SCHOLARSHIPS_PAGE_SIZE,
  SCHOLARSHIPS_QUERY_MODULE,
  SCHOLARSHIPS_SORT_FIELD,
  SCHOLARSHIPS_URL_FILTERS,
} from "@/services/modules/scholarships/scholarships-constant";
import { scholarshipStatusFilter } from "@/services/modules/scholarships/scholarships-helper";
import { FeesTabHeader } from "@/features/fees/shared/fees-tab-header";
import { SCHOLARSHIP_STATUS_LABEL_KEY } from "@/features/fees/shared/grant-labels";
import { NameLookupProvider } from "@/features/fees/shared/name-lookup";
import { GrantsListCard } from "./grants-list-card";
import { ScholarshipFormDialog } from "./scholarship-form-dialog";
import { ScholarshipStatusDialog } from "./scholarship-status-dialog";
import { useScholarshipColumns } from "./scholarship-columns";
import { useGrantList } from "./use-grant-list";
import { useGrantReferences } from "./use-grant-references";

type MoveTarget = { scholarship: ScholarshipRecord; to: ScholarshipStatus };

/**
 * The Scholarships tab of `/fees/grants`, read with `fees.discount.view`. Add and every status
 * move follow `fees.scholarship.create`; Add also needs the student and session pickers' reads
 * (L59), a status move needs no picker. A row offers only the moves the server's lifecycle table
 * allows. Each dialog is mounted only while open.
 */
export function ScholarshipsTab() {
  const t = useTranslations("fees");
  const [creating, setCreating] = useState(false);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);

  const { data: user } = useCurrentUser();
  const references = useGrantReferences();
  const canChangeStatus = hasPermission(user, "fees.scholarship.create");
  const canCreate = canChangeStatus && references.canPickStudent && references.canReadSessions;

  const handleMove = useCallback((scholarship: ScholarshipRecord, to: ScholarshipStatus) => {
    setMoveTarget({ scholarship, to });
  }, []);
  const columns = useScholarshipColumns({ canChangeStatus, onMove: handleMove });

  const { list, table, state, hasActiveFilter } = useGrantList({
    columns,
    queryModule: SCHOLARSHIPS_QUERY_MODULE,
    listResource: SCHOLARSHIPS_LIST_RESOURCE,
    urlFilters: SCHOLARSHIPS_URL_FILTERS,
    sortField: SCHOLARSHIPS_SORT_FIELD,
    defaultSorting: SCHOLARSHIPS_DEFAULT_SORTING,
    pageSize: SCHOLARSHIPS_PAGE_SIZE,
    fetchPage: ({ status, ...params }) =>
      Services.scholarships.listScholarships({
        ...params,
        status: scholarshipStatusFilter(status),
      }),
  });

  return (
    <NameLookupProvider value={references.lookups}>
      <FeesTabHeader
        createLabel={t("grants.scholarships.actions.create")}
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
        scope="scholarships"
        icon={GraduationCap}
        hasActiveFilter={hasActiveFilter}
        searchInput={state.searchInput}
        onSearchInputChange={state.setSearchInput}
        status={state.filters.status}
        onStatusChange={(status) => {
          state.setFilters({ status });
        }}
        statusOptions={SCHOLARSHIP_STATUSES.map((status) => ({
          id: status,
          name: enumLabel(t, SCHOLARSHIP_STATUS_LABEL_KEY, status),
        }))}
        student={state.filters.student}
        onClearStudent={() => {
          state.setFilters({ student: "" });
        }}
      />
      {creating && (
        <ScholarshipFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setCreating(false);
          }}
        />
      )}
      {moveTarget && (
        <ScholarshipStatusDialog
          open
          onOpenChange={(open) => {
            if (!open) setMoveTarget(null);
          }}
          scholarship={moveTarget.scholarship}
          to={moveTarget.to}
        />
      )}
    </NameLookupProvider>
  );
}
