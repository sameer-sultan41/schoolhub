"use client";

/**
 * Drag-to-reorder ROWS — only meaningful where row order is itself data (a bell-
 * schedule's period sequence, a display priority) rather than the result of a server
 * sort or filter, which `tableLayout.rowsDraggable` defaulting to `false` reflects (see
 * `data-grid.tsx`'s own comment on that flag). A caller that turns it on owns persisting
 * the new order — `onDragEnd` reports the drop, nothing here writes it anywhere.
 */

import { useId } from "react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type Cell, flexRender, type Row } from "@tanstack/react-table";
import { GripHorizontal } from "lucide-react";
import { useDataGrid } from "./data-grid";
import {
  DataGridTableBase,
  DataGridTableBody,
  DataGridTableBodyRow,
  DataGridTableBodyRowCell,
  DataGridTableBodyRowSkeleton,
  DataGridTableBodyRowSkeletonCell,
  DataGridTableEmpty,
  DataGridTableHead,
  DataGridTableHeadRow,
  DataGridTableHeadRowCell,
  DataGridTableHeadRowCellResize,
} from "./data-grid-table";
import { Button } from "./button";

/** A drag handle for one row — rendered by the CALLER's own column (typically a
 * dedicated first column, the same way `createSelectColumn` supplies the checkbox
 * column), because only the caller knows where in its column set a handle belongs. */
export function DataGridRowDragHandle({ rowId }: { rowId: string }) {
  const { labels } = useDataGrid();
  const { attributes, listeners } = useSortable({ id: rowId });

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7"
      {...attributes}
      {...listeners}
      aria-label={labels.dragToReorderRow}
    >
      <GripHorizontal aria-hidden="true" className="size-3.5 opacity-50" />
    </Button>
  );
}

function DataGridDndRow<TData>({ row }: { row: Row<TData> }) {
  const { isDragging, setNodeRef, transform, transition } = useSortable({ id: row.id });

  return (
    <DataGridTableBodyRow
      row={row}
      dndRef={setNodeRef}
      dndStyle={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.8 : 1,
        zIndex: isDragging ? 2 : undefined,
      }}
    >
      {row.getVisibleCells().map((cell: Cell<TData, unknown>) => (
        <DataGridTableBodyRowCell cell={cell} key={cell.id}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </DataGridTableBodyRowCell>
      ))}
    </DataGridTableBodyRow>
  );
}

export function DataGridTableDndRows({
  dataIds,
  onDragEnd,
}: {
  /** Row ids in their current order — `table.getRowModel().rows.map((r) => r.id)`, kept
   * as an explicit prop rather than derived here so a caller using a custom
   * `getRowId` controls exactly what dnd-kit tracks identity by. */
  dataIds: UniqueIdentifier[];
  onDragEnd: (event: DragEndEvent) => void;
}) {
  const { table, isLoading, tableLayout } = useDataGrid();
  const pageSize = table.getState().pagination.pageSize;
  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor),
  );

  return (
    <DndContext
      id={useId()}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={onDragEnd}
      sensors={sensors}
    >
      <DataGridTableBase>
        <DataGridTableHead>
          {table.getHeaderGroups().map((headerGroup) => (
            <DataGridTableHeadRow headerGroup={headerGroup} key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const { column } = header;
                return (
                  <DataGridTableHeadRowCell header={header} key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                    {tableLayout.columnsResizable && column.getCanResize() && (
                      <DataGridTableHeadRowCellResize header={header} />
                    )}
                  </DataGridTableHeadRowCell>
                );
              })}
            </DataGridTableHeadRow>
          ))}
        </DataGridTableHead>

        <DataGridTableBody>
          {isLoading ? (
            Array.from({ length: pageSize }, (_, rowIndex) => (
              <DataGridTableBodyRowSkeleton key={rowIndex}>
                {table.getVisibleFlatColumns().map((column) => (
                  <DataGridTableBodyRowSkeletonCell column={column} key={column.id}>
                    {column.columnDef.meta?.skeleton}
                  </DataGridTableBodyRowSkeletonCell>
                ))}
              </DataGridTableBodyRowSkeleton>
            ))
          ) : table.getRowModel().rows.length ? (
            <SortableContext items={dataIds} strategy={verticalListSortingStrategy}>
              {table.getRowModel().rows.map((row) => (
                <DataGridDndRow row={row} key={row.id} />
              ))}
            </SortableContext>
          ) : (
            <DataGridTableEmpty />
          )}
        </DataGridTableBody>
      </DataGridTableBase>
    </DndContext>
  );
}
