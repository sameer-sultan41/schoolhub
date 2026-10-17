"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type PaginationState,
} from "@tanstack/react-table";
import {
  Card,
  CardFooter,
  CardHeader,
  CardTable,
  DATA_GRID_CARD_CLASSNAME,
  DataGrid,
  DataGridPagination,
  DataGridTable,
  EmptyState,
  ScrollArea,
  ScrollBar,
} from "@schoolhub/ui";
import { Users } from "lucide-react";

import { DASHBOARD_DATA_GRID_LABELS } from "@/app/(app)/shell/data-grid-labels";
import { SearchInput } from "@/components/search-input";
import { useCurrentUser } from "@/hooks/use-current-user";
import { DEFAULT_LIST_PAGE_SIZE } from "@/lib/constants";
import { hasPermission } from "@/lib/permissions";
import type { PromotionBatchDetail, PromotionDecisionRecord } from "@/services";
import {
  PROMOTION_DECISION_EDIT_PERMISSION,
  PROMOTION_STATUS,
} from "@/services/modules/promotions/promotions-constant";
import { filterDecisionsBySearch } from "@/services/modules/promotions/promotions-helper";
import { PromotionDecisionDialog } from "./promotion-decision-dialog";
import { usePromotionDecisionColumns } from "./promotion-decision-columns";

export interface PromotionDecisionTableProps {
  batch: PromotionBatchDetail;
}

/**
 * Every student's decision in the batch. The API sends them all at once, so they are searched
 * and paged here rather than in the URL: this is one section of a page, not a list of its own.
 * Edit (a dialog) is offered only while the batch is a draft and to a viewer who may update it.
 */
export function PromotionDecisionTable({ batch }: PromotionDecisionTableProps) {
  const t = useTranslations("academics");
  const { data: currentUser } = useCurrentUser();
  const [search, setSearch] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_LIST_PAGE_SIZE,
  });
  const [editing, setEditing] = useState<PromotionDecisionRecord | null>(null);

  const canEdit =
    batch.status === PROMOTION_STATUS.draft &&
    hasPermission(currentUser, PROMOTION_DECISION_EDIT_PERMISSION);
  const handleEdit = useCallback((row: PromotionDecisionRecord) => {
    setEditing(row);
  }, []);
  const columns = usePromotionDecisionColumns(canEdit, handleEdit);

  const rows = useMemo(
    () => filterDecisionsBySearch(batch.decisions, search),
    [batch.decisions, search],
  );
  const hasSearch = search.trim() !== "";

  const table = useReactTable({
    data: rows,
    columns,
    state: { pagination },
    onPaginationChange: setPagination,
    // A refetch after an edit hands over new rows; the reviewer stays on their page. A search
    // starts again from the first page itself.
    autoResetPageIndex: false,
    getRowId: (row) => row.student_id,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  return (
    <>
      <DataGrid
        table={table}
        recordCount={rows.length}
        caption={t("promotions.review.caption")}
        tableLayout={{ cellBorder: true }}
        labels={DASHBOARD_DATA_GRID_LABELS}
        emptyState={
          <EmptyState
            icon={Users}
            title={t(hasSearch ? "promotions.review.noMatches" : "promotions.review.emptyTitle")}
            description={t(
              hasSearch
                ? "promotions.review.noMatchesDescription"
                : "promotions.review.emptyDescription",
            )}
          />
        }
      >
        <Card className={DATA_GRID_CARD_CLASSNAME}>
          <CardHeader className="flex flex-wrap items-center gap-2.5 py-3.5">
            <SearchInput
              value={search}
              onChange={(value) => {
                setSearch(value);
                table.setPageIndex(0);
              }}
              ariaLabel={t("promotions.searchStudents")}
              placeholder={t("promotions.searchStudentsPlaceholder")}
              clearLabel={t("filters.clearSearch")}
            />
          </CardHeader>
          <ScrollArea>
            <CardTable>
              <DataGridTable />
            </CardTable>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
          <CardFooter className="border-t-0">
            <DataGridPagination />
          </CardFooter>
        </Card>
      </DataGrid>
      {editing && (
        <PromotionDecisionDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          batchId={batch.batch_id}
          decision={editing}
        />
      )}
    </>
  );
}
