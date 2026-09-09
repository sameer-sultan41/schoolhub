"use client";

import { useMemo, useState } from "react";
import { Search, Users, X } from "lucide-react";
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
  type DataGridLabels,
} from "@schoolhub/ui";

// This preview has no i18n wiring (see the plan's scope note), so this is the
// one place with hardcoded English strings — @schoolhub/ui's DataGrid requires
// them explicitly rather than defaulting, precisely so a real i18n consumer
// can never forget to supply a translation.
const DATA_GRID_LABELS: DataGridLabels = {
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

import { Rating } from "../partials/common/rating";
import type { AvatarGroupAvatar } from "../partials/common/avatar-group";
import { AvatarGroup } from "../partials/common/avatar-group";

// Ported verbatim (content, columns, table config) from the vendor Metronic
// Next.js template's app/(protected)/components/demo1/light-sidebar/components/teams.tsx.
interface TeamRow {
  id: number;
  name: string;
  description: string;
  rating: number;
  updated_at: string;
  users: AvatarGroupAvatar[];
}

const DATA: TeamRow[] = [
  {
    id: 1,
    name: "Product Management",
    description: "Product development & lifecycle",
    rating: 5,
    updated_at: "21 Oct, 2024",
    users: [
      { path: "/media/avatars/300-4.png", fallback: "PM" },
      { path: "/media/avatars/300-1.png", fallback: "PM" },
      { path: "/media/avatars/300-2.png", fallback: "PM" },
    ],
  },
  {
    id: 2,
    name: "Marketing Team",
    description: "Campaigns & market analysis",
    rating: 3.5,
    updated_at: "15 Oct, 2024",
    users: [
      { path: "/media/avatars/300-4.png", fallback: "MT" },
      { path: "", fallback: "MT" },
    ],
  },
  {
    id: 3,
    name: "HR Department",
    description: "Talent acquisition, employee welfare",
    rating: 5,
    updated_at: "10 Oct, 2024",
    users: [
      { path: "/media/avatars/300-4.png", fallback: "HR" },
      { path: "/media/avatars/300-1.png", fallback: "HR" },
      { path: "/media/avatars/300-2.png", fallback: "HR" },
    ],
  },
  {
    id: 4,
    name: "Sales Division",
    description: "Customer relations, sales strategy",
    rating: 5,
    updated_at: "05 Oct, 2024",
    users: [
      { path: "/media/avatars/300-24.png", fallback: "SD" },
      { path: "/media/avatars/300-7.png", fallback: "SD" },
    ],
  },
  {
    id: 5,
    name: "Development Team",
    description: "Software development",
    rating: 4.5,
    updated_at: "01 Oct, 2024",
    users: [
      { path: "/media/avatars/300-3.png", fallback: "DT" },
      { path: "/media/avatars/300-8.png", fallback: "DT" },
      { path: "/media/avatars/300-9.png", fallback: "DT" },
    ],
  },
  {
    id: 6,
    name: "Quality Assurance",
    description: "Product testing",
    rating: 5,
    updated_at: "25 Sep, 2024",
    users: [
      { path: "/media/avatars/300-6.png", fallback: "QA" },
      { path: "/media/avatars/300-5.png", fallback: "QA" },
    ],
  },
  {
    id: 7,
    name: "Finance Team",
    description: "Financial planning",
    rating: 4,
    updated_at: "20 Sep, 2024",
    users: [
      { path: "/media/avatars/300-10.png", fallback: "FT" },
      { path: "/media/avatars/300-11.png", fallback: "FT" },
    ],
  },
];

export function Teams() {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 5 });
  const [sorting, setSorting] = useState<SortingState>([{ id: "updated_at", desc: true }]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [searchQuery, setSearchQuery] = useState("");

  const filteredData = useMemo(() => {
    if (!searchQuery) return DATA;
    return DATA.filter(
      (item) =>
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.description.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [searchQuery]);

  const columns = useMemo<ColumnDef<TeamRow>[]>(
    () => [
      {
        accessorKey: "id",
        header: () => <DataGridTableRowSelectAll label="Select all teams" />,
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
        header: ({ column }) => <DataGridColumnHeader title="Team" column={column} />,
        cell: ({ row }) => (
          <div className="flex flex-col gap-2">
            <span className="text-mono text-sm leading-none font-medium hover:text-primary">
              {row.original.name}
            </span>
            <span className="text-sm leading-3 font-normal text-secondary-foreground">
              {row.original.description}
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
        id: "rating",
        accessorFn: (row) => row.rating,
        header: ({ column }) => <DataGridColumnHeader title="Rating" column={column} />,
        cell: ({ row }) => <Rating rating={Math.floor(row.original.rating)} />,
        enableSorting: true,
        size: 135,
        meta: { skeleton: <Skeleton className="h-5 w-[60px]" /> },
      },
      {
        id: "updated_at",
        accessorFn: (row) => row.updated_at,
        header: ({ column }) => <DataGridColumnHeader title="Last Modified" column={column} />,
        cell: ({ row }) => row.original.updated_at,
        enableSorting: true,
        size: 135,
        meta: { skeleton: <Skeleton className="h-5 w-[70px]" /> },
      },
      {
        id: "users",
        accessorFn: (row) => row.users,
        header: ({ column }) => <DataGridColumnHeader title="Members" column={column} />,
        cell: ({ row }) => <AvatarGroup group={row.original.users} size="size-8" />,
        enableSorting: true,
        size: 135,
        meta: { skeleton: <Skeleton className="h-6 w-[75px]" /> },
      },
    ],
    [],
  );

  const table = useReactTable({
    columns,
    data: filteredData,
    pageCount: Math.ceil((filteredData.length || 0) / pagination.pageSize),
    getRowId: (row) => String(row.id),
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
      tableLayout={{
        columnsPinnable: true,
        columnsMovable: true,
        columnsVisibility: true,
        cellBorder: true,
      }}
      labels={DATA_GRID_LABELS}
      emptyState={
        <EmptyState icon={Users} title="No teams found" description="Try a different search." />
      }
    >
      <Card>
        <CardHeader className="py-3.5">
          <CardTitle>Teams</CardTitle>
          <CardToolbar className="relative">
            <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search Teams..."
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
