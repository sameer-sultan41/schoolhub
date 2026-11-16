"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@schoolhub/ui";
import { Layers } from "lucide-react";

import { SearchInput } from "@/components/search-input";
import { CLASS_KEYS, SECTION_KEYS } from "@/features/school/school-permissions";
import { RemoveRecordDialog } from "@/features/school/shared/remove-record-dialog";
import { StructureGridCard } from "@/features/school/shared/structure-grid-card";
import { StructureStatusFilter } from "@/features/school/shared/structure-status";
import { useStructureList } from "@/features/school/shared/use-structure-list";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { Services, type ClassRecord } from "@/services";
import {
  CLASS_DEFAULT_SORTING,
  CLASS_PAGE_RESOURCE,
  CLASS_SORT_FIELD,
  CLASS_SORTABLE_IDS,
  CLASS_URL_FILTERS,
  STRUCTURE_STATUS,
} from "@/services/modules/school-organization/school-organization-constant";
import { structureStatusToIsActive } from "@/services/modules/school-organization/school-organization-helper";
import { useClassColumns } from "./class-columns";
import { ClassFormDialog } from "./class-form-dialog";

function toFilterQuery(filters: { status: string }) {
  return { isActive: structureStatusToIsActive(filters.status) };
}

/**
 * The school's classes up the promotion ladder (by `level`), server paginated, sorted and
 * searched, filtered by status in the URL. Each row opens onto its sections. Class Edit and
 * Remove follow `school.class.update|delete`; the sections inside follow the section keys.
 */
export function ClassesTable() {
  const t = useTranslations("school");
  const [editTarget, setEditTarget] = useState<ClassRecord | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ClassRecord | null>(null);

  const { data: currentUser } = useCurrentUser();
  const canEdit = hasPermission(currentUser, CLASS_KEYS.update);
  const canRemove = hasPermission(currentUser, CLASS_KEYS.delete);
  const canCreateSection = hasPermission(currentUser, SECTION_KEYS.create);
  const canUpdateSection = hasPermission(currentUser, SECTION_KEYS.update);
  const canDeleteSection = hasPermission(currentUser, SECTION_KEYS.delete);
  // One object per change of the keys, so the columns' own memo holds across renders.
  const sections = useMemo(
    () => ({
      canCreate: canCreateSection,
      canUpdate: canUpdateSection,
      canDelete: canDeleteSection,
    }),
    [canCreateSection, canUpdateSection, canDeleteSection],
  );

  const handleEdit = useCallback((record: ClassRecord) => {
    setEditTarget(record);
  }, []);
  const handleRemove = useCallback((record: ClassRecord) => {
    setRemoveTarget(record);
  }, []);
  const columns = useClassColumns({ canEdit, canRemove, sections }, handleEdit, handleRemove);

  const list = useStructureList({
    resource: CLASS_PAGE_RESOURCE,
    columns,
    urlFilters: CLASS_URL_FILTERS,
    sortField: CLASS_SORT_FIELD,
    sortableIds: CLASS_SORTABLE_IDS,
    defaultSorting: CLASS_DEFAULT_SORTING,
    showActions: canEdit || canRemove,
    expandableRows: true,
    toFilterQuery,
    fetchPage: Services.schoolOrganization.fetchClassPage,
  });
  const { filters, setFilters } = list;
  const hasActiveFilter = list.search !== "" || filters.status !== STRUCTURE_STATUS.all;

  return (
    <>
      <StructureGridCard
        table={list.table}
        query={list.query}
        totalCount={list.totalCount}
        isStalePage={list.isStalePage}
        caption={t("classes.list.caption")}
        loadErrorMessage={t("classes.list.loadError")}
        filters={
          <>
            <SearchInput
              value={list.searchInput}
              onChange={list.setSearchInput}
              ariaLabel={t("filters.search")}
              placeholder={t("classes.list.searchPlaceholder")}
              clearLabel={t("filters.clearSearch")}
            />
            <StructureStatusFilter
              value={filters.status}
              onChange={(status) => {
                setFilters({ status });
              }}
            />
          </>
        }
        emptyState={
          <EmptyState
            icon={Layers}
            title={t(hasActiveFilter ? "list.noMatches" : "classes.list.emptyTitle")}
            description={t(
              hasActiveFilter ? "list.noMatchesDescription" : "classes.list.emptyDescription",
            )}
          />
        }
      />
      {editTarget && (
        <ClassFormDialog
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
          remove={() => Services.schoolOrganization.deleteClass(removeTarget.id)}
        />
      )}
    </>
  );
}
