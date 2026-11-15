"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@schoolhub/ui";
import { BookOpen } from "lucide-react";

import { FilterSelect } from "@/components/filter-select";
import { SearchInput } from "@/components/search-input";
import { SUBJECT_KEYS } from "@/features/school/school-permissions";
import { RemoveRecordDialog } from "@/features/school/shared/remove-record-dialog";
import { StructureGridCard } from "@/features/school/shared/structure-grid-card";
import { StructureStatusFilter } from "@/features/school/shared/structure-status";
import { useStructureList } from "@/features/school/shared/use-structure-list";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useDepartments } from "@/hooks/use-reference-data";
import { hasPermission } from "@/lib/permissions";
import { Services, type SubjectRecord } from "@/services";
import {
  STRUCTURE_STATUS,
  SUBJECT_DEFAULT_SORTING,
  SUBJECT_PAGE_RESOURCE,
  SUBJECT_SORT_FIELD,
  SUBJECT_SORTABLE_IDS,
  SUBJECT_TYPES,
  SUBJECT_URL_FILTERS,
} from "@/services/modules/school-organization/school-organization-constant";
import {
  structureStatusToIsActive,
  typeFilterToSubjectType,
} from "@/services/modules/school-organization/school-organization-helper";
import { useSubjectColumns } from "./subject-columns";
import { SubjectFormDialog } from "./subject-form-dialog";

function toFilterQuery(filters: { department: string; type: string; status: string }) {
  return {
    departmentId: filters.department || undefined,
    subjectType: typeFilterToSubjectType(filters.type),
    isActive: structureStatusToIsActive(filters.status),
  };
}

/**
 * The school's subject catalogue, server paginated, sorted and searched, filtered by department,
 * type and status, with its edit and remove dialogs. The view state lives in the URL.
 */
export function SubjectsTable() {
  const t = useTranslations("school");
  const [editTarget, setEditTarget] = useState<SubjectRecord | null>(null);
  const [removeTarget, setRemoveTarget] = useState<SubjectRecord | null>(null);

  const { data: currentUser } = useCurrentUser();
  const canUpdate = hasPermission(currentUser, SUBJECT_KEYS.update);
  const canDelete = hasPermission(currentUser, SUBJECT_KEYS.delete);
  const departmentsQuery = useDepartments();
  const typeOptions = useMemo(
    () => SUBJECT_TYPES.map((type) => ({ id: type, name: t(`subjects.types.${type}`) })),
    [t],
  );

  const handleEdit = useCallback((record: SubjectRecord) => {
    setEditTarget(record);
  }, []);
  const handleRemove = useCallback((record: SubjectRecord) => {
    setRemoveTarget(record);
  }, []);
  const columns = useSubjectColumns(
    departmentsQuery.data,
    canUpdate,
    canDelete,
    handleEdit,
    handleRemove,
  );

  const list = useStructureList({
    resource: SUBJECT_PAGE_RESOURCE,
    columns,
    urlFilters: SUBJECT_URL_FILTERS,
    sortField: SUBJECT_SORT_FIELD,
    sortableIds: SUBJECT_SORTABLE_IDS,
    defaultSorting: SUBJECT_DEFAULT_SORTING,
    showActions: canUpdate || canDelete,
    toFilterQuery,
    fetchPage: Services.schoolOrganization.fetchSubjectPage,
  });
  const { filters, setFilters } = list;
  const hasActiveFilter =
    list.search !== "" ||
    filters.department !== "" ||
    filters.type !== "" ||
    filters.status !== STRUCTURE_STATUS.all;

  return (
    <>
      <StructureGridCard
        table={list.table}
        query={list.query}
        totalCount={list.totalCount}
        isStalePage={list.isStalePage}
        caption={t("subjects.list.caption")}
        loadErrorMessage={t("subjects.list.loadError")}
        filters={
          <>
            <SearchInput
              value={list.searchInput}
              onChange={list.setSearchInput}
              ariaLabel={t("filters.search")}
              placeholder={t("subjects.list.searchPlaceholder")}
              clearLabel={t("filters.clearSearch")}
            />
            <FilterSelect
              label={t("subjects.fields.department")}
              allLabel={t("filters.all")}
              value={filters.department}
              onChange={(department) => {
                setFilters({ department });
              }}
              options={departmentsQuery.data ?? []}
            />
            <FilterSelect
              label={t("subjects.fields.type")}
              allLabel={t("filters.all")}
              value={filters.type}
              onChange={(type) => {
                setFilters({ type });
              }}
              options={typeOptions}
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
            icon={BookOpen}
            title={t(hasActiveFilter ? "list.noMatches" : "subjects.list.emptyTitle")}
            description={t(
              hasActiveFilter ? "list.noMatchesDescription" : "subjects.list.emptyDescription",
            )}
          />
        }
      />
      {editTarget && (
        <SubjectFormDialog
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
          remove={() => Services.schoolOrganization.deleteSubject(removeTarget.id)}
        />
      )}
    </>
  );
}
