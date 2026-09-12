"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Users, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";

import {
  Button,
  Card,
  CardFooter,
  CardHeader,
  CardTable,
  CardTitle,
  CardToolbar,
  DataGrid,
  DataGridColumnHeader,
  DataGridPagination,
  DataGridTable,
  DataGridTableRowSelect,
  DataGridTableRowSelectAll,
  EmptyState,
  Input,
  ScrollArea,
  ScrollBar,
  Skeleton,
} from "@schoolhub/ui";

import { Services } from "@/services";
import { DASHBOARD_DATA_GRID_LABELS } from "@/app/(app)/shell/data-grid-labels";

/**
 * Repurposed from the vendor Metronic template's teams.tsx (originally seven
 * hardcoded corporate "teams" with a star rating) into a real staff directory.
 * "Rating" and "Members" (avatar groups) had no staff-record equivalent and are
 * dropped rather than faked.
 */
interface StaffRow {
  id: string;
  name: string;
  role: string;
  updatedAt: string;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

export function Teams() {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 5 });
  const [sorting, setSorting] = useState<SortingState>([{ id: "updatedAt", desc: true }]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isPending } = useQuery({
    queryKey: ["dashboard", "staff-directory"],
    queryFn: () => Services.dashboard.fetchStaffDirectory(),
  });

  const rows = useMemo<StaffRow[]>(
    () =>
      (data ?? []).map((staff) => ({
        id: staff.id,
        name: `${staff.first_name} ${staff.last_name}`,
        role:
          staff.designation_name ??
          (staff.staff_type === "teaching" ? "Teaching staff" : "Non-teaching staff"),
        updatedAt: staff.updated_at,
      })),
    [data],
  );

  const filteredData = useMemo(() => {
    if (!searchQuery) return rows;
    const query = searchQuery.toLowerCase();
    return rows.filter(
      (row) => row.name.toLowerCase().includes(query) || row.role.toLowerCase().includes(query),
    );
  }, [rows, searchQuery]);

  const columns = useMemo<ColumnDef<StaffRow>[]>(
    () => [
      {
        accessorKey: "id",
        header: () => <DataGridTableRowSelectAll label="Select all staff" />,
        cell: ({ row }) => (
          <DataGridTableRowSelect row={row} label={`Select ${row.original.name}`} />
        ),
        enableSorting: false,
        enableHiding: false,
        enableResizing: false,
        size: 48,
      },
      {
        id: "name",
        accessorFn: (row) => row.name,
        header: ({ column }) => <DataGridColumnHeader title="Staff" column={column} />,
        cell: ({ row }) => (
          <div className="flex flex-col gap-2">
            <span className="text-mono text-sm leading-none font-medium hover:text-primary">
              {row.original.name}
            </span>
            <span className="text-sm leading-3 font-normal text-secondary-foreground">
              {row.original.role}
            </span>
          </div>
        ),
        enableSorting: true,
        size: 280,
        meta: {
          skeleton: (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-[125px]" />
              <Skeleton className="h-2.5 w-[90px]" />
            </div>
          ),
        },
      },
      {
        id: "updatedAt",
        accessorFn: (row) => row.updatedAt,
        header: ({ column }) => <DataGridColumnHeader title="Last Modified" column={column} />,
        cell: ({ row }) => formatDate(row.original.updatedAt),
        enableSorting: true,
        size: 135,
        meta: { skeleton: <Skeleton className="h-5 w-[70px]" /> },
      },
    ],
    [],
  );

  const table = useReactTable({
    columns,
    data: filteredData,
    pageCount: Math.ceil((filteredData.length || 0) / pagination.pageSize),
    getRowId: (row) => row.id,
    state: { pagination, sorting, rowSelection },
    columnResizeMode: "onChange",
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <DataGrid
      table={table}
      recordCount={filteredData.length || 0}
      isLoading={isPending}
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
        <CardHeader className="py-3.5">
          <CardTitle>Staff</CardTitle>
          <CardToolbar className="flex items-center gap-3">
            <Link href="/staff" className="text-sm font-medium text-primary hover:underline">
              View all
            </Link>
            <div className="relative">
              <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search Staff..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                }}
                className="w-40 ps-9"
              />
              {searchQuery.length > 0 && (
                <Button
                  mode="icon"
                  variant="ghost"
                  className="absolute end-1.5 top-1/2 h-6 w-6 -translate-y-1/2"
                  onClick={() => {
                    setSearchQuery("");
                  }}
                >
                  <X />
                </Button>
              )}
            </div>
          </CardToolbar>
        </CardHeader>
        <CardTable>
          <ScrollArea>
            <DataGridTable />
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </CardTable>
        <CardFooter>
          <DataGridPagination />
        </CardFooter>
      </Card>
    </DataGrid>
  );
}
