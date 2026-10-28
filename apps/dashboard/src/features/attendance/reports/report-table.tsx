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
import type { InlineReport } from "@/services";
import { rowsOfKind } from "@/services/modules/attendance-reports/attendance-reports-helper";
import { useReportColumns } from "./report-columns";

export interface ReportTableProps {
  report: InlineReport;
  /** The page shown, kept in the URL. */
  pagination: PaginationState;
  onPaginationChange: OnChangeFn<PaginationState>;
  /** The export buttons, beside the title. */
  actions?: ReactNode;
}

/**
 * An inline report's rows in a table whose columns depend on its kind: the rows are narrowed on
 * `row.kind`, so each kind's columns read only the fields its rows carry. Paged in the browser
 * (an inline report is at most 1000 rows), in the server's order.
 */
export function ReportTable({ report, ...grid }: ReportTableProps) {
  const columns = useReportColumns();
  const { rows } = report;

  switch (report.kind) {
    case "daily-register":
      return (
        <ReportGrid
          kind={report.kind}
          rows={rowsOfKind(rows, "daily-register")}
          columns={columns["daily-register"]}
          {...grid}
        />
      );
    case "student-summary":
      return (
        <ReportGrid
          kind={report.kind}
          rows={rowsOfKind(rows, "student-summary")}
          columns={columns["student-summary"]}
          {...grid}
        />
      );
    case "defaulters":
      return (
        <ReportGrid
          kind={report.kind}
          rows={rowsOfKind(rows, "defaulters")}
          columns={columns.defaulters}
          {...grid}
        />
      );
    case "student-late-arrivals":
      return (
        <ReportGrid
          kind={report.kind}
          rows={rowsOfKind(rows, "student-late-arrivals")}
          columns={columns["student-late-arrivals"]}
          {...grid}
        />
      );
    case "staff-punctuality":
      return (
        <ReportGrid
          kind={report.kind}
          rows={rowsOfKind(rows, "staff-punctuality")}
          columns={columns["staff-punctuality"]}
          {...grid}
        />
      );
    case "leave":
      return (
        <ReportGrid
          kind={report.kind}
          rows={rowsOfKind(rows, "leave")}
          columns={columns.leave}
          {...grid}
        />
      );
  }
}

interface ReportGridProps<TRow extends object> extends Omit<ReportTableProps, "report"> {
  kind: InlineReport["kind"];
  rows: TRow[];
  columns: ColumnDef<TRow>[];
}

/** One kind's grid: the report's name and row count, its export buttons, the rows, the pager. */
function ReportGrid<TRow extends object>({
  kind,
  rows,
  columns,
  pagination,
  onPaginationChange,
  actions,
}: ReportGridProps<TRow>) {
  const t = useTranslations("attendance");
  const title = t(`reports.kinds.${kind}`);

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
      caption={t("reports.caption", { report: title })}
      tableLayout={{ cellBorder: true }}
      labels={DASHBOARD_DATA_GRID_LABELS}
      emptyState={
        <EmptyState
          icon={FileSearch}
          title={t("reports.emptyTitle")}
          description={t("reports.emptyDescription")}
        />
      }
    >
      <Card className={DATA_GRID_CARD_CLASSNAME}>
        <CardHeader className="flex flex-wrap items-center gap-2.5 py-3.5">
          <CardHeading>
            <CardTitle>{title}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t("reports.rowCount", { count: rows.length })}
            </p>
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
