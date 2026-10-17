"use client";

import type { TeacherAllocationRecord } from "@/services";
import { ALLOCATION_ROW_ACTION } from "@/services/modules/teacher-allocations/teacher-allocations-constant";
import type { AllocationRowAction } from "@/services/modules/teacher-allocations/teacher-allocations-type";
import { DeleteAllocationDialog } from "./delete-allocation-dialog";
import { EditAllocationDialog } from "./edit-allocation-dialog";
import { EndAllocationDialog } from "./end-allocation-dialog";
import { ReinstateAllocationDialog } from "./reinstate-allocation-dialog";

/** The row a table action was raised on, and which action. */
export interface AllocationRowDialogTarget {
  action: AllocationRowAction;
  record: TeacherAllocationRecord;
}

export interface AllocationRowDialogProps {
  target: AllocationRowDialogTarget;
  onClose: () => void;
}

/** The dialog for a row's action; rendered only while a target exists, so each open is fresh. */
export function AllocationRowDialog({ target, onClose }: AllocationRowDialogProps) {
  const dialogProps = {
    open: true,
    record: target.record,
    onOpenChange: (open: boolean) => {
      if (!open) onClose();
    },
  };

  switch (target.action) {
    case ALLOCATION_ROW_ACTION.edit:
      return <EditAllocationDialog {...dialogProps} />;
    case ALLOCATION_ROW_ACTION.end:
      return <EndAllocationDialog {...dialogProps} />;
    case ALLOCATION_ROW_ACTION.reinstate:
      return <ReinstateAllocationDialog {...dialogProps} />;
    case ALLOCATION_ROW_ACTION.remove:
      return <DeleteAllocationDialog {...dialogProps} />;
  }
}
