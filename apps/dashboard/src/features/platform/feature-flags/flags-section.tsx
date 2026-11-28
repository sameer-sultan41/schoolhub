"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, DataGridColumnHeader, EmptyState, Skeleton } from "@schoolhub/ui";
import { Flag } from "lucide-react";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { PagedGridCard } from "@/components/paged-grid-card";
import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { SearchInput } from "@/components/search-input";
import { useCurrentUser } from "@/hooks/use-current-user";
import { usePagedList, type PagedListQuery } from "@/hooks/use-paged-list";
import { formatLastUpdated } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import { Services, type FeatureFlagRecord } from "@/services";
import {
  FLAG_DEFAULT_SORTING,
  FLAG_LIST_RESOURCE,
  FLAG_SORT_FIELD,
  FLAG_SORTABLE_IDS,
  FLAG_URL_FILTERS,
  PLATFORM_ACTIONS_COLUMN_ID,
  PLATFORM_QUERY_MODULE,
} from "@/services/modules/platform/platform-constant";
import { PLATFORM_KEYS } from "@/features/platform/platform-permissions";
import { FlagEditDialog } from "./flag-edit-dialog";

function useFlagColumns(
  canEdit: boolean,
  onEdit: (flag: FeatureFlagRecord) => void,
): ColumnDef<FeatureFlagRecord>[] {
  const t = useTranslations("platform.flags");
  return useMemo<ColumnDef<FeatureFlagRecord>[]>(
    () => [
      {
        id: "key",
        accessorKey: "key",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("key")} />,
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.key}</span>,
        meta: { headerTitle: t("key"), skeleton: <Skeleton className="h-4 w-32" /> },
      },
      {
        id: "description",
        accessorKey: "description",
        enableSorting: false,
        header: () => t("description"),
        meta: { headerTitle: t("description"), skeleton: <Skeleton className="h-4 w-48" /> },
      },
      {
        id: "default",
        accessorKey: "default_enabled",
        enableSorting: false,
        header: () => t("defaultEnabled"),
        cell: ({ row }) => (
          <Badge
            variant={row.original.default_enabled ? "success" : "secondary"}
            appearance="light"
          >
            {t(row.original.default_enabled ? "on" : "off")}
          </Badge>
        ),
        meta: { headerTitle: t("defaultEnabled"), skeleton: <Skeleton className="h-5 w-10" /> },
      },
      {
        id: "killSwitch",
        accessorKey: "is_kill_switch",
        enableSorting: false,
        header: () => t("killSwitch"),
        cell: ({ row }) =>
          row.original.is_kill_switch ? (
            <Badge variant="warning" appearance="light">
              {t("killSwitchOn")}
            </Badge>
          ) : null,
        meta: { headerTitle: t("killSwitch"), skeleton: <Skeleton className="h-5 w-16" /> },
      },
      {
        id: "updated",
        accessorKey: "updated_at",
        enableSorting: false,
        header: () => t("updated"),
        cell: ({ row }) => formatLastUpdated(row.original.updated_at),
        meta: { headerTitle: t("updated"), skeleton: <Skeleton className="h-4 w-20" /> },
      },
      {
        id: PLATFORM_ACTIONS_COLUMN_ID,
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <RowEditRemoveActions
            editLabel={canEdit ? t("editRow", { key: row.original.key }) : undefined}
            onEdit={() => {
              onEdit(row.original);
            }}
          />
        ),
        meta: { skeleton: <Skeleton className="size-7 rounded-full" /> },
      },
    ],
    [t, canEdit, onEdit],
  );
}

function FlagsTable() {
  const t = useTranslations("platform");
  const [editTarget, setEditTarget] = useState<FeatureFlagRecord | null>(null);
  const { data: user } = useCurrentUser();
  const canEdit = hasPermission(user, PLATFORM_KEYS.flagUpdate);
  const handleEdit = useCallback((flag: FeatureFlagRecord) => {
    setEditTarget(flag);
  }, []);
  const columns = useFlagColumns(canEdit, handleEdit);

  const list = usePagedList<FeatureFlagRecord, never, PagedListQuery>({
    queryModule: PLATFORM_QUERY_MODULE,
    resource: FLAG_LIST_RESOURCE,
    columns,
    urlFilters: FLAG_URL_FILTERS,
    sortField: FLAG_SORT_FIELD,
    sortableIds: FLAG_SORTABLE_IDS,
    defaultSorting: FLAG_DEFAULT_SORTING,
    actionsColumnId: PLATFORM_ACTIONS_COLUMN_ID,
    showActions: canEdit,
    toFilterQuery: () => ({}),
    fetchPage: Services.platform.fetchFlagPage,
  });

  return (
    <>
      <PagedGridCard
        table={list.table}
        query={list.query}
        totalCount={list.totalCount}
        isStalePage={list.isStalePage}
        caption={t("flags.caption")}
        loadErrorMessage={t("flags.loadError")}
        filters={
          <SearchInput
            value={list.searchInput}
            onChange={list.setSearchInput}
            ariaLabel={t("filters.search")}
            placeholder={t("flags.searchPlaceholder")}
            clearLabel={t("filters.clearSearch")}
          />
        }
        emptyState={
          <EmptyState
            icon={Flag}
            title={t(list.search ? "list.noMatches" : "flags.emptyTitle")}
            description={t(list.search ? "list.noMatchesDescription" : "flags.emptyDescription")}
          />
        }
      />
      {editTarget && (
        <FlagEditDialog
          flag={editTarget}
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
        />
      )}
    </>
  );
}

/** Every feature flag, with its platform default and kill switch. A school's own overrides are on
 * its page. The table reads the URL, so it sits in a Suspense boundary. */
export function FlagsSection() {
  const t = useTranslations("platform.flags");
  return (
    <div className="space-y-5">
      <Toolbar>
        <ToolbarHeading title={t("title")} description={t("summary")} />
      </Toolbar>
      <Suspense>
        <FlagsTable />
      </Suspense>
    </div>
  );
}
