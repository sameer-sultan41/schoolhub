"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import { Paths } from "@/config/paths";
import { useCurrentUser } from "@/hooks/use-current-user";
import { ApiError } from "@/services";

function isMfaRequired(error: unknown): boolean {
  return error instanceof ApiError && error.code === "mfa_required";
}

/**
 * The console needs a second factor (SEC-06): an operator whose `/auth/me` says TOTP is off is
 * sent to enrol before the console renders, and any console read the API refuses with 403
 * `mfa_required` (a session without the factor) sends them there too. Routing only: the API
 * refuses every console route without the factor regardless (ADR-0036).
 */
export function PlatformMfaGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const needsEnrolment = user?.is_platform === true && user.mfa_enabled === false;

  useEffect(() => {
    if (needsEnrolment) router.replace(Paths.MFA_ENROLL);
  }, [needsEnrolment, router]);

  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.type === "updated" && isMfaRequired(event.query.state.error)) {
          router.replace(Paths.MFA_ENROLL);
        }
      }),
    [queryClient, router],
  );

  if (needsEnrolment) return null;
  return children;
}
