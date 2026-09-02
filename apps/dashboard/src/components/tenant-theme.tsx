"use client";

import type { TenantBranding } from "@schoolhub/types";
import { brandingToCssVariables, checkBrandingContrast } from "@schoolhub/ui";
import { type ReactNode, useEffect } from "react";

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
  useEffect(() => {
    // A console warning, not a blocking error or a rejected save — there is no branding
    // settings screen yet to show this inline (frontend-status.md: "No module screens"),
    // and this repo's own bar is "contrast-validated with a warning on failure," not
    // "rejected." Gated on `branding` itself (not every render) so it only fires again
    // when a tenant's actual colours change, not on every AppShell re-render.
    for (const warning of checkBrandingContrast(branding)) {
      console.warn(
        `Tenant branding fails WCAG AA contrast for ${warning.pair} (${warning.ratio.toFixed(2)}:1, needs 4.5:1).`,
      );
    }
  }, [branding]);

  return (
    <div style={brandingToCssVariables(branding)} className="contents">
      {children}
    </div>
  );
}
