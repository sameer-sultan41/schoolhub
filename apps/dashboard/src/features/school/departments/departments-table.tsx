"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import {
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";
import { Network } from "lucide-react";

import { FilterSelect } from "@/components/filter-select";
import { SearchInput } from "@/components/search-input";
import { DEPARTMENT_KEYS } from "@/features/school/school-permissions";
import { RemoveRecordDialog } from "@/features/school/shared/remove-record-dialog";
import { PagedGridCard } from "@/components/paged-grid-card";
import { StructureStatusFilter } from "@/features/school/shared/structure-status";
import { useStructureList } from "@/features/school/shared/use-structure-list";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useCampuses } from "@/hooks/use-reference-data";
import { FILTER_ALL } from "@/lib/constants";
import { hasPermission } from "@/lib/permissions";
import { Services, type DepartmentRecord } from "@/services";
import {
  DEPARTMENT_DEFAULT_SORTING,
  DEPARTMENT_PAGE_RESOURCE,
  DEPARTMENT_SORT_FIELD,
  DEPARTMENT_SORTABLE_IDS,
  DEPARTMENT_TYPES,
  DEPARTMENT_URL_FILTERS,
  STRUCTURE_STATUS,
} from "@/services/modules/school-organization/school-organization-constant";
import {
  structureStatusToIsActive,
  typeFilterToDepartmentType,
} from "@/services/modules/school-organization/school-organization-helper";
import { useDepartmentColumns } from "./department-columns";
import { DepartmentFormDialog } from "./department-form-dialog";

function toFilterQuery(filters: { campus: string; type: string; status: string }) {
  return {
    campusId: filters.campus || undefined,
    departmentType: typeFilterToDepartmentType(filters.type),
    isActive: structureStatusToIsActive(filters.status),
  };
}

/**
 * The school's departments, server paginated, sorted and searched, filtered by campus, type
 * and status, with their edit and remove dialogs. The view state lives in the URL.
 */
export function DepartmentsTable() {
  const t = useTranslations("school");
  const [editTarget, setEditTarget] = useState<DepartmentRecord | null>(null);
  const [removeTarget, setRemoveTarget] = useState<DepartmentRecord | null>(null);

  const { data: currentUser } = useCurrentUser();
  const canUpdate = hasPermission(currentUser, DEPARTMENT_KEYS.update);
  const canDelete = hasPermission(currentUser, DEPARTMENT_KEYS.delete);
  const campusesQuery = useCampuses();

  const handleEdit = useCallback((record: DepartmentRecord) => {
    setEditTarget(record);
  }, []);
  const handleRemove = useCallback((record: DepartmentRecord) => {
    setRemoveTarget(record);
  }, []);
  const columns = useDepartmentColumns(
    campusesQuery.data,
    canUpdate,
    canDelete,
    handleEdit,
    handleRemove,
  );

  const list = useStructureList({
    resource: DEPARTMENT_PAGE_RESOURCE,
    columns,
    urlFilters: DEPARTMENT_URL_FILTERS,
    sortField: DEPARTMENT_SORT_FIELD,
    sortableIds: DEPARTMENT_SORTABLE_IDS,
    defaultSorting: DEPARTMENT_DEFAULT_SORTING,
    showActions: canUpdate || canDelete,
    toFilterQuery,
    fetchPage: Services.schoolOrganization.fetchDepartmentPage,
  });
  const { filters, setFilters } = list;
  const hasActiveFilter =
    list.search !== "" ||
    filters.campus !== "" ||
    filters.type !== FILTER_ALL ||
    filters.status !== STRUCTURE_STATUS.all;

  return (
    <>
      <PagedGridCard
        table={list.table}
        query={list.query}
        totalCount={list.totalCount}
        isStalePage={list.isStalePage}
        caption={t("departments.list.caption")}
        loadErrorMessage={t("departments.list.loadError")}
        filters={
          <>
            <SearchInput
              value={list.searchInput}
              onChange={list.setSearchInput}
              ariaLabel={t("filters.search")}
              placeholder={t("departments.list.searchPlaceholder")}
              clearLabel={t("filters.clearSearch")}
            />
            <FilterSelect
              label={t("fields.campus")}
              allLabel={t("filters.all")}
              value={filters.campus}
              onChange={(campus) => {
                setFilters({ campus });
              }}
              options={campusesQuery.data ?? []}
            />
            <Select
              value={filters.type}
              onValueChange={(type) => {
                setFilters({ type });
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label={t("departments.fields.type")}>
                <SelectValue placeholder={t("departments.fields.type")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FILTER_ALL}>{t("filters.all")}</SelectItem>
                {DEPARTMENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`departments.types.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            icon={Network}
            title={t(hasActiveFilter ? "list.noMatches" : "departments.list.emptyTitle")}
            description={t(
              hasActiveFilter ? "list.noMatchesDescription" : "departments.list.emptyDescription",
            )}
          />
        }
      />
      {editTarget && (
        <DepartmentFormDialog
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
          remove={() => Services.schoolOrganization.deleteDepartment(removeTarget.id)}
        />
      )}
    </>
  );
}
