"use client";

import type { PlanRecord } from "@/services";

export interface PlanFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The plan to edit; without one the dialog creates a plan. */
  plan?: PlanRecord;
}

/** RED stub (Task 9): the dialog lands with the implementation. */
export function PlanFormDialog(_props: PlanFormDialogProps) {
  return null;
}
