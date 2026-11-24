"use client";

import type { TenantRecord } from "@/services";

export interface TenantReasonDialogProps {
  /** `suspend` or `restore`: the two lifecycle actions whose only input is a required reason. */
  action: "suspend" | "restore";
  tenant: TenantRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** RED stub (Task 9): the dialog lands with the implementation. */
export function TenantReasonDialog(_props: TenantReasonDialogProps) {
  return null;
}
