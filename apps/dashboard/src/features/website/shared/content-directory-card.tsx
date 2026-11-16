"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Card,
  CardFooter,
  CardHeader,
  CardHeading,
  CardTable,
  CardToolbar,
  cn,
  DATA_GRID_CARD_CLASSNAME,
  DataGrid,
  DataGridColumnVisibility,
  DataGridPagination,
  DataGridTable,
  EmptyState,
  ScrollArea,
  ScrollBar,
} from "@schoolhub/ui";
import type { LucideIcon } from "lucide-react";

import { DASHBOARD_DATA_GRID_LABELS } from "@/app/(app)/shell/data-grid-labels";
import { FilterSelect } from "@/components/filter-select";
import { LoadErrorCard } from "@/components/load-error-card";
import { SearchInput } from "@/components/search-input";
import { enumLabel } from "@/lib/enum-label";
import { FILTER_ALL } from "@/lib/constants";
import { resolveErrorMessage } from "@/lib/error-message";
import { WEBSITE_CONTENT_STATUSES } from "@/services/shared/website-content";
import { CONTENT_STATUS_LABEL_KEY } from "./content-status-badge";
import type { ContentDirectory } from "./use-content-directory";

/** What one kind of content says in its directory; the search box, status filter and the
 * "no matches" state are shared (`website.directory`). */
export interface ContentDirectoryLabels {
  caption: string;
  searchPlaceholder: string;
  loadError: string;
  emptyTitle: string;
  emptyDescription: string;
}

export interface ContentDirectoryCardProps<T extends { id: string }> {
  directory: ContentDirectory<T>;
  labels: ContentDirectoryLabels;
  icon: LucideIcon;
  /** The dialogs and sheet the caller mounts beside the grid. */
  children?: ReactNode;
}

/**
 * A news, events or albums directory: search and status filter, the server-paginated grid
 * with its column picker, and the load error (with the server's reason) or empty state.
 */
export function ContentDirectoryCard<T extends { id: string }>({
  directory,
  labels,
  icon,
  children,
}: ContentDirectoryCardProps<T>) {
  const t = useTranslations("website");
  const tErrors = useTranslations("errors");
  const { table, query, totalCount, isStalePage, hasActiveFilter } = directory;

  if (query.isError && !isStalePage) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(query.error, tErrors, labels.loadError)}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  return (
    <>
      <DataGrid
        table={table}
        recordCount={totalCount}
        isLoading={query.isPending || isStalePage}
        caption={labels.caption}
        tableLayout={{ cellBorder: true, columnsVisibility: true }}
        labels={DASHBOARD_DATA_GRID_LABELS}
        emptyState={
          <EmptyState
            icon={icon}
            title={hasActiveFilter ? t("directory.noMatches") : labels.emptyTitle}
            description={
              hasActiveFilter ? t("directory.noMatchesDescription") : labels.emptyDescription
            }
          />
        }
      >
        <Card className={DATA_GRID_CARD_CLASSNAME}>
          <CardHeader className="flex flex-wrap items-center gap-2.5 py-3.5">
            <CardHeading>
              <div className="flex flex-wrap items-center gap-2.5">
                <SearchInput
                  value={directory.searchInput}
                  onChange={directory.setSearchInput}
                  ariaLabel={t("directory.search")}
                  placeholder={labels.searchPlaceholder}
                  clearLabel={t("directory.clearSearch")}
                />
                <FilterSelect
                  label={t("directory.status")}
                  allLabel={t("directory.allStatuses")}
                  value={directory.status === FILTER_ALL ? "" : directory.status}
                  onChange={directory.setStatus}
                  options={WEBSITE_CONTENT_STATUSES.map((status) => ({
                    id: status,
                    name: enumLabel(t, CONTENT_STATUS_LABEL_KEY, status),
                  }))}
                />
              </div>
            </CardHeading>
            <CardToolbar>
              <DataGridColumnVisibility />
            </CardToolbar>
          </CardHeader>
          <div className={cn("min-w-0 transition-opacity", query.isFetching && "opacity-50")}>
            <ScrollArea>
              <CardTable>
                <DataGridTable />
              </CardTable>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>
          <CardFooter className="border-t-0">
            <DataGridPagination />
          </CardFooter>
        </Card>
      </DataGrid>
      {children}
    </>
  );
}
