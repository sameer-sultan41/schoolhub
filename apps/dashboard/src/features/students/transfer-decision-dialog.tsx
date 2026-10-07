"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";

export interface TransferDecisionDialogProps {
  transferId: string;
  /** Needed only to build the invalidation keys below, not for the request itself. */
  studentId: string;
  decision: "approve" | "reject";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Mounts a fresh instance per open — matching `withdraw-student-dialog.tsx`'s own
 * "mount a fresh instance per open" contract — so the idempotency key generated in
 * `useState`'s lazy initializer is a real fresh one for each decision, never regenerated
 * inside a `useEffect`.
 */
export function TransferDecisionDialog({
  transferId,
  studentId,
  decision,
  open,
  onOpenChange,
}: TransferDecisionDialogProps) {
  const t = useTranslations("students");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  // Resets if the same mounted instance is reused for a different transfer/decision pair
  // (e.g. a parent keeping one instance and swapping props rather than remounting) —
  // the dialog's own open/close doesn't invalidate the key, only a genuinely different
  // target does.
  const targetRef = useRef({ transferId, decision });
  useEffect(() => {
    if (targetRef.current.transferId !== transferId || targetRef.current.decision !== decision) {
      targetRef.current = { transferId, decision };
      setError(null);
    }
  }, [transferId, decision]);

  const mutation = useMutation({
    mutationFn: () =>
      decision === "approve"
        ? Services.studentTransfers.approveTransfer(transferId, idempotencyKey)
        : Services.studentTransfers.rejectTransfer(transferId, idempotencyKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.list("student-transfers", "transfers", { studentId }),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.list("students", "history", { studentId }),
      });
      onOpenChange(false);
    },
    onError: (mutationError) => {
      setError(resolveErrorMessage(mutationError, tErrors, t("form.submitFailed"), "non_field"));
    },
  });

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={decision === "approve" ? t("transfers.approve") : t("transfers.reject")}
      description={
        decision === "approve"
          ? t("transfers.approveDescription")
          : t("transfers.rejectDescription")
      }
      confirmLabel={decision === "approve" ? t("transfers.approve") : t("transfers.reject")}
      variant={decision === "reject" ? "destructive" : "default"}
      isPending={mutation.isPending}
      error={error ?? undefined}
      onConfirm={() => {
        mutation.mutate();
      }}
    />
  );
}
