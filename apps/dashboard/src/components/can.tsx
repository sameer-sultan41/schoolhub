"use client";

import type { PermissionKey } from "@schoolhub/types";
import type { ReactNode } from "react";
import { useAnyPermission, usePermission } from "@/hooks/use-session";

interface CanProps {
  /** Single permission key, e.g. `fees.invoice.create`. */
  permission?: PermissionKey;
  /** Any-of list, for a screen reachable through several permissions. */
  anyOf?: PermissionKey[];
  /** Rendered when the user lacks the permission. Default: render nothing. */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Permission-gated rendering.
 *
 * ```tsx
 * <Can permission="fees.invoice.create">
 *   <Button>New invoice</Button>
 * </Can>
 * ```
 *
 * Hiding UI is UX only — the API enforces the same key server-side. Never wrap sensitive
 * *data* in this and assume it is protected: if the data reached the client, it leaked.
 */
export function Can({ permission, anyOf, fallback = null, children }: CanProps) {
  const hasSingle = usePermission(permission ?? "__none__.__none__.__none__");
  const hasAny = useAnyPermission(anyOf ?? []);
  const allowed = permission ? hasSingle : anyOf ? hasAny : false;

  return <>{allowed ? children : fallback}</>;
}
