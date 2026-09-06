import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { DEFAULT_SKELETON_ROW_COUNT, INTERACTIVE_ELEMENT_SELECTOR } from "../lib/constants";
import { cn } from "../lib/cn";
import { Button } from "./button";
import { DataTableColumnsMenu } from "./data-table-columns-menu";
import { Pagination } from "./pagination";
import { Skeleton } from "./skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

export interface DataTableColumn<TRow> {
  /** Stable key, also used as the React key for the cell. */
  id: string;
  header: ReactNode;
  /** Cell renderer. Keep formatting (dates, money) in the caller, not here. */
  cell: (row: TRow) => ReactNode;
  /** Tailwind classes for the cell + header. Presentation only — see `numeric` for figures. */
  className?: string;
  /**
   * Marks the column as figures, and says what job they do. The component picks the
   * treatment from that rather than the caller hand-rolling it, which is how the
   * eight numeric columns across this app ended up with three different spellings.
   *
   * `measure` — a quantity read DOWN the column and compared: weekly periods, a
   * student count. Tabular figures in the numeric face, aligned to the end so digits
   * of the same place value stack and a longer number is visibly larger.
   *
   * `identifier` — digits that name a row rather than measure it: an admission
   * number, a batch id, a date. Same face, because they still want to align, but
   * start-aligned: a reader matches these from their first character, and ranging
   * them right would make a column of mixed-length codes ragged where it is scanned.
   *
   * Alignment is logical, so a measure column sits against the correct edge under
   * Urdu with no second rule.
   */
  numeric?: "measure" | "identifier";
  /**
   * The field name this column sorts by, as the API spells it in `?ordering=`.
   *
   * Presence is what makes the header a sort control, so a column is sortable exactly
   * when the endpoint declares it in `ordering_fields` — the UI cannot offer a sort the
   * server will ignore. Sorting is server-side by necessity: only the current page is in
   * the browser, and reordering 25 of 400 students would look like a sort and be a lie.
   */
  sortKey?: string;
  /** Column header for screen readers when `header` is an icon. */
  srLabel?: string;
  /**
   * Keeps the column out of the show/hide menu.
   *
   * For the two a reader must never lose: the selection checkbox, and the actions
   * column. Hiding either leaves rows that can be looked at and not acted on, with no
   * obvious way back — the menu that hid them is the only clue, and it is at the other
   * end of the toolbar.
   */
  alwaysVisible?: true;
  /**
   * What this column shows while the page is loading. Defaults to a single bar.
   *
   * Worth setting wherever the real cell is not one line of text: a two-line person
   * cell collapsing to one bar makes the table jump by a row's height the moment data
   * arrives, which reads as a glitch rather than as loading.
   */
  skeleton?: ReactNode;
}

/**
 * Rows per page.
 *
 * A native <select> rather than the Radix one used elsewhere: it sits at the very foot
 * of a scrolling page, where a portalled listbox has to decide whether to open upward,
 * and the platform control already gets that right on every device. Six options at most,
 * all short — none of what Radix buys us is in play here.
 */
function PageSizeControl({ pageSize }: { pageSize: DataTablePageSize }) {
  return (
    <label className="flex items-center gap-2">
      <span>{pageSize.label}</span>
      <select
        value={pageSize.value}
        onChange={(event) => {
          pageSize.onChange(Number(event.target.value));
        }}
        className={cn(
          "h-8 rounded-[var(--sh-radius)] border border-border bg-background px-2",
          "text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        )}
      >
        {pageSize.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * `aria-sort` goes on the header CELL, not on the button inside it — the property
 * describes the column, and a screen reader reads it from the cell as it enters.
 */
function ariaSort<TRow>(
  column: DataTableColumn<TRow>,
  sort: DataTableSort | undefined,
): "ascending" | "descending" | "none" | undefined {
  if (!sort || !column.sortKey) return undefined;
  if (sort.activeKey !== column.sortKey) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}

/**
 * A header that sorts. Pressing the active column flips its direction; pressing any
 * other starts it ascending, which is what a first click on a name or a date is taken
 * to mean.
 *
 * The accessible name says what pressing will DO, not what the state is: `aria-sort` on
 * the cell already carries the state, and a button that announces "sorted ascending"
 * leaves the reader to guess what happens if they press it.
 */
function SortButton<TRow>({
  column,
  sort,
}: {
  column: DataTableColumn<TRow>;
  sort: DataTableSort;
}) {
  const isActive = sort.activeKey === column.sortKey;
  const nextDirection: "asc" | "desc" = isActive && sort.direction === "asc" ? "desc" : "asc";
  const name = typeof column.header === "string" ? column.header : (column.srLabel ?? column.id);
  const SortIcon = !isActive ? ArrowUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown;

  return (
    <button
      type="button"
      onClick={() => {
        if (column.sortKey) sort.onChange(column.sortKey, nextDirection);
      }}
      aria-label={
        nextDirection === "asc" ? sort.sortAscendingLabel(name) : sort.sortDescendingLabel(name)
      }
      className={cn(
        "-mx-2 inline-flex items-center gap-1.5 rounded-[var(--sh-radius)] px-2 py-1",
        "hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        isActive && "text-foreground",
      )}
    >
      {column.header}
      {/* Directional once active, so the current order is legible without reading the
          rows. aria-sort on the cell says the same thing to a screen reader; the
          neutral double arrow marks a column as sortable before it has been used. */}
      <SortIcon
        aria-hidden="true"
        className={cn("size-3.5 shrink-0", isActive ? "opacity-100" : "opacity-40")}
      />
    </button>
  );
}

/**
 * A numeric column's treatment, split between its header and its cells.
 *
 * The header takes the alignment but NOT the numeral face: it is a label, and setting
 * it in the mono face puts one header in a different typeface from every other header
 * in the same row, which reads as a mistake rather than as emphasis. Only the figures
 * themselves wear the figures' face.
 */
function numericHeaderClasses<TRow>(column: DataTableColumn<TRow>): string | undefined {
  return column.numeric === "measure" ? "text-end" : undefined;
}

function numericCellClasses<TRow>(column: DataTableColumn<TRow>): string | undefined {
  if (!column.numeric) return undefined;
  return cn("font-numeric tabular-nums", column.numeric === "measure" && "text-end");
}

export interface DataTableSort {
  /** The `sortKey` currently applied, or null when the list is in its default order. */
  activeKey: string | null;
  direction: "asc" | "desc";
  /** Called with the next key and direction; the caller puts them in its query. */
  onChange: (key: string, direction: "asc" | "desc") => void;
  /**
   * Announced on the header button so the control says what pressing it will do.
   * Required — no i18n in this package. Both take the column name as `{column}`.
   */
  sortAscendingLabel: (column: string) => string;
  sortDescendingLabel: (column: string) => string;
}

export interface DataTableCursorPagination {
  mode?: "cursor";
  hasNext: boolean;
  hasPrevious: boolean;
  onNext: () => void;
  onPrevious: () => void;
  nextLabel: string;
  previousLabel: string;
  /**
   * Rendered at the start of the pagination row — "284 students".
   *
   * A slot rather than numbers, because the caller is the only one that can compute
   * them: a total is opt-in per cursor endpoint (CountedCursorPagination), so a table
   * that assumed one would print "of NaN" on every list that does not count.
   */
  summary?: ReactNode;
  /** Rows per page. Omit and the control is not rendered. */
  pageSize?: DataTablePageSize;
}

export interface DataTablePagePagination {
  mode: "pages";
  /** 1-based, matching the API's `?page=`. */
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /**
   * Rendered beside the pager — "11 - 20 of 243".
   *
   * Still a slot: the arithmetic is trivial but the WORDING is not, and this package
   * has no i18n. The caller already holds the translated message and the page size.
   */
  summary?: ReactNode;
  pageSize?: DataTablePageSize;
  /** Labels for the pager. Required — no i18n in this package. */
  label: string;
  previousLabel: string;
  nextLabel: string;
  goToPageLabel: (page: number) => string;
  morePagesLabel: string;
}

export interface DataTableColumnVisibility {
  /** Column ids currently hidden. */
  hidden: string[];
  onChange: (hidden: string[]) => void;
  /** Labels the trigger and the menu. Required — no i18n in this package. */
  triggerLabel: string;
  title: string;
}

export interface DataTablePageSize {
  value: number;
  options: number[];
  onChange: (size: number) => void;
  /** Labels the control. Required — no i18n in this package. */
  label: string;
}

export interface DataTableProps<TRow> {
  columns: DataTableColumn<TRow>[];
  rows: TRow[];
  /** Stable row identity — never the array index. */
  getRowId: (row: TRow) => string;
  caption?: string;
  isLoading?: boolean;
  /**
   * Rendered instead of rows when the (loaded) result set is empty.
   *
   * Required, not defaulted to an English string — this package has no i18n of its own,
   * so a silent fallback here would always ship untranslated.
   *
   * `ReactElement`, not `ReactNode`: this component deliberately renders it unwrapped, so
   * a bare string would land as unstyled text where every other list shows an
   * `<EmptyState>` — an icon, a heading, what to do next, and the action if the viewer
   * holds it. Requiring an element makes that a compile error rather than a screen
   * someone notices later.
   */
  emptyState: ReactElement;
  /**
   * Rendered inside the card, between the filter row and the header, when the query
   * failed. Optional: a table with an error has
   * nothing to show, but the caller owns the error envelope (`error.code`, `details`) and
   * how it reads, so this is a slot rather than an error object.
   *
   * Before this existed every screen hand-rolled the same `<Alert variant="danger">`
   * block above its own table — three copies of it, and none of them reachable from here.
   */
  error?: ReactNode;
  /**
   * Show/hide columns. Omit and every column is always rendered.
   *
   * The hidden set lives in the caller so it can go in the URL alongside the filters —
   * a column layout someone arranged is part of the view they would send to a
   * colleague. `alwaysVisible` columns are never offered.
   */
  columnVisibility?: DataTableColumnVisibility;
  /**
   * Server-side sorting. Omit and the headers stay plain text.
   *
   * The table renders the control and reports the intent; it never reorders `rows`
   * itself. See `DataTableColumn.sortKey`.
   */
  sort?: DataTableSort;
  /**
   * `comfortable` (the default) is today's spacing. `compact` tightens the row height for
   * wide tables — students, staff, allocations — where the reader is scanning down one
   * column rather than reading each row.
   */
  density?: "comfortable" | "compact";
  /**
   * The filter row, rendered inside the table's own card above the header.
   *
   * A filter bar floating as a separate block above a separately-bordered table is two
   * objects where a reader sees one thing — they narrow the list and then look at the
   * list. Putting them in one frame is what the reference dashboards do, and it is why
   * `Table` grew a `frame` prop: the card owns the border now.
   *
   * A slot rather than a `FilterBar` prop because this package does not know about the
   * dashboard's filter component, and two screens put a date range in the same row.
   */
  toolbar?: ReactNode;
  onRowClick?: (row: TRow) => void;
  /**
   * How this list is paged, in whichever of the two shapes its endpoint supports.
   *
   * A discriminated union rather than one shape with optional halves: a cursor endpoint
   * genuinely cannot supply a page number — a cursor knows what comes next, never where
   * it is — so a single shape would have made `page` optional and pushed a runtime
   * check into every caller. Omitting `mode` keeps the cursor behaviour, so the lists
   * that still page by cursor did not have to change.
   */
  pagination?: DataTableCursorPagination | DataTablePagePagination;
  className?: string;
}

/**
 * Presentational table over an already-fetched page of rows.
 *
 * Deliberately holds no data-fetching logic: the caller owns the TanStack Query
 * (including the cursor) so the same table works for server- and client-fetched data.
 */
export function DataTable<TRow>({
  columns,
  rows,
  getRowId,
  caption,
  isLoading = false,
  emptyState,
  error,
  density = "comfortable",
  toolbar,
  onRowClick,
  pagination,
  sort,
  columnVisibility,
  className,
}: DataTableProps<TRow>) {
  // An error and an empty result are not the same thing, and a table that shows "No
  // students found." when the request actually failed is telling the reader something
  // untrue about their own school.
  // Filter once, here: every loop below — header, skeleton, body — must agree on the
  // column set, and three separate filters is how they stop agreeing.
  const hidden = new Set(columnVisibility?.hidden ?? []);
  const visibleColumns = columns.filter((column) => column.alwaysVisible || !hidden.has(column.id));

  const showEmpty = !isLoading && !error && rows.length === 0;
  const cellPadding = density === "compact" ? "py-2" : undefined;

  // Decided from what will actually RENDER, not from which props were passed. The menu
  // returns null when every column is `alwaysVisible`, and a caller's toolbar is often a
  // permission gate that renders null for this reader — either way, keying off the prop
  // draws a bordered, padded bar above the header with nothing in it.
  const hasHideableColumn = columns.some((column) => !column.alwaysVisible);
  const columnsMenu =
    columnVisibility && hasHideableColumn ? (
      <DataTableColumnsMenu columns={columns} visibility={columnVisibility} />
    ) : null;
  const hasToolbar = Boolean(toolbar) || columnsMenu !== null;

  return (
    // One card holds the filter row, the table and the pager. `overflow-hidden` is what
    // lets the header's muted fill and the pager's divider meet the rounded corners
    // instead of squaring off inside them.
    <div
      className={cn(
        "w-full overflow-hidden rounded-[var(--sh-radius)] border border-border bg-surface",
        className,
      )}
    >
      {hasToolbar ? (
        // items-end, not items-center: the filter fields carry labels above them, so
        // their baselines are what the columns button has to line up with.
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0 flex-1">{toolbar}</div>
          {columnsMenu}
        </div>
      ) : null}

      {/* Inside the card, above the header: the failure belongs to this list, and the
          filter row above it stays usable so a request that failed under a narrow filter
          can be widened without a reload. */}
      {error ? <div className="border-b border-border p-4">{error}</div> : null}

      <Table frame="none" aria-busy={isLoading || undefined}>
        {caption ? <TableCaption className="sr-only">{caption}</TableCaption> : null}
        <TableHeader>
          <TableRow>
            {visibleColumns.map((column) => (
              <TableHead
                key={column.id}
                className={cn(numericHeaderClasses(column), column.className)}
                aria-sort={ariaSort(column, sort)}
              >
                {/* sortKey wins over srLabel, which it did not before: an icon-headed
                    column could declare a sortKey and silently never render a control,
                    because the sr-only branch short-circuited first. SortButton takes
                    srLabel as its accessible name, so both jobs are done at once. */}
                {sort && column.sortKey ? (
                  <SortButton column={column} sort={sort} />
                ) : column.srLabel ? (
                  <span className="sr-only">{column.srLabel}</span>
                ) : (
                  column.header
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading
            ? Array.from({ length: DEFAULT_SKELETON_ROW_COUNT }, (_, rowIndex) => (
                <TableRow key={`skeleton-${rowIndex}`}>
                  {visibleColumns.map((column) => (
                    // The skeleton cell carries the same alignment classes as the real
                    // one. Without them a `measure` column's placeholder sits left while
                    // its value sits right, so the whole column jumps sideways the moment
                    // data lands — and every caller ends up hand-writing `ms-auto` into
                    // its skeleton to compensate.
                    <TableCell
                      key={column.id}
                      className={cn(cellPadding, numericCellClasses(column), column.className)}
                    >
                      {column.skeleton ?? <Skeleton className="h-4 w-2/3" />}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : rows.map((row) => (
                <TableRow
                  key={getRowId(row)}
                  className={cn(onRowClick && "cursor-pointer hover:bg-muted")}
                  // tabIndex as a plain conditional attribute VALUE, not a conditional prop
                  // spread: eslint-plugin-jsx-a11y's static rules
                  // (no-noninteractive-element-interactions and friends) inspect JSX
                  // attributes directly on the element — a spread's contents are opaque to
                  // that analysis, which is exactly how this row's interactivity went
                  // unflagged before. Deliberately NOT role="button": that overrides the
                  // row's implicit "row" role, breaking its ARIA structural relationship
                  // to its own <td> children — a screen reader loses column navigation and
                  // announces every cell's text concatenated as one control instead of
                  // tabular data. tabIndex + the handlers below still make it keyboard-
                  // focusable and activatable without that trade.
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={
                    onRowClick
                      ? (event) => {
                          // A future cell rendering its own <button>/<a> (an actions
                          // column) must not also trigger the row's own click — bail out
                          // if the click originated inside a nested interactive control.
                          if ((event.target as HTMLElement).closest(INTERACTIVE_ELEMENT_SELECTOR))
                            return;
                          onRowClick(row);
                        }
                      : undefined
                  }
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if ((event.target as HTMLElement).closest(INTERACTIVE_ELEMENT_SELECTOR))
                            return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                >
                  {visibleColumns.map((column) => (
                    <TableCell
                      key={column.id}
                      className={cn(cellPadding, numericCellClasses(column), column.className)}
                    >
                      {column.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
        </TableBody>
      </Table>

      {/* Rendered unwrapped. `emptyState` used to be a string this component boxed in its
          own dashed border, which is why every list screen said one flat sentence and
          nothing else. The presentation belongs to the caller now — in this repo, always
          an <EmptyState> — and the prop type requires an element so it cannot quietly
          become a bare string again. */}
      {showEmpty ? <div className="border-t border-border p-4">{emptyState}</div> : null}

      {/* Rendered even when the page came back empty, deliberately. A page beyond the
          last one — a hand-edited `?page=`, or a filter that shortened the list under a
          shared link — is an empty result WITH somewhere to go, and hiding the pager
          there leaves the reader on a dead end whose only exit is the URL bar. The
          "1–0 of 0" that prompted this is the caller's summary, and the callers already
          decline to compute a range over no rows. */}
      {pagination ? (
        // Summary and rows-per-page lead, the pager trails. Wraps rather than scrolls:
        // on a phone the two stack instead of pushing the pager off the edge of the one
        // row a reader needs to reach.
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            {pagination.pageSize ? <PageSizeControl pageSize={pagination.pageSize} /> : null}
            {pagination.summary ?? null}
          </div>
          {pagination.mode === "pages" ? (
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              onPageChange={pagination.onPageChange}
              label={pagination.label}
              previousLabel={pagination.previousLabel}
              nextLabel={pagination.nextLabel}
              goToPageLabel={pagination.goToPageLabel}
              morePagesLabel={pagination.morePagesLabel}
            />
          ) : (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={pagination.onPrevious}
                disabled={!pagination.hasPrevious || isLoading}
              >
                {pagination.previousLabel}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={pagination.onNext}
                disabled={!pagination.hasNext || isLoading}
              >
                {pagination.nextLabel}
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
