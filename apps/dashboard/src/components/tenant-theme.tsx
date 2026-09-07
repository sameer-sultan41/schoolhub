"use client";

import type { TenantBranding } from "@schoolhub/types";
import { brandingToCssVariables } from "@schoolhub/ui";
import type { ReactNode } from "react";
import { usePreference } from "@/lib/preferences/preferences-provider";

/**
 * Applies the tenant's branding as `--sh-*` custom properties on a wrapper element.
 *
 * Every themed utility in `packages/ui` resolves through these variables, so one wrapper
 * re-themes the entire subtree. No component below this point knows the tenant's colours,
 * and nothing in the tree may hardcode a brand colour.
 *
 * Applied only under the "tenant" preset. These are inline properties, which outrank
 * every `[data-theme-preset]` rule on specificity — so if they were always emitted, a
 * viewer could never actually see a preset they had chosen: the school's primary would
 * keep winning and the picker would look broken. Choosing a preset is a viewer saying
 * "show me this palette, not my school's", so the branding stands down and the preset's
 * stylesheet takes effect.
 *
 * `className="contents"` is load-bearing: it keeps this wrapper out of the layout box
 * tree so the shell's flex chain still reaches its children.
 */
export function TenantTheme({
  branding,
  children,
}: {
  branding: TenantBranding | null | undefined;
  children: ReactNode;
}) {
  const preset = usePreference("theme_preset");
  const style = preset === "tenant" ? brandingToCssVariables(branding) : undefined;

  return (
    <div style={style} className="contents">
      {children}
    </div>
  );
}
