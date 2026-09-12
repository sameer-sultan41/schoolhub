import type { DataGridLabels } from "@schoolhub/ui";

// Neither of this shell's `DataGrid` consumers (the dashboard's Teams widget, the
// `/staff` directory) has i18n wiring yet, so these are the one place with
// hardcoded English strings — @schoolhub/ui's DataGrid requires them explicitly
// rather than defaulting, precisely so a real i18n consumer can never forget to
// supply a translation.
export const DASHBOARD_DATA_GRID_LABELS: DataGridLabels = {
  sortAscending: (column) => `Sort ${column} ascending`,
  sortDescending: (column) => `Sort ${column} descending`,
  pinToStart: "Pin to start",
  pinToEnd: "Pin to end",
  unpinColumn: (column) => `Unpin ${column}`,
  moveToStart: "Move to start",
  moveToEnd: "Move to end",
  dragToReorderColumn: "Drag to reorder column",
  dragToReorderRow: "Drag to reorder row",
  resizeColumn: (column) => `Resize ${column} column`,
  columnsMenuLabel: "Columns",
  columnsMenuTitle: "Toggle columns",
  rowsPerPage: "Rows per page",
  pageRangeSummary: ({ from, to, count }) => `${from}-${to} of ${count}`,
  previousPage: "Previous page",
  nextPage: "Next page",
  goToPage: (page) => `Go to page ${page}`,
  morePages: "More pages",
  paginationNav: "Pagination",
};
