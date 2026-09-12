"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EllipsisVertical, Filter, Search, Settings2, Users, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { m } from "motion/react";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type Row,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { toast } from "sonner";

import { ApiError } from "@schoolhub/api-client";
import {
  Avatar,
  AvatarFallback,
  Badge,
  BadgeDot,
  Button,
  Card,
  CardFooter,
  CardHeader,
  CardHeading,
  CardTable,
  CardTitle,
  CardToolbar,
  Checkbox,
  DataGrid,
  DataGridColumnHeader,
  DataGridColumnVisibility,
  DataGridPagination,
  DataGridTable,
  DataGridTableRowSelect,
  DataGridTableRowSelectAll,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  ScrollBar,
  Skeleton,
  Switch,
} from "@schoolhub/ui";

import { Services } from "@/services";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { DASHBOARD_DATA_GRID_LABELS } from "@/app/(app)/shell/data-grid-labels";
import { StaffFormDialog } from "@/app/(app)/staff/staff-form-dialog";
import { ExitStaffDialog } from "@/app/(app)/staff/exit-staff-dialog";

/**
 * The `/staff` route's own directory — every staff member, server-paginated/sorted/
 * searched via `Services.dashboard.fetchStaffPage`. Distinct from the dashboard-home
 * Teams widget, which shows a fixed one-page preview and never changes page/search/sort.
 *
 * Visually ported from Metronic's `network/user-table/team-crew` reference
 * (`components/users.tsx`) per the plan's mapping decisions; the data layer underneath
 * (server pagination/sorting/search, `manualPagination`/`manualSorting`) is unchanged
 * from before this port and stays real — only the vendor's client-side paging/sorting/
 * filtering over 33 hardcoded rows was left behind, never ported.
 *
 * This preview has no i18n wiring yet (see the plan's Global Constraints), so — same as
 * `teams.tsx` — this is the one place with hardcoded English strings.
 */
interface StaffRow {
  id: string;
  name: string;
  designation: string;
  campus: string;
  status: string;
  updatedAt: string;
}

/**
 * Column id -> the real `?ordering=` field name confirmed against `StaffViewSet.
 * ordering_fields` (apps/api/apps/staff_management/views.py). `joiningDate` is not a
 * real column — it is the sentinel id the Sort Order popover below writes into
 * `sorting` state (see that popover's comment for why sharing one state slot with the
 * column-header sort is deliberate). There is no entry for the "Last updated" column:
 * `updated_at` is not in `ordering_fields` (only `created_at` is), so that column is
 * built with `enableSorting: false` rather than wiring a sort that would silently do
 * nothing on the server.
 */
const SORT_FIELD: Record<string, string> = {
  name: "last_name",
  role: "designation_name",
  status: "employment_status",
  campus: "campus_name",
  joiningDate: "joining_date",
};

const DEFAULT_SORTING: SortingState = [{ id: "name", desc: false }];
const JOINING_DATE_SORT_ID = "joiningDate";

type StatusVariant = "success" | "warning" | "destructive" | "secondary";

/**
 * `employment_status` -> badge color/label. Values and their exact display labels
 * mirror `EmploymentStatus` (apps/api/apps/staff_management/models.py) one for one —
 * `resigned`/`retired` both read as "no longer here but not a compliance action", so
 * both map to the neutral `secondary` color rather than inventing a fifth badge color.
 */
const STATUS_META: Record<string, { variant: StatusVariant; label: string }> = {
  active: { variant: "success", label: "Active" },
  on_leave: { variant: "warning", label: "On leave" },
  suspended: { variant: "destructive", label: "Suspended" },
  resigned: { variant: "secondary", label: "Resigned" },
  retired: { variant: "secondary", label: "Retired" },
  terminated: { variant: "destructive", label: "Terminated" },
};

/** Defensive fallback for a status value not in `STATUS_META` — humanizes rather than
 * showing the raw snake_case string, e.g. "on_leave" -> "On leave". */
function humanizeStatus(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function statusMeta(status: string): { variant: StatusVariant; label: string } {
  return STATUS_META[status] ?? { variant: "secondary", label: humanizeStatus(status) };
}

/** Same convention as `shell/partials/topbar/user-dropdown-menu.tsx`'s own `initialsOf`
 * (non-null-assertion-free array destructure) — duplicated rather than imported since
 * that one is private to its own module. Avatars here never attempt a photo `src`:
 * `StaffSerializer.photo_file_id` has no resolvable URL anywhere in the API today
 * (`core/files/serializers.py`'s `FileSerializer` has no `url` field), so a real photo
 * would mean guessing a URL pattern that might not exist or might leak cross-tenant —
 * initials are the only honest fallback available. */
function initialsOf(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/).filter(Boolean);
  if (!first) return "?";
  const last = rest.at(-1);
  return last ? `${first[0]}${last[0]}`.toUpperCase() : first.slice(0, 2).toUpperCase();
}

function formatLastUpdated(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return formatDistanceToNow(parsed, { addSuffix: true });
}

/** The ⋮ actions menu — `Edit` opens `StaffFormDialog` in edit mode and `Delete` opens
 * `ExitStaffDialog` for this single row, both driven by callbacks owned by
 * `StaffDirectoryTable` above; `Copy ID` is fully wired: it copies the real row id via
 * the shared `useCopyToClipboard` hook and confirms with a toast. */
function ActionsCell({
  row,
  onEdit,
  onDelete,
}: {
  row: Row<StaffRow>;
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const { copyToClipboard } = useCopyToClipboard();

  function handleCopyId() {
    // `copyToClipboard` now resolves to whether the write genuinely succeeded (see
    // use-copy-to-clipboard.ts) — the toast reflects that instead of firing
    // unconditionally, which would otherwise claim success even when the Clipboard
    // API is unavailable (no secure context) or the write itself rejects.
    copyToClipboard(row.original.id).then((success) => {
      if (success) {
        toast.success("Staff ID copied");
      } else {
        toast.error("Couldn't copy staff ID");
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="size-7"
          mode="icon"
          variant="ghost"
          aria-label={`Actions for ${row.original.name}`}
        >
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end">
        <DropdownMenuItem onClick={() => onEdit(row.original.id)}>Edit</DropdownMenuItem>
        <DropdownMenuItem onClick={handleCopyId}>Copy ID</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => onDelete(row.original.id, row.original.name)}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function StaffDirectoryTable() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // Defaults to "active" (not "no filter") to match the "Active Users" toggle below
  // defaulting on — the toggle and the Status popover's own "Active" checkbox are the
  // same piece of state, just two different controls for it.
  const [statusFilter, setStatusFilter] = useState<string | undefined>("active");
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [formDialog, setFormDialog] = useState<
    { mode: "create" } | { mode: "edit"; staffId: string } | null
  >(null);
  const [exitDialog, setExitDialog] = useState<{
    staffIds: string[];
    staffNames: string[];
  } | null>(null);

  // Clears a bulk selection once its "Exit selected" dialog closes (success, cancel, or
  // a partial-failure close) — a selected row that just got exited shouldn't stay
  // "selected" pointing at now-stale rows. `ExitStaffDialog` owns its own success/toast/
  // close behavior and exposes no `onSuccess` of its own, so this reacts to `exitDialog`
  // itself transitioning from non-null to null rather than to a callback. A ref tracks
  // the previous value so this only fires on that genuine transition, not on the initial
  // mount (where `exitDialog` already starts `null`).
  const previousExitDialogRef = useRef(exitDialog);
  useEffect(() => {
    if (previousExitDialogRef.current !== null && exitDialog === null) {
      setRowSelection({});
    }
    previousExitDialogRef.current = exitDialog;
  }, [exitDialog]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput.trim());
    }, 300);
    return () => {
      clearTimeout(timeout);
    };
  }, [searchInput]);

  useEffect(() => {
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  }, [search, sorting, statusFilter]);

  const sort = sorting[0];
  // `sort.id` is always one of this table's own column ids (or the `joiningDate`
  // sentinel) in practice, but nothing at the type level guarantees `SORT_FIELD` has an
  // entry for it — guard the lookup so a miss produces `ordering: undefined` (sort
  // param omitted) rather than a query string with the literal text "undefined"
  // spliced into it.
  const sortField = sort ? SORT_FIELD[sort.id] : undefined;
  const ordering = sortField ? `${sort?.desc ? "-" : ""}${sortField}` : undefined;
  const page = pagination.pageIndex + 1;
  const pageSize = pagination.pageSize;

  const { data, isPending, isFetching, isError, error } = useQuery({
    queryKey: ["staff", "directory", { page, pageSize, search, ordering, statusFilter }],
    queryFn: () =>
      Services.dashboard.fetchStaffPage({
        page,
        pageSize,
        search: search || undefined,
        ordering,
        employmentStatus: statusFilter,
      }),
    placeholderData: keepPreviousData,
  });

  const rows = useMemo<StaffRow[]>(
    () =>
      (data?.items ?? []).map((staff) => ({
        id: staff.id,
        name: `${staff.first_name} ${staff.last_name}`,
        designation:
          staff.designation_name ??
          (staff.staff_type === "teaching" ? "Teaching staff" : "Non-teaching staff"),
        campus: staff.campus_name,
        status: staff.employment_status,
        updatedAt: staff.updated_at,
      })),
    [data],
  );

  // `data.pagination` is the `Pagination` union (`CursorPagination | OffsetPagination`);
  // `total_pages` exists only on the `OffsetPagination` arm (`/staff` is page-number
  // paginated, never cursor), so it must be narrowed before it's read — the same `in`
  // guard `dashboard-service.ts`'s own `fetchTotal` already uses for `total_count`.
  // `total_count` is on both arms (required on offset, optional on cursor), so it needs
  // no such narrowing.
  const pageMeta = data?.pagination;
  const recordCount = pageMeta?.total_count ?? rows.length;
  const pageCount = pageMeta && "total_pages" in pageMeta ? pageMeta.total_pages : 1;

  function handleStatusToggle(checked: boolean, value: string) {
    setStatusFilter(checked ? value : undefined);
  }

  // The Sort Order popover ("Newest joiners" / "Oldest joiners" -> `joining_date`) and
  // clicking a column header both drive the SAME `sorting` state rather than two
  // independent ones. That is a deliberate choice, not an oversight: `sorting` is what
  // `DataGridColumnHeader` reads to draw each column's active-sort arrow, so if the
  // popover wrote to a separate flag, a preset sort could be active while every column
  // header still looked unsorted (or, worse, a stale header arrow could look active
  // while the popover's preset was actually driving the query) — a visibly
  // inconsistent header. Sharing one state slot makes the two mutually exclusive for
  // free: picking a preset here sets `sorting` to the `joiningDate` sentinel id (which
  // matches no real column, so no header highlights — correct, since no column is
  // "being sorted by" in the preset case), and clicking any real column header calls
  // `onSortingChange` with that column's id, which overwrites the sentinel and silently
  // clears the preset. Selecting the already-active preset again resets `sorting` back
  // to the table's own default (name, ascending), matching the Status popover's
  // "select again to clear" behavior below for a consistent feel across both popovers.
  function handleSortOrderToggle(checked: boolean, desc: boolean) {
    setSorting(checked ? [{ id: JOINING_DATE_SORT_ID, desc }] : DEFAULT_SORTING);
  }

  const activeSortOrder =
    sort?.id === JOINING_DATE_SORT_ID ? (sort?.desc ? "newest" : "oldest") : undefined;

  const columns = useMemo<ColumnDef<StaffRow>[]>(
    () => [
      {
        id: "select",
        header: () => <DataGridTableRowSelectAll label="Select all staff" />,
        cell: ({ row }) => (
          <DataGridTableRowSelect row={row} label={`Select ${row.original.name}`} />
        ),
        enableSorting: false,
        enableHiding: false,
        enableResizing: false,
        size: 51,
      },
      {
        id: "name",
        accessorFn: (row) => row.name,
        header: ({ column }) => <DataGridColumnHeader title="Member" column={column} />,
        // Vendor's Member cell subtitle is the row's email — this repo has no per-staff
        // email field surfaced by `StaffDirectoryRecord`, and the adjacent "Role" column
        // already carries the designation/staff-type fallback text on its own, so
        // repeating it here as a second line would just be the same string shown twice
        // with nothing new in it. A clean single-line avatar + name is the honest
        // option: no fabricated email, no redundant designation repeat.
        cell: ({ row }) => (
          <div className="flex items-center gap-4">
            <Avatar className="size-9 shrink-0">
              <AvatarFallback>{initialsOf(row.original.name)}</AvatarFallback>
            </Avatar>
            <span className="text-mono text-sm font-medium">{row.original.name}</span>
          </div>
        ),
        enableSorting: true,
        size: 280,
        meta: {
          skeleton: (
            <div className="flex items-center gap-4">
              <Skeleton className="size-9 rounded-full" />
              <Skeleton className="h-4 w-[125px]" />
            </div>
          ),
        },
      },
      {
        id: "role",
        accessorFn: (row) => row.designation,
        header: ({ column }) => <DataGridColumnHeader title="Role" column={column} />,
        cell: ({ row }) => (
          <span className="font-normal text-foreground">{row.original.designation}</span>
        ),
        enableSorting: true,
        size: 180,
        meta: { skeleton: <Skeleton className="h-4 w-[100px]" /> },
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: ({ column }) => <DataGridColumnHeader title="Status" column={column} />,
        cell: ({ row }) => {
          const meta = statusMeta(row.original.status);
          return (
            <Badge size="lg" variant={meta.variant} appearance="light" shape="circle">
              <BadgeDot />
              {meta.label}
            </Badge>
          );
        },
        enableSorting: true,
        size: 160,
        meta: { skeleton: <Skeleton className="h-6 w-20 rounded-full" /> },
      },
      {
        id: "campus",
        accessorFn: (row) => row.campus,
        header: ({ column }) => <DataGridColumnHeader title="Campus" column={column} />,
        cell: ({ row }) => <span className="font-normal text-foreground">{row.original.campus}</span>,
        enableSorting: true,
        size: 180,
        meta: { skeleton: <Skeleton className="h-4 w-[100px]" /> },
      },
      {
        id: "lastUpdated",
        accessorFn: (row) => row.updatedAt,
        header: ({ column }) => <DataGridColumnHeader title="Last updated" column={column} />,
        cell: ({ row }) => (
          <span className="font-normal text-foreground">
            {formatLastUpdated(row.original.updatedAt)}
          </span>
        ),
        // Not sortable: `updated_at` is not in `StaffViewSet.ordering_fields` (only
        // `created_at` is) — no real `?ordering=` value exists for it, so this stays a
        // plain column rather than a sort control that would silently no-op.
        enableSorting: false,
        size: 160,
        meta: { skeleton: <Skeleton className="h-4 w-[90px]" /> },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <ActionsCell
            row={row}
            onEdit={(id) => setFormDialog({ mode: "edit", staffId: id })}
            onDelete={(id, name) => setExitDialog({ staffIds: [id], staffNames: [name] })}
          />
        ),
        enableSorting: false,
        enableHiding: false,
        size: 60,
      },
    ],
    [],
  );

  const table = useReactTable({
    columns,
    data: rows,
    pageCount,
    getRowId: (row) => row.id,
    state: { pagination, sorting, rowSelection },
    manualPagination: true,
    manualSorting: true,
    enableRowSelection: true,
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
  });

  // Derived from the SAME single iteration over `getSelectedRowModel().rows` — not from
  // `rowSelection`'s own object keys (insertion order, i.e. the order rows were checked)
  // for `selectedIds` and `getSelectedRowModel()` (display/row order) for `selectedNames`
  // separately, which can disagree whenever a user checks rows out of visual sequence
  // (e.g. row 3 then row 1). `ExitStaffDialog`'s failure list zips `staffIds[i]`/
  // `staffNames[i]` together by index, so a mismatched order there would show the wrong
  // name next to a failed id in a partial-bulk-failure. `row.original.id` matches what
  // `getRowId: (row) => row.id` above already establishes.
  const selectedRows = table.getSelectedRowModel().rows;
  const selectedIds = selectedRows.map((row) => row.original.id);
  const selectedNames = selectedRows.map((row) => row.original.name);

  if (isError) {
    const isForbidden = error instanceof ApiError && error.isPermissionDenied;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Staff</CardTitle>
        </CardHeader>
        <CardTable>
          <p className="p-5 text-sm text-secondary-foreground">
            {isForbidden
              ? "You don't have access to the staff directory. Ask an administrator for the staff module permission."
              : "Couldn't load the staff directory. Try refreshing the page."}
          </p>
        </CardTable>
      </Card>
    );
  }

  return (
    <DataGrid
      table={table}
      recordCount={recordCount}
      isLoading={isPending}
      caption="Staff directory"
      tableLayout={{
        columnsPinnable: true,
        columnsMovable: true,
        columnsVisibility: true,
        cellBorder: true,
      }}
      labels={DASHBOARD_DATA_GRID_LABELS}
      emptyState={
        <EmptyState icon={Users} title="No staff found" description="Try a different search." />
      }
    >
      <Card>
        <CardHeader>
          <CardHeading>
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search staff..."
                  aria-label="Search staff"
                  value={searchInput}
                  onChange={(e) => {
                    setSearchInput(e.target.value);
                  }}
                  className="w-52 ps-9"
                />
                {searchInput.length > 0 && (
                  <Button
                    mode="icon"
                    variant="ghost"
                    aria-label="Clear search"
                    className="absolute end-1.5 top-1/2 h-6 w-6 -translate-y-1/2"
                    onClick={() => {
                      setSearchInput("");
                    }}
                  >
                    <X />
                  </Button>
                )}
              </div>
              {/* Single-select, not the vendor's multi-checkbox: `/staff`'s real
                  `StaffFilterSet.employment_status` is a plain exact-match filter, one
                  value at a time — matching that instead of the vendor's fake
                  in-memory multi-select. Selecting the already-active status clears it. */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline">
                    <Filter />
                    Status
                    {statusFilter && (
                      <Badge size="sm" variant="outline">
                        {statusMeta(statusFilter).label}
                      </Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-44 p-3" align="start" label="Filter by status">
                  <div className="space-y-3">
                    <div className="text-xs font-medium text-muted-foreground">Filters</div>
                    <div className="space-y-3">
                      {Object.entries(STATUS_META).map(([value, meta]) => (
                        <div key={value} className="flex items-center gap-2.5">
                          <Checkbox
                            id={`status-${value}`}
                            checked={statusFilter === value}
                            onCheckedChange={(checked) =>
                              handleStatusToggle(checked === true, value)
                            }
                          />
                          <Label
                            htmlFor={`status-${value}`}
                            className="grow font-normal"
                          >
                            {meta.label}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              {/* Vendor's "latest/older/oldest" sorts by `new Date(row.id)` on string
                  ids like "1" — Invalid Date, a no-op even in the real vendor demo.
                  Real equivalent: sort by `joining_date`, a confirmed `ordering_fields`
                  entry. See `handleSortOrderToggle` above for how this coexists with
                  column-header sorting. */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline">
                    <Filter />
                    Sort Order
                    {activeSortOrder && (
                      <Badge size="sm" variant="outline">
                        {activeSortOrder === "newest" ? "Newest joiners" : "Oldest joiners"}
                      </Badge>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-3" align="start" label="Sort order options">
                  <div className="space-y-3">
                    <div className="text-xs font-medium text-muted-foreground">Sort By</div>
                    <div className="space-y-3">
                      <div className="flex items-center gap-2.5">
                        <Checkbox
                          id="sort-newest-joiners"
                          checked={activeSortOrder === "newest"}
                          onCheckedChange={(checked) =>
                            handleSortOrderToggle(checked === true, true)
                          }
                        />
                        <Label htmlFor="sort-newest-joiners" className="grow font-normal">
                          Newest joiners
                        </Label>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <Checkbox
                          id="sort-oldest-joiners"
                          checked={activeSortOrder === "oldest"}
                          onCheckedChange={(checked) =>
                            handleSortOrderToggle(checked === true, false)
                          }
                        />
                        <Label htmlFor="sort-oldest-joiners" className="grow font-normal">
                          Oldest joiners
                        </Label>
                      </div>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </CardHeading>
          <CardToolbar>
            <div className="flex flex-wrap items-center gap-2.5">
              {/* From the vendor's sibling "Team Members" reference (account/members/
                  team-members), not "Team Crew" — same underlying `statusFilter` state
                  as the Status popover above, not a second, competing filter: this is
                  just the common-case shortcut for "employment_status=active", on by
                  default. Turning it off clears the filter (shows every status); the
                  popover still works independently for any other single status. */}
              <Label htmlFor="active-users-toggle" className="text-sm">
                Active Users
              </Label>
              <Switch
                id="active-users-toggle"
                size="sm"
                checked={statusFilter === "active"}
                onCheckedChange={(checked) => {
                  setStatusFilter(checked ? "active" : undefined);
                }}
              />
            </div>
            {/* Decorative in the vendor source too — no `onClick`, nothing reacts to it
                anywhere in `components/users.tsx`. Kept inert here for pixel fidelity:
                matching the vendor's own inert button IS "same UI, no changes." */}
            <Button>
              <Settings2 />
              Filters
            </Button>
            {selectedIds.length > 0 && (
              <Button
                variant="destructive"
                onClick={() => setExitDialog({ staffIds: selectedIds, staffNames: selectedNames })}
              >
                Exit selected ({selectedIds.length})
              </Button>
            )}
            <DataGridColumnVisibility />
          </CardToolbar>
        </CardHeader>
        <CardTable>
          {/* keepPreviousData means a filter/sort/search/page change keeps showing the
              OLD rows while the new page loads (no blank-table flash) — but with zero
              visual feedback, the swap from old rows to new ones is otherwise instant
              and easy to miss. A brief dip in opacity while `isFetching` (not the
              cold-load-only `isPending` the skeleton rows below key off) makes that real
              state change legible without a spinner or a layout shift. Duration matches
              the ~200ms voice popover.tsx/dropdown-menu.tsx already established. */}
          <m.div animate={{ opacity: isFetching ? 0.5 : 1 }} transition={{ duration: 0.15 }}>
            <ScrollArea>
              <DataGridTable />
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </m.div>
        </CardTable>
        <CardFooter>
          <DataGridPagination />
        </CardFooter>
      </Card>
      <StaffFormDialog
        open={formDialog !== null}
        onOpenChange={(open) => {
          if (!open) setFormDialog(null);
        }}
        mode={formDialog?.mode ?? "create"}
        staffId={formDialog?.mode === "edit" ? formDialog.staffId : undefined}
      />
      <ExitStaffDialog
        open={exitDialog !== null}
        onOpenChange={(open) => {
          if (!open) setExitDialog(null);
        }}
        staffIds={exitDialog?.staffIds ?? []}
        staffNames={exitDialog?.staffNames}
      />
    </DataGrid>
  );
}
