"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@schoolhub/ui";

import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { PORTAL_INVITE_PERMISSION } from "@/services/modules/students/students-constant";
import { portalInviteAction } from "@/services/modules/students/students-helper";
import type { PortalStatus } from "@/services/modules/students/students-type";
import { StudentInviteDialog } from "./student-invite-dialog";
import { usePortalInvite, type PortalInviteTarget } from "./use-portal-invite";

export interface PortalInviteButtonProps {
  target: PortalInviteTarget;
  portalStatus: PortalStatus;
}

/**
 * "Invite to portal" for a student or guardian with no usable account (`none`,
 * `inactive`), "Resend invitation" while one is pending (`invited`, `expired`,
 * `send_failed`), nothing once the account is `active`. Hidden without
 * `students.portal-account.invite`; the API enforces the key either way.
 */
export function PortalInviteButton({ target, portalStatus }: PortalInviteButtonProps) {
  const t = useTranslations("students.portal");
  const { data: currentUser } = useCurrentUser();
  const invite = usePortalInvite(target);
  const [dialogOpen, setDialogOpen] = useState(false);

  const action = portalInviteAction(portalStatus);
  if (!action || !hasPermission(currentUser, PORTAL_INVITE_PERMISSION)) return null;

  const label = t(action);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-label={`${label} — ${target.name}`}
        isLoading={target.kind === "guardian" && invite.mutation.isPending}
        loadingLabel={t("sending")}
        onClick={() => {
          if (target.kind === "student") {
            setDialogOpen(true);
            return;
          }
          invite.mutation.mutate(undefined, {
            onError: (error) => {
              toast.error(invite.describeError(error));
            },
          });
        }}
      >
        <Mail className="size-4" aria-hidden="true" /> {label}
      </Button>
      {dialogOpen && (
        <StudentInviteDialog
          target={target}
          isResend={action === "resend"}
          // `inactive` always has a linked account; `none` never does.
          hasAccount={portalStatus !== "none"}
          invite={invite}
          onOpenChange={(open) => {
            if (!open) setDialogOpen(false);
          }}
        />
      )}
    </>
  );
}
