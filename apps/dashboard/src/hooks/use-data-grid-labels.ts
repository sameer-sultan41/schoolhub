"use client";

import { useTranslations } from "next-intl";
import type { DataGridLabels } from "@schoolhub/ui";

/**
 * Every `DataGrid` string comes from the `common` namespace — none of it names the
 * entity a given screen lists, unlike the select-column checkboxes
 * (`createSelectColumn`'s own `selectAll`/`selectRow`), which do ("Select all students")
 * and so stay a per-screen call rather than living here.
 */
export function useDataGridLabels(): DataGridLabels {
  const t = useTranslations("common");

  return {
    sortAscending: (column) => t("sortAscending", { column }),
    sortDescending: (column) => t("sortDescending", { column }),
    pinToStart: t("pinToStart"),
    pinToEnd: t("pinToEnd"),
    unpinColumn: (column) => t("unpinColumn", { column }),
    moveToStart: t("moveToStart"),
    moveToEnd: t("moveToEnd"),
    dragToReorderColumn: t("dragToReorderColumn"),
    dragToReorderRow: t("dragToReorderRow"),
    resizeColumn: (column) => t("resizeColumn", { column }),
    columnsMenuLabel: t("columns"),
    columnsMenuTitle: t("toggleColumns"),
    rowsPerPage: t("rowsPerPage"),
    pageRangeSummary: ({ from, to, count }) => t("pageRange", { from, to, count }),
    previousPage: t("previousPage"),
    nextPage: t("nextPage"),
    goToPage: (page) => t("goToPage", { page }),
    morePages: t("morePages"),
    paginationNav: t("pagination"),
  };
}
