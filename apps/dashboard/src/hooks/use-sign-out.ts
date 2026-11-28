"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { impersonationEndedPath, Paths } from "@/config/paths";
import { useIsImpersonating } from "@/hooks/use-is-impersonating";
import { Services } from "@/services";

/** Signs out: logs out on the server, drops every cached query (so the next person on this tab
 * never reads this user's `/auth/me`, the standard TanStack logout step and what the 401
 * handler does), then goes to /login. An impersonated session's sign-out ends its grant
 * (`logout` does that) and lands on the page saying the session ended (ADR-0037). */
export function useSignOut(): () => void {
  const queryClient = useQueryClient();
  const router = useRouter();
  const impersonating = useIsImpersonating();

  return () => {
    // `logout` rethrows anything that is not the expected ApiError, so a rejection is handled
    // here; the user still always reaches /login.
    void Services.auth
      .logout()
      .catch((error: unknown) => {
        console.error("Sign-out request failed unexpectedly:", error);
      })
      .finally(() => {
        queryClient.clear();
        router.replace(impersonating ? impersonationEndedPath() : Paths.LOGIN);
      });
  };
}
