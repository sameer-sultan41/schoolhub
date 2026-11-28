"use client";

import { useTranslations } from "next-intl";
import { EmptyState } from "@schoolhub/ui";
import { School } from "lucide-react";

import { PagedGridCard } from "@/components/paged-grid-card";
import { FilterSelect } from "@/components/filter-select";
import { SearchInput } from "@/components/search-input";
import { usePagedList } from "@/hooks/use-paged-list";
import { FILTER_ALL } from "@/lib/constants";
import { Services, type TenantPageQuery, type TenantRecord } from "@/services";
import {
  PLATFORM_ACTIONS_COLUMN_ID,
  PLATFORM_QUERY_MODULE,
  TENANT_DEFAULT_SORTING,
  TENANT_LIST_RESOURCE,
  TENANT_SORT_FIELD,
  TENANT_SORTABLE_IDS,
  TENANT_STATUSES,
  TENANT_URL_FILTERS,
} from "@/services/modules/platform/platform-constant";
import { statusFilterToStatus } from "@/services/modules/platform/platform-helper";
import { useTenantStatusLabel } from "@/features/platform/shared/platform-badges";
import { useTenantColumns } from "./tenant-columns";

function toFilterQuery(filters: { status: string }) {
  return { status: statusFilterToStatus(filters.status) };
}

/** Every school on the platform, server paginated, sorted, searched and filtered by status, the
 * view in the URL (ADR-0024). A row's name opens the school's page. */
export function TenantsTable() {
  const t = useTranslations("platform");
  const statusLabel = useTenantStatusLabel();
  const columns = useTenantColumns();

  const list = usePagedList<TenantRecord, "status", TenantPageQuery>({
    queryModule: PLATFORM_QUERY_MODULE,
    resource: TENANT_LIST_RESOURCE,
    columns,
    urlFilters: TENANT_URL_FILTERS,
    sortField: TENANT_SORT_FIELD,
    sortableIds: TENANT_SORTABLE_IDS,
    defaultSorting: TENANT_DEFAULT_SORTING,
    actionsColumnId: PLATFORM_ACTIONS_COLUMN_ID,
    showActions: false,
    toFilterQuery,
    fetchPage: Services.platform.fetchTenantPage,
  });
  const hasActiveFilter = list.search !== "" || list.filters.status !== FILTER_ALL;

  return (
    <PagedGridCard
      table={list.table}
      query={list.query}
      totalCount={list.totalCount}
      isStalePage={list.isStalePage}
      caption={t("tenants.list.caption")}
      loadErrorMessage={t("tenants.list.loadError")}
      filters={
        <>
          <SearchInput
            value={list.searchInput}
            onChange={list.setSearchInput}
            ariaLabel={t("filters.search")}
            placeholder={t("tenants.list.searchPlaceholder")}
            clearLabel={t("filters.clearSearch")}
          />
          <FilterSelect
            label={t("tenants.fields.status")}
            allLabel={t("filters.allStatuses")}
            value={list.filters.status === FILTER_ALL ? "" : list.filters.status}
            onChange={(status) => {
              list.setFilters({ status: status || FILTER_ALL });
            }}
            options={TENANT_STATUSES.map((status) => ({ id: status, name: statusLabel(status) }))}
          />
        </>
      }
      emptyState={
        <EmptyState
          icon={School}
          title={t(hasActiveFilter ? "list.noMatches" : "tenants.list.emptyTitle")}
          description={t(
            hasActiveFilter ? "list.noMatchesDescription" : "tenants.list.emptyDescription",
          )}
        />
      }
    />
  );
}
