"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@schoolhub/ui";
import { Flag } from "lucide-react";

import { SearchInput } from "@/components/search-input";
import { HOUSE_KEYS } from "@/features/school/school-permissions";
import { RemoveRecordDialog } from "@/features/school/shared/remove-record-dialog";
import { StructureGridCard } from "@/features/school/shared/structure-grid-card";
import { StructureStatusFilter } from "@/features/school/shared/structure-status";
import { useStructureList } from "@/features/school/shared/use-structure-list";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { Services, type HouseRecord } from "@/services";
import {
  HOUSE_DEFAULT_SORTING,
  HOUSE_PAGE_RESOURCE,
  HOUSE_SORT_FIELD,
  HOUSE_SORTABLE_IDS,
  HOUSE_URL_FILTERS,
  STRUCTURE_STATUS,
} from "@/services/modules/school-organization/school-organization-constant";
import { structureStatusToIsActive } from "@/services/modules/school-organization/school-organization-helper";
import { useHouseColumns } from "./house-columns";
import { HouseFormDialog } from "./house-form-dialog";

function toFilterQuery(filters: { status: string }) {
  return { isActive: structureStatusToIsActive(filters.status) };
}

/** The school's houses, server paginated, sorted and searched, with their edit and remove
 * dialogs. The view state lives in the URL. */
export function HousesTable() {
  const t = useTranslations("school");
  const [editTarget, setEditTarget] = useState<HouseRecord | null>(null);
  const [removeTarget, setRemoveTarget] = useState<HouseRecord | null>(null);

  const { data: currentUser } = useCurrentUser();
  const canUpdate = hasPermission(currentUser, HOUSE_KEYS.update);
  const canDelete = hasPermission(currentUser, HOUSE_KEYS.delete);

  const handleEdit = useCallback((record: HouseRecord) => {
    setEditTarget(record);
  }, []);
  const handleRemove = useCallback((record: HouseRecord) => {
    setRemoveTarget(record);
  }, []);
  const columns = useHouseColumns(canUpdate, canDelete, handleEdit, handleRemove);

  const list = useStructureList({
    resource: HOUSE_PAGE_RESOURCE,
    columns,
    urlFilters: HOUSE_URL_FILTERS,
    sortField: HOUSE_SORT_FIELD,
    sortableIds: HOUSE_SORTABLE_IDS,
    defaultSorting: HOUSE_DEFAULT_SORTING,
    showActions: canUpdate || canDelete,
    toFilterQuery,
    fetchPage: Services.schoolOrganization.fetchHousePage,
  });
  const hasActiveFilter = list.search !== "" || list.filters.status !== STRUCTURE_STATUS.all;

  return (
    <>
      <StructureGridCard
        table={list.table}
        query={list.query}
        totalCount={list.totalCount}
        isStalePage={list.isStalePage}
        caption={t("houses.list.caption")}
        loadErrorMessage={t("houses.list.loadError")}
        filters={
          <>
            <SearchInput
              value={list.searchInput}
              onChange={list.setSearchInput}
              ariaLabel={t("filters.search")}
              placeholder={t("houses.list.searchPlaceholder")}
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
            icon={Flag}
            title={t(hasActiveFilter ? "list.noMatches" : "houses.list.emptyTitle")}
            description={t(
              hasActiveFilter ? "list.noMatchesDescription" : "houses.list.emptyDescription",
            )}
          />
        }
      />
      {editTarget && (
        <HouseFormDialog
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
          remove={() => Services.schoolOrganization.deleteHouse(removeTarget.id)}
        />
      )}
    </>
  );
}
