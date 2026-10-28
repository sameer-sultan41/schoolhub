"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Button, Skeleton } from "@schoolhub/ui";
import { Check, X } from "lucide-react";

/** What a reviewer can do with a pending request. */
export type DecisionAction = "approve" | "reject";

export interface DecisionActionsProps<TRecord> {
  record: TRecord;
  /** Each button's accessible name, naming the row. */
  approveLabel: string;
  rejectLabel: string;
  onDecide: (record: TRecord, action: DecisionAction) => void;
}

/** A queue row's Approve and Reject icon buttons. */
export function DecisionActions<TRecord>({
  record,
  approveLabel,
  rejectLabel,
  onDecide,
}: DecisionActionsProps<TRecord>) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="primary"
        appearance="light"
        mode="icon"
        shape="circle"
        size="sm"
        aria-label={approveLabel}
        onClick={() => {
          onDecide(record, "approve");
        }}
      >
        <Check className="size-4" aria-hidden="true" />
      </Button>
      <Button
        variant="destructive"
        appearance="light"
        mode="icon"
        shape="circle"
        size="sm"
        aria-label={rejectLabel}
        onClick={() => {
          onDecide(record, "reject");
        }}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

export interface DecisionActionsColumnOptions<TRecord> {
  id: string;
  /** The column's screen-reader header. */
  header: string;
  /** Whether the viewer may decide this row; a row they can't shows no buttons. */
  canDecide: (record: TRecord) => boolean;
  labels: (record: TRecord) => { approve: string; reject: string };
  onDecide: (record: TRecord, action: DecisionAction) => void;
}

/** An approval queue's actions column: Approve and Reject on each row the viewer may decide. */
export function decisionActionsColumn<TRecord>({
  id,
  header,
  canDecide,
  labels,
  onDecide,
}: DecisionActionsColumnOptions<TRecord>): ColumnDef<TRecord> {
  return {
    id,
    header: () => <span className="sr-only">{header}</span>,
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => {
      const record = row.original;
      if (!canDecide(record)) return null;
      const { approve, reject } = labels(record);
      return (
        <DecisionActions
          record={record}
          approveLabel={approve}
          rejectLabel={reject}
          onDecide={onDecide}
        />
      );
    },
    meta: { skeleton: <Skeleton className="size-7 rounded-full" /> },
  };
}
