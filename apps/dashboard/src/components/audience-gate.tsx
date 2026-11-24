"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { useCurrentUser } from "@/hooks/use-current-user";
import { homePathFor } from "@/lib/home-path";

export type Audience = "portal" | "staff" | "platform";

export interface AudienceGateProps {
  /** Who the wrapped shell is for: `portal` (students and guardians), `staff`, or `platform`
   * (the console's operators). */
  audience: Audience;
  children: ReactNode;
}

/** The one shell a signed-in user belongs in; `homePathFor` is its landing page. */
export function audienceOf(user: {
  is_platform?: boolean;
  is_restricted_principal?: boolean;
}): Audience {
  if (user.is_platform === true) return "platform";
  return user.is_restricted_principal === true ? "portal" : "staff";
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

  const isWrongShell = user !== undefined && audienceOf(user) !== audience;

  useEffect(() => {
    if (user && isWrongShell) router.replace(homePathFor(user));
  }, [user, isWrongShell, router]);

  if (user === undefined && !isError) return null;
  if (isWrongShell) return null;
  return children;
}
