"use client";

import { Button } from "@schoolhub/ui";
import { Pencil, Trash2 } from "lucide-react";

export interface RowEditRemoveActionsProps {
  /** Omit to hide the button (the viewer lacks the key). */
  editLabel?: string;
  onEdit?: () => void;
  removeLabel?: string;
  onRemove?: () => void;
}

/** A table row's Edit and Remove icon buttons. Each label names the row, so a screen-reader
 * user tabbing down the table hears which row a button acts on. */
export function RowEditRemoveActions({
  editLabel,
  onEdit,
  removeLabel,
  onRemove,
}: RowEditRemoveActionsProps) {
  return (
    <div className="flex items-center gap-1">
      {editLabel && onEdit && (
        <Button
          variant="primary"
          appearance="light"
          mode="icon"
          shape="circle"
          size="sm"
          aria-label={editLabel}
          onClick={onEdit}
        >
          <Pencil className="size-4" aria-hidden="true" />
        </Button>
      )}
      {removeLabel && onRemove && (
        <Button
          variant="destructive"
          appearance="light"
          mode="icon"
          shape="circle"
          size="sm"
          aria-label={removeLabel}
          onClick={onRemove}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
