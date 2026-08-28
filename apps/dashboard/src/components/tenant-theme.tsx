"use client";

import type { TenantBranding } from "@schoolhub/types";
import { brandingToCssVariables } from "@schoolhub/ui";
import type { ReactNode } from "react";

/**
 * Applies the tenant's branding as `--sh-*` custom properties on a wrapper element.
 *
 * Every themed utility in `packages/ui` resolves through these variables, so one wrapper
 * re-themes the entire subtree. No component below this point knows the tenant's colours,
 * and nothing in the tree may hardcode a brand colour.
 */
export function TenantTheme({
  branding,
  children,
}: {
  branding: TenantBranding | null | undefined;
  children: ReactNode;
}) {
  return (
    <div style={brandingToCssVariables(branding)} className="contents">
      {children}
    </div>
  );
}
