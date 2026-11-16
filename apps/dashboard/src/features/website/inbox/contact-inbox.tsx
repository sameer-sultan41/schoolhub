"use client";

import { useCallback, useState } from "react";
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
import { Inbox } from "lucide-react";

import { DASHBOARD_DATA_GRID_LABELS } from "@/app/(app)/shell/data-grid-labels";
import { DateRangeInputs } from "@/components/date-range-inputs";
import { FilterSelect } from "@/components/filter-select";
import { LoadErrorCard } from "@/components/load-error-card";
import { SearchInput } from "@/components/search-input";
import { useCurrentUser } from "@/hooks/use-current-user";
import { FILTER_ALL } from "@/lib/constants";
import { enumLabel } from "@/lib/enum-label";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import type { ContactSubmissionRecord } from "@/services";
import { CONTACT_SUBMISSION_STATUSES } from "@/services/modules/website/contact-submissions/contact-submissions-constant";
import { useContactColumns } from "./contact-columns";
import { ContactDetailSheet } from "./contact-detail-sheet";
import { CONTACT_STATUS_LABEL_KEY } from "./contact-status-badge";
import { useContactInbox } from "./use-contact-inbox";

/**
 * `/website/inbox`: the website's contact messages, newest first, searched and filtered by status
 * and the day they arrived, with the view state in the URL (ADR-0024). A sender opens the message;
 * triage lives in its sheet, mounted only while open.
 */
export function ContactInbox() {
  const t = useTranslations("website.inbox");
  const tDirectory = useTranslations("website.directory");
  const tErrors = useTranslations("errors");
  const { data: user } = useCurrentUser();
  const canUpdate = hasPermission(user, "website.contact-submission.update");
  const [openId, setOpenId] = useState<string | null>(null);

  // Stable, so the columns' own `useMemo` skips a rebuild on a keystroke or a page change.
  const handleOpen = useCallback((submission: ContactSubmissionRecord) => {
    setOpenId(submission.id);
  }, []);
  const columns = useContactColumns(handleOpen);
  const inbox = useContactInbox(columns);
  const { table, query, totalCount, isStalePage, hasActiveFilter, filters } = inbox;

  if (query.isError && !isStalePage) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(query.error, tErrors, t("list.loadError"))}
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
        caption={t("list.caption")}
        tableLayout={{ cellBorder: true, columnsVisibility: true }}
        labels={DASHBOARD_DATA_GRID_LABELS}
        emptyState={
          <EmptyState
            icon={Inbox}
            title={hasActiveFilter ? t("list.noMatches") : t("list.emptyTitle")}
            description={
              hasActiveFilter ? t("list.noMatchesDescription") : t("list.emptyDescription")
            }
          />
        }
      >
        <Card className={DATA_GRID_CARD_CLASSNAME}>
          <CardHeader className="flex flex-wrap items-center gap-2.5 py-3.5">
            <CardHeading>
              <div className="flex flex-wrap items-center gap-2.5">
                <SearchInput
                  value={inbox.searchInput}
                  onChange={inbox.setSearchInput}
                  ariaLabel={tDirectory("search")}
                  placeholder={t("list.searchPlaceholder")}
                  clearLabel={tDirectory("clearSearch")}
                />
                <FilterSelect
                  label={t("filters.status")}
                  allLabel={t("filters.allStatuses")}
                  value={filters.status === FILTER_ALL ? "" : filters.status}
                  onChange={(status) => {
                    inbox.setFilters({ status });
                  }}
                  options={CONTACT_SUBMISSION_STATUSES.map((status) => ({
                    id: status,
                    name: enumLabel(t, CONTACT_STATUS_LABEL_KEY, status),
                  }))}
                />
                <DateRangeInputs
                  from={filters.from}
                  to={filters.to}
                  fromLabel={t("filters.from")}
                  toLabel={t("filters.to")}
                  onChange={inbox.setFilters}
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
      {openId && (
        <ContactDetailSheet
          submissionId={openId}
          canUpdate={canUpdate}
          onOpenChange={(open) => {
            if (!open) setOpenId(null);
          }}
        />
      )}
    </>
  );
}
