import type { ReactNode } from "react";
import { WovenRule } from "@/components/woven-rule";

interface ScreenHeaderProps {
  title: string;
  /** One sentence saying what this screen is for. Omit rather than pad. */
  description?: string;
  /** Screen-level actions — "New student", "Import". Row actions belong in the table. */
  actions?: ReactNode;
}

/**
 * The top of every screen: an h1, an optional sentence, an optional actions row, and
 * the one WovenRule that screen is allowed.
 *
 * Every route used to inline this same block, which is why the rule drifted onto some
 * screens twice and off others entirely, and why the description's width was whatever
 * the container happened to be.
 *
 * `max-w-prose` on the description is doing real work: the line-length rule is not a
 * nicety here, because Urdu Nastaliq sets considerably wider than Latin at the same
 * point size, so a description that reads fine in English becomes a single unbroken
 * line to the far edge of a wide viewport in `ur`. Capping by measure fixes both
 * locales with one rule.
 *
 * No `"use client"`: this is markup only, so it renders inside the async server
 * components that own each route's chrome — same as `WovenRule` itself.
 */
export function ScreenHeader({ title, description, actions }: ScreenHeaderProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold text-foreground">{title}</h1>
          {description ? (
            <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <WovenRule className="max-w-24" />
    </div>
  );
}
