import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Card } from "./card";
import { Skeleton } from "./skeleton";

export interface StatCardProps {
  /** What the figure counts, in the reader's terms. */
  label: string;
  /** Already formatted by the caller — locale-aware formatting is the app's job. */
  value: string;
  /**
   * `ready` shows the figure. `loading` shows a skeleton the same height, so nothing
   * shifts when it arrives. `unavailable` says plainly that there is no figure to show.
   *
   * That third state is the reason this component exists. Three of the four metrics the
   * old dashboard promised — attendance today, outstanding fees, open enquiries — have no
   * backend at all, and the screen rendered a red error alert for all of them. A tile
   * that says "not available yet" is honest; an error is a lie about whose fault it is,
   * and a fabricated number is worse than either.
   */
  state: "ready" | "loading" | "unavailable";
  /** Shown in place of the figure while `state` is "unavailable". Required — no i18n here. */
  unavailableLabel: string;
  /** Decorative; hidden from assistive tech. The label already names the figure. */
  icon?: LucideIcon;
  /** A trend line, a comparison, a link to the underlying list. */
  footer?: ReactNode;
  className?: string;
}

export function StatCard({
  label,
  value,
  state,
  unavailableLabel,
  icon: Icon,
  footer,
  className,
}: StatCardProps) {
  return (
    <Card className={cn("p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        {Icon ? (
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-[var(--sh-radius)] bg-surface-sunken text-muted-foreground"
          >
            <Icon className="size-4" />
          </span>
        ) : null}
      </div>

      <div className="mt-3 min-h-9">
        {state === "loading" ? (
          <Skeleton className="h-9 w-24" />
        ) : state === "unavailable" ? (
          // Muted text, not an alert: nothing has gone wrong, the source simply does not
          // exist yet. Giving this alert semantics would announce a problem on every page
          // load for every module that has not shipped.
          <p className="text-sm text-muted-foreground">{unavailableLabel}</p>
        ) : (
          // Fraunces at a large optical size, with tabular figures so a row of tiles
          // aligns. This is the one place the type itself is doing the work.
          <p className="font-heading text-3xl leading-none font-semibold text-foreground tabular-nums">
            {value}
          </p>
        )}
      </div>

      {footer ? <div className="mt-3 text-xs text-muted-foreground">{footer}</div> : null}
    </Card>
  );
}
