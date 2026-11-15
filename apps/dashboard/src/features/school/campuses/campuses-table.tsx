"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@schoolhub/ui";
import { Building2 } from "lucide-react";

import { SearchInput } from "@/components/search-input";
import { RemoveRecordDialog } from "@/features/school/shared/remove-record-dialog";
import { StructureGridCard } from "@/features/school/shared/structure-grid-card";
import { StructureStatusFilter } from "@/features/school/shared/structure-status";
import { useStructureList } from "@/features/school/shared/use-structure-list";
import { CAMPUS_KEYS } from "@/features/school/school-permissions";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { Services, type CampusRecord } from "@/services";
import {
  CAMPUS_DEFAULT_SORTING,
  CAMPUS_PAGE_RESOURCE,
  CAMPUS_SORT_FIELD,
  CAMPUS_SORTABLE_IDS,
  CAMPUS_URL_FILTERS,
  STRUCTURE_STATUS,
} from "@/services/modules/school-organization/school-organization-constant";
import { structureStatusToIsActive } from "@/services/modules/school-organization/school-organization-helper";
import { useCampusColumns } from "./campus-columns";
import { CampusFormDialog } from "./campus-form-dialog";

function toFilterQuery(filters: { status: string }) {
  return { isActive: structureStatusToIsActive(filters.status) };
}

/**
 * The school's campuses, server paginated, sorted and searched, with their edit and remove
 * dialogs. The view state lives in the URL (`useStructureList`); each dialog is mounted only
 * while open.
 */
export function CampusesTable() {
  const t = useTranslations("school");
  const [editTarget, setEditTarget] = useState<CampusRecord | null>(null);
  const [removeTarget, setRemoveTarget] = useState<CampusRecord | null>(null);

  const { data: currentUser } = useCurrentUser();
  const canUpdate = hasPermission(currentUser, CAMPUS_KEYS.update);
  const canDelete = hasPermission(currentUser, CAMPUS_KEYS.delete);

  // Stable, so the columns' own `useMemo` skips a rebuild on a keystroke or a page change.
  const handleEdit = useCallback((record: CampusRecord) => {
    setEditTarget(record);
  }, []);
  const handleRemove = useCallback((record: CampusRecord) => {
    setRemoveTarget(record);
  }, []);
  const columns = useCampusColumns(canUpdate, canDelete, handleEdit, handleRemove);

  const list = useStructureList({
    resource: CAMPUS_PAGE_RESOURCE,
    columns,
    urlFilters: CAMPUS_URL_FILTERS,
    sortField: CAMPUS_SORT_FIELD,
    sortableIds: CAMPUS_SORTABLE_IDS,
    defaultSorting: CAMPUS_DEFAULT_SORTING,
    showActions: canUpdate || canDelete,
    toFilterQuery,
    fetchPage: Services.schoolOrganization.fetchCampusPage,
  });
  const hasActiveFilter = list.search !== "" || list.filters.status !== STRUCTURE_STATUS.all;

  return (
    <>
      <StructureGridCard
        table={list.table}
        query={list.query}
        totalCount={list.totalCount}
        isStalePage={list.isStalePage}
        caption={t("campuses.list.caption")}
        loadErrorMessage={t("campuses.list.loadError")}
        filters={
          <>
            <SearchInput
              value={list.searchInput}
              onChange={list.setSearchInput}
              ariaLabel={t("filters.search")}
              placeholder={t("campuses.list.searchPlaceholder")}
              clearLabel={t("filters.clearSearch")}
            />
            <StructureStatusFilter
              value={list.filters.status}
              onChange={(status) => {
                list.setFilters({ status });
              }}
            />
          </>
        }
        emptyState={
          <EmptyState
            icon={Building2}
            title={t(hasActiveFilter ? "list.noMatches" : "campuses.list.emptyTitle")}
            description={t(
              hasActiveFilter ? "list.noMatchesDescription" : "campuses.list.emptyDescription",
            )}
          />
        }
      />
      {editTarget && (
        <CampusFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          record={editTarget}
        />
      )}
      {removeTarget && (
        <RemoveRecordDialog
          open
          onOpenChange={(open) => {
            if (!open) setRemoveTarget(null);
          }}
          name={removeTarget.name}
          remove={() => Services.schoolOrganization.deleteCampus(removeTarget.id)}
        />
      )}
    </>
  );
}
