"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@schoolhub/ui";
import { Layers } from "lucide-react";

import { FilterSelect } from "@/components/filter-select";
import { PagedGridCard } from "@/components/paged-grid-card";
import { SearchInput } from "@/components/search-input";
import { useCurrentUser } from "@/hooks/use-current-user";
import { usePagedList } from "@/hooks/use-paged-list";
import { hasPermission } from "@/lib/permissions";
import { Services, type PlanPageQuery, type PlanRecord } from "@/services";
import {
  PLAN_ACTIVITY,
  PLAN_DEFAULT_SORTING,
  PLAN_LIST_RESOURCE,
  PLAN_SORT_FIELD,
  PLAN_SORTABLE_IDS,
  PLAN_URL_FILTERS,
  PLATFORM_ACTIONS_COLUMN_ID,
  PLATFORM_QUERY_MODULE,
} from "@/services/modules/platform/platform-constant";
import { activityToIsActive } from "@/services/modules/platform/platform-helper";
import { PLATFORM_KEYS } from "@/features/platform/platform-permissions";
import { usePlanColumns } from "./plan-columns";
import { PlanFormDialog } from "./plan-form-dialog";
import { RetirePlanDialog } from "./retire-plan-dialog";

function toFilterQuery(filters: { activity: string }) {
  return { isActive: activityToIsActive(filters.activity) };
}

/** The plan catalog, server paginated, with its edit and retire dialogs; the view is in the URL
 * (ADR-0024). Active plans show by default. */
export function PlansTable() {
  const t = useTranslations("platform");
  const [editTarget, setEditTarget] = useState<PlanRecord | null>(null);
  const [retireTarget, setRetireTarget] = useState<PlanRecord | null>(null);

  const { data: user } = useCurrentUser();
  const canEdit = hasPermission(user, PLATFORM_KEYS.planUpdate);
  const canRetire = hasPermission(user, PLATFORM_KEYS.planDelete);

  const handleEdit = useCallback((plan: PlanRecord) => {
    setEditTarget(plan);
  }, []);
  const handleRetire = useCallback((plan: PlanRecord) => {
    setRetireTarget(plan);
  }, []);
  const columns = usePlanColumns(canEdit, canRetire, handleEdit, handleRetire);

  const list = usePagedList<PlanRecord, "activity", PlanPageQuery>({
    queryModule: PLATFORM_QUERY_MODULE,
    resource: PLAN_LIST_RESOURCE,
    columns,
    urlFilters: PLAN_URL_FILTERS,
    sortField: PLAN_SORT_FIELD,
    sortableIds: PLAN_SORTABLE_IDS,
    defaultSorting: PLAN_DEFAULT_SORTING,
    actionsColumnId: PLATFORM_ACTIONS_COLUMN_ID,
    showActions: canEdit || canRetire,
    toFilterQuery,
    fetchPage: Services.platform.fetchPlanPage,
  });
  const hasActiveFilter = list.search !== "" || list.filters.activity !== PLAN_ACTIVITY.active;

  return (
    <>
      <PagedGridCard
        table={list.table}
        query={list.query}
        totalCount={list.totalCount}
        isStalePage={list.isStalePage}
        caption={t("plans.list.caption")}
        loadErrorMessage={t("plans.list.loadError")}
        filters={
          <>
            <SearchInput
              value={list.searchInput}
              onChange={list.setSearchInput}
              ariaLabel={t("filters.search")}
              placeholder={t("plans.list.searchPlaceholder")}
              clearLabel={t("filters.clearSearch")}
            />
            <FilterSelect
              label={t("plans.fields.status")}
              value={list.filters.activity}
              onChange={(activity) => {
                list.setFilters({ activity: activity || PLAN_ACTIVITY.all });
              }}
              options={[
                { id: PLAN_ACTIVITY.active, name: t("plans.active") },
                { id: PLAN_ACTIVITY.retired, name: t("plans.retired") },
                { id: PLAN_ACTIVITY.all, name: t("filters.all") },
              ]}
            />
          </>
        }
        emptyState={
          <EmptyState
            icon={Layers}
            title={t(hasActiveFilter ? "list.noMatches" : "plans.list.emptyTitle")}
            description={t(
              hasActiveFilter ? "list.noMatchesDescription" : "plans.list.emptyDescription",
            )}
          />
        }
      />
      {editTarget && (
        <PlanFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          plan={editTarget}
        />
      )}
      {retireTarget && (
        <RetirePlanDialog
          plan={retireTarget}
          onOpenChange={(open) => {
            if (!open) setRetireTarget(null);
          }}
        />
      )}
    </>
  );
}
