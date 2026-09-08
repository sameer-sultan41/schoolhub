"use client";

/**
 * Drag-to-reorder COLUMNS — a drop-in replacement for `DataGridTable` when
 * `tableLayout.columnsDraggable` is on. Kept as a separate component rather than a
 * branch inside `DataGridTable` itself: every cell here has to be wrapped in a
 * `SortableContext`/`useSortable` pair whether or not a drag is in progress, which is
 * meaningfully more machinery than the plain render path, and a column that will never
 * turn dragging on should not pay for it.
 *
 * `@dnd-kit` over any hand-rolled HTML5 drag-and-drop: keyboard support (a
 * `KeyboardSensor` ships alongside mouse/touch, so reordering is not mouse-only) and
 * `restrictToParentElement` come for free rather than being reimplemented.
 */

import { useId } from "react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToParentElement } from "@dnd-kit/modifiers";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type Cell, flexRender, type Header } from "@tanstack/react-table";
import { GripVertical } from "lucide-react";
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

function DataGridDndHeaderCell<TData extends object>({
  header,
}: {
  header: Header<TData, unknown>;
}) {
  const { tableLayout, labels } = useDataGrid<TData>();
  const { column } = header;
  // Structural columns (`createSelectColumn`'s checkbox) opt out via `meta.draggable:
  // false` — TanStack has no built-in per-column "can reorder" flag the way it does for
  // sorting/pinning/resizing, since dragging is this package's own feature on top.
  // `disabled` on `useSortable` itself, not just hiding the grip below: that's what
  // actually stops dnd-kit from treating the column as a drag source at all, by pointer
  // OR keyboard, rather than merely removing its handle's visible affordance.
  const draggable = column.columnDef.meta?.draggable !== false;
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: column.id,
    disabled: !draggable,
  });

  return (
    <DataGridTableHeadRowCell
      header={header}
      dndRef={setNodeRef}
      dndStyle={{
        opacity: isDragging ? 0.8 : 1,
        transform: CSS.Translate.toString(transform),
        transition,
        whiteSpace: "nowrap",
        // Omitted rather than `zIndex: undefined` while not dragging: `style={{
        // ...getPinningStyles(column), ...dndStyle }}` in data-grid-table.tsx spreads
        // this object LAST, and a key present with value `undefined` still overwrites
        // the pinning style's own `zIndex: 1` — a pinned column would lose its stacking
        // order the instant this file is in the render path at all, dragging or not.
        ...(isDragging ? { zIndex: 2 } : null),
      }}
    >
      <div className="flex items-center justify-start gap-0.5">
        {draggable && (
          <Button
            variant="ghost"
            size="icon"
            className="-ms-2 size-6"
            {...attributes}
            {...listeners}
            aria-label={labels.dragToReorderColumn}
          >
            <GripVertical aria-hidden="true" className="size-3.5 opacity-50" />
          </Button>
        )}
        {header.isPlaceholder
          ? null
          : flexRender(header.column.columnDef.header, header.getContext())}
        {tableLayout.columnsResizable && column.getCanResize() && (
          <DataGridTableHeadRowCellResize header={header} />
        )}
      </div>
    </DataGridTableHeadRowCell>
  );
}

function DataGridDndBodyCell<TData>({ cell }: { cell: Cell<TData, unknown> }) {
  // Matches the header cell's own `disabled` — see DataGridDndHeaderCell's comment.
  const { isDragging, setNodeRef, transform, transition } = useSortable({
    id: cell.column.id,
    disabled: cell.column.columnDef.meta?.draggable === false,
  });

  return (
    <DataGridTableBodyRowCell
      cell={cell}
      dndRef={setNodeRef}
      dndStyle={{
        opacity: isDragging ? 0.8 : 1,
        transform: CSS.Translate.toString(transform),
        transition,
        // See DataGridDndHeaderCell's own comment: omitted, not `undefined`, so a
        // pinned column's zIndex: 1 survives being spread over while not dragging.
        ...(isDragging ? { zIndex: 2 } : null),
      }}
    >
      {flexRender(cell.column.columnDef.cell, cell.getContext())}
    </DataGridTableBodyRowCell>
  );
}

/** `DataGridTable`'s counterpart when columns can be dragged to reorder. Handles its own
 * `DndContext` — a caller wires only `onDragEnd`, typically ending in
 * `table.setColumnOrder(...)` (see `data-grid-column-header.tsx`'s `moveColumn` for the
 * same array-splice, done here from a drop event instead of a menu click). */
export function DataGridTableDnd({ onDragEnd }: { onDragEnd: (event: DragEndEvent) => void }) {
  const { table, isLoading } = useDataGrid();
  const pageSize = table.getState().pagination.pageSize;
  const columnOrder = table.getState().columnOrder;
  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor),
  );

  return (
    <DndContext
      id={useId()}
      collisionDetection={closestCenter}
      modifiers={[restrictToParentElement]}
      onDragEnd={onDragEnd}
      sensors={sensors}
    >
      <DataGridTableBase>
        <DataGridTableHead>
          {table.getHeaderGroups().map((headerGroup) => (
            <DataGridTableHeadRow headerGroup={headerGroup} key={headerGroup.id}>
              <SortableContext items={columnOrder} strategy={horizontalListSortingStrategy}>
                {headerGroup.headers.map((header) => (
                  <DataGridDndHeaderCell header={header} key={header.id} />
                ))}
              </SortableContext>
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
            table.getRowModel().rows.map((row) => (
              <DataGridTableBodyRow row={row} key={row.id}>
                <SortableContext items={columnOrder} strategy={horizontalListSortingStrategy}>
                  {row.getVisibleCells().map((cell) => (
                    <DataGridDndBodyCell cell={cell} key={cell.id} />
                  ))}
                </SortableContext>
              </DataGridTableBodyRow>
            ))
          ) : (
            <DataGridTableEmpty />
          )}
        </DataGridTableBody>
      </DataGridTableBase>
    </DndContext>
  );
}
