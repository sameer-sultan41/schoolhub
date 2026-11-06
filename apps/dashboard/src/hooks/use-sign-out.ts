"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { Paths } from "@/config/paths";
import { Services } from "@/services";

/** Signs out: logs out on the server, drops every cached query (so the next person on this tab
 * never reads this user's `/auth/me`, the standard TanStack logout step and what the 401
 * handler does), then goes to /login. */
export function useSignOut(): () => void {
  const queryClient = useQueryClient();
  const router = useRouter();

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
        router.replace(Paths.LOGIN);
      });
  };
}
