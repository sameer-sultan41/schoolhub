"use client";

import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { ApiError, Services } from "@/services";
import { portalInviteConflict } from "@/services/modules/students/students-helper";

/** Who a portal invite is for. A student's invite carries an email; a guardian's uses the one on file. */
export interface PortalInviteTarget {
  kind: "guardian" | "student";
  id: string;
  name: string;
}

/**
 * Sends (or resends) a portal invitation, then reloads the person so their badge shows the
 * new `portal_status`. One `Idempotency-Key` per intent: a retry after a dropped or
 * rate-limited request reuses it, so a double-click or a retry never sends two emails; any
 * definite answer starts the next attempt with a new key.
 */
export function usePortalInvite(target: PortalInviteTarget) {
  const t = useTranslations("students.portal");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const keyRef = useRef<string | null>(null);

  const mutation = useMutation({
    mutationFn: (email: string | undefined) => {
      keyRef.current ??= crypto.randomUUID();
      return target.kind === "guardian"
        ? Services.guardians.inviteGuardian(target.id, keyRef.current)
        : Services.students.inviteStudent(target.id, email ?? "", keyRef.current);
    },
    onSuccess: () => {
      keyRef.current = null;
      toast.success(t("sent", { name: target.name }));
      void queryClient.invalidateQueries({
        queryKey:
          target.kind === "guardian"
            ? queryKeys.detail("guardians", "guardians", target.id)
            : queryKeys.detail("students", "students", target.id),
      });
    },
    onError: (error: unknown) => {
      if (!(error instanceof ApiError && error.isTransient)) keyRef.current = null;
    },
  });

  /** The message for a failed invite: the 409's own reason, else the API's error (a
   * missing guardian email is a 400 on `email`). */
  function describeError(error: unknown): string {
    const conflict = error instanceof ApiError ? portalInviteConflict(error.code) : null;
    if (conflict) return t(`errors.${conflict}`);
    return resolveErrorMessage(error, tErrors, t("failed"), "email");
  }

  return { mutation, describeError };
}
