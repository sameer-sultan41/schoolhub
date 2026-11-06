"use client";

import { useTranslations } from "next-intl";
import {
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type PaginationState,
} from "@tanstack/react-table";
import {
  Card,
  CardFooter,
  CardHeader,
  CardHeading,
  CardTable,
  CardTitle,
  CardToolbar,
  DATA_GRID_CARD_CLASSNAME,
  DataGrid,
  DataGridPagination,
  DataGridTable,
  EmptyState,
  ScrollArea,
  ScrollBar,
} from "@schoolhub/ui";
import { FileSearch } from "lucide-react";
import type { ReactNode } from "react";

import { DASHBOARD_DATA_GRID_LABELS } from "@/app/(app)/shell/data-grid-labels";

/** What a report screen hands its table: the page shown (kept in the URL) and its exports. */
export interface ReportGridPaging {
  pagination: PaginationState;
  onPaginationChange: OnChangeFn<PaginationState>;
  /** The export buttons, beside the title. */
  actions?: ReactNode;
}

export interface ReportGridProps<TRow extends object> extends ReportGridPaging {
  /** The report's name: the card's title and the table's caption. */
  title: string;
  /** The empty state's sentence: what the module's report options are. */
  emptyDescription: string;
  rows: TRow[];
  columns: ColumnDef<TRow>[];
}

/**
 * One inline report's grid: its name and row count, its export buttons, the rows and the pager.
 * Paged in the browser (an inline report is at most 1000 rows), in the server's order. The
 * attendance and exam reports narrow their rows on `row.kind` and pass that kind's columns. Its
 * copy is the shared `reports` namespace.
 */
export function ReportGrid<TRow extends object>({
  title,
  emptyDescription,
  rows,
  columns,
  pagination,
  onPaginationChange,
  actions,
}: ReportGridProps<TRow>) {
  const t = useTranslations("reports");

  const table = useReactTable({
    data: rows,
    columns,
    state: { pagination },
    onPaginationChange,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  return (
    <DataGrid
      table={table}
      recordCount={rows.length}
      caption={t("caption", { report: title })}
      tableLayout={{ cellBorder: true }}
      labels={DASHBOARD_DATA_GRID_LABELS}
      emptyState={
        <EmptyState icon={FileSearch} title={t("emptyTitle")} description={emptyDescription} />
      }
    >
      <Card className={DATA_GRID_CARD_CLASSNAME}>
        <CardHeader className="flex flex-wrap items-center gap-2.5 py-3.5">
          <CardHeading>
            <CardTitle>{title}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("rowCount", { count: rows.length })}</p>
          </CardHeading>
          {actions && <CardToolbar>{actions}</CardToolbar>}
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
  );
}
