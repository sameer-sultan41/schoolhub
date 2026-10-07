"use client";

import { useTranslations } from "next-intl";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import type { GuardianRecord } from "@/services";
import { GuardianPickerBody } from "./guardian-picker-body";

export interface GuardianPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  /** This student's already-linked guardians' ids — hidden from search results, since
   * picking one would only ever hit the backend's duplicate-link conflict. */
  excludedGuardianIds?: string[];
  /** `true` when the student currently has zero guardian links — the one being linked
   * now becomes primary by default (module doc §11), not left for a separate action. */
  isFirstGuardian?: boolean;
  /** A guardian already created by a previous, abandoned run of this same dialog — its
   * "Create new" submission succeeded, but the dialog was closed (Cancel or the close
   * affordance) before the link step completed. When set, the dialog resumes directly
   * at the link step for THIS guardian instead of starting over at the choose step.
   * Guardians have no delete endpoint and `GuardianViewSet` only surfaces guardians with
   * at least one student link to a campus-scoped searcher — so restarting at "choose"
   * would make this record unfindable, and the next "Create new" would silently create
   * a permanent duplicate of the same person (see `onGuardianCreated` below). */
  resumeGuardian?: GuardianRecord | null;
  /** Fires the instant a guardian is created here, before the link step completes —
   * lets the caller (`StudentGuardiansTab`) remember its id in state that outlives this
   * dialog's own lifetime, so a Cancel/close before linking is recoverable via
   * `resumeGuardian` above instead of losing the id (and the record) for good. */
  onGuardianCreated?: (guardian: GuardianRecord) => void;
  onLinked: () => void;
}

/**
 * The `ResponsiveDialog` shell only — see `./guardian-picker-body` for the actual
 * search/create/link content, split out to keep this file under the 400-line
 * `max-lines` ESLint cap.
 */
export function GuardianPickerDialog({
  open,
  onOpenChange,
  studentId,
  excludedGuardianIds = [],
  isFirstGuardian = false,
  resumeGuardian = null,
  onGuardianCreated,
  onLinked,
}: GuardianPickerDialogProps) {
  const t = useTranslations("students");
  const tCommon = useTranslations("common");

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} nested>
      <ResponsiveDialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("guardians.link")}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        {open ? (
          <GuardianPickerBody
            key={studentId}
            studentId={studentId}
            excludedGuardianIds={excludedGuardianIds}
            isFirstGuardian={isFirstGuardian}
            resumeGuardian={resumeGuardian}
            onGuardianCreated={onGuardianCreated}
            onOpenChange={onOpenChange}
            onLinked={onLinked}
          />
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
