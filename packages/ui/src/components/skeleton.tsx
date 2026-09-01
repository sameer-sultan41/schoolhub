import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

/**
 * Placeholder for content still loading. `aria-hidden` because the meaningful state is
 * whatever `aria-busy`/`role="status"` the CONSUMER puts on the region this sits inside —
 * a skeleton describing itself to a screen reader (e.g. "loading, loading, loading" once
 * per tile) is noise, not information.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-[var(--sh-radius)] bg-muted", className)}
      {...props}
    />
  );
}
