"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { useCurrentUser } from "@/hooks/use-current-user";
import { homePathFor } from "@/lib/home-path";

export interface AudienceGateProps {
  /** Who the wrapped shell is for: `portal` (students and guardians) or `staff`. */
  audience: "portal" | "staff";
  children: ReactNode;
}

/**
 * Keeps each shell to its own audience. It renders nothing until `/auth/me` resolves, then
 * sends the wrong audience to its own home with `router.replace`.
 *
 * Client-side because the access token lives in memory and the proxy only sees an opaque
 * cookie (`proxy.ts`), so there is nothing server-side to decide on. This is routing, not
 * authorisation: the API enforces every call. If `/auth/me` fails the shell is shown: a
 * dead session is bounced to /login by the 401 handler, and a transient error should not
 * leave a blank page.
 */
export function AudienceGate({ audience, children }: AudienceGateProps) {
  const router = useRouter();
  const { data: user, isError } = useCurrentUser();

  const isPortalUser = user?.is_restricted_principal === true;
  const isWrongShell = user !== undefined && isPortalUser !== (audience === "portal");

  useEffect(() => {
    if (user && isWrongShell) router.replace(homePathFor(user));
  }, [user, isWrongShell, router]);

  if (user === undefined && !isError) return null;
  if (isWrongShell) return null;
  return children;
}
