"use client";

import { useTranslations } from "next-intl";
import { Alert, AlertContent, AlertDescription, AlertTitle } from "@schoolhub/ui";
import { CircleAlert } from "lucide-react";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type AcademicSessionRecord } from "@/services";
import { SCHOOL_ORGANIZATION_QUERY_MODULE } from "@/services/modules/school-organization/school-organization-constant";
import { sessionStructureIssues } from "@/services/modules/school-organization/school-organization-helper";

export type SessionLifecycleAction = "activate" | "close";

export interface SessionLifecycleDialogProps {
  action: SessionLifecycleAction;
  session: AcademicSessionRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** What blocks activation, one line per gap, so the school fixes them in one pass. */
function StructureChecklist({ issues }: { issues: readonly string[] }) {
  const t = useTranslations("school");
  return (
    <Alert variant="destructive">
      <AlertContent>
        <AlertTitle>{t("sessions.lifecycle.structureTitle")}</AlertTitle>
        <AlertDescription>
          <ul className="space-y-1">
            {issues.map((issue) => (
              <li key={issue} className="flex items-start gap-2">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>{issue}</span>
              </li>
            ))}
          </ul>
        </AlertDescription>
      </AlertContent>
    </Alert>
  );
}

/**
 * Activates a planned session (`:activate`), making it the school's current year, or closes
 * the active one (`:close`), making its records read-only. An activation the structure isn't
 * ready for comes back as a 422 `{structure: [...]}` naming every gap at once (an active
 * campus, a class with a section, terms covering the year); those show as a checklist. Any
 * other refusal is one inline sentence, and the dialog stays open either way.
 *
 * Mounting contract: the caller mounts this only while it is open, so every open starts with
 * no stale error.
 */
export function SessionLifecycleDialog({
  action,
  session,
  open,
  onOpenChange,
}: SessionLifecycleDialogProps) {
  const t = useTranslations("school");
  const tCommon = useTranslations("common");
  const invalidate = useInvalidateModule(SCHOOL_ORGANIZATION_QUERY_MODULE);

  const { error, failure, isPending, confirm } = useConfirmAction({
    mutationFn: () =>
      action === "activate"
        ? Services.schoolOrganization.activateSession(session.id)
        : Services.schoolOrganization.closeSession(session.id),
    onSuccess: () => {
      invalidate();
      toast.success(t(`sessions.lifecycle.${action}Done`, { name: session.name }));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });
  const structureIssues = sessionStructureIssues(failure);

  return (
    <ResponsiveAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(`sessions.lifecycle.${action}Title`, { name: session.name })}
      description={t(`sessions.lifecycle.${action}Description`)}
      confirmLabel={t(`sessions.lifecycle.${action}Confirm`)}
      variant={action === "close" ? "destructive" : undefined}
      isPending={isPending}
      error={structureIssues.length > 0 ? undefined : (error ?? undefined)}
      onConfirm={confirm}
    >
      {structureIssues.length > 0 && <StructureChecklist issues={structureIssues} />}
    </ResponsiveAlertDialog>
  );
}
