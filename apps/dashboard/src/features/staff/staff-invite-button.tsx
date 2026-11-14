"use client";

import { useRef } from "react";
import { Mail } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@schoolhub/ui";

import { useCurrentUser } from "@/hooks/use-current-user";
import { NON_FIELD, resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { ApiError, Services } from "@/services";
import {
  STAFF_EXITED_STATUSES,
  STAFF_INVITE_PERMISSION,
} from "@/services/modules/staff/staff-constant";
import { staffInviteConflict } from "@/services/modules/staff/staff-helper";
import type { StaffDetailRecord } from "@/services/modules/staff/staff-type";

/**
 * Invites a staff member to sign in (`POST /staff/{id}:invite`, ADR-0033). With no login
 * account yet it reads "Send invitation"; once one is linked it reads "Resend invitation".
 * The staff record does not say whether that account is still pending or already active,
 * so the API decides: a pending account gets a fresh link, an active one is a 409
 * `already_active`, shown as such. Hidden for an exited staff member and without the key.
 */
export function StaffInviteButton({ staff, name }: { staff: StaffDetailRecord; name: string }) {
  const t = useTranslations("staff.invite");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  // One key per intent: a retry after a transient failure reuses it, so it never sends twice.
  const keyRef = useRef<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      keyRef.current ??= crypto.randomUUID();
      return Services.staff.inviteStaff(staff.id, keyRef.current);
    },
    onSuccess: () => {
      keyRef.current = null;
      toast.success(t("sent", { name }));
      void queryClient.invalidateQueries({
        queryKey: queryKeys.detail("staff", "staff", staff.id),
      });
    },
    onError: (error: unknown) => {
      if (!(error instanceof ApiError && error.isTransient)) keyRef.current = null;
      const conflict = error instanceof ApiError ? staffInviteConflict(error.code) : null;
      toast.error(
        conflict
          ? t(`errors.${conflict}`)
          : resolveErrorMessage(error, tErrors, t("failed"), NON_FIELD),
      );
    },
  });

  if (!hasPermission(currentUser, STAFF_INVITE_PERMISSION)) return null;
  if (STAFF_EXITED_STATUSES.includes(staff.employment_status)) return null;

  const hasAccount = staff.user_id !== null;
  const label = hasAccount ? t("resend") : t("send");
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">
        {hasAccount ? t("resendHint") : t("sendHint")}
      </span>
      <Button
        variant="outline"
        size="sm"
        aria-label={`${label} — ${name}`}
        isLoading={mutation.isPending}
        loadingLabel={t("sending")}
        onClick={() => {
          mutation.mutate();
        }}
      >
        <Mail className="size-4" aria-hidden="true" /> {label}
      </Button>
    </div>
  );
}
