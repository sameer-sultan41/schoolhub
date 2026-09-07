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
  /**
   * Paints the icon chip with one slot of the chart ramp, so a row of tiles reads as a
   * set of distinct things rather than as a grey wall.
   *
   * Identity, never rank or status: theme.css's ramp rule is "colour follows the entity",
   * so a tile keeps its slot regardless of its figure. Never use this to mean good/bad —
   * that is success/warning/danger's job, and it needs an icon and a label besides.
   * Omit it and the chip stays neutral.
   */
  accent?: 1 | 2 | 3 | 4 | 5 | 6;
  /** A trend line, a comparison, a link to the underlying list. */
  footer?: ReactNode;
  className?: string;
}

/**
 * Written out rather than built as `bg-chart-${n}/12`: Tailwind scans source text, so an
 * interpolated class name is a class that never gets generated.
 *
 * The tint is lighter in dark mode (/10 vs /12) for the reason badge.tsx documents at
 * length — compositing the hue over the surface moves the background TOWARD the icon, so
 * a heavier tint lowers contrast rather than raising it. At /12 on the dark surface slot 6
 * measures 2.99:1, just under WCAG 1.4.11's 3:1 for a graphical object; /10 restores every
 * slot to >= 3.13:1.
 *
 * The hue IS the icon colour here, unlike Badge's soft variant which takes page ink. An
 * icon is a graphical object at a 3:1 floor, not text at 4.5:1, and every slot clears that
 * on its own tint (worst 3.21:1 light, 3.13:1 dark).
 */
const ACCENT_CHIP: Record<NonNullable<StatCardProps["accent"]>, string> = {
  1: "bg-chart-1/12 text-chart-1 dark:bg-chart-1/10",
  2: "bg-chart-2/12 text-chart-2 dark:bg-chart-2/10",
  3: "bg-chart-3/12 text-chart-3 dark:bg-chart-3/10",
  4: "bg-chart-4/12 text-chart-4 dark:bg-chart-4/10",
  5: "bg-chart-5/12 text-chart-5 dark:bg-chart-5/10",
  6: "bg-chart-6/12 text-chart-6 dark:bg-chart-6/10",
};

export function StatCard({
  label,
  value,
  state,
  unavailableLabel,
  icon: Icon,
  accent,
  footer,
  className,
}: StatCardProps) {
  // `raised`, which is what card.tsx's own docstring says this elevation is for: "a stat
  // tile, a panel that should read as its own object". These tiles were taking the `flat`
  // default, so a row of them sat at the same depth as the page behind them — invisible
  // while the page was also white, and merely wrong once the canvas took a tint and cards
  // went pure white.
  return (
    <Card elevation="raised" className={cn("p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        {Icon ? (
          <span
            aria-hidden="true"
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-[var(--sh-radius)]",
              accent ? ACCENT_CHIP[accent] : "bg-surface-sunken text-muted-foreground",
            )}
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
          // The numeric face, not the display serif this used to wear: a figure is
          // data, and a monospace with true tabular digits keeps a row of tiles
          // aligned and stops a value that updates in place from reflowing its tile.
          // The label above is still set in the body face — only the number changes.
          <p className="font-numeric text-3xl leading-none font-bold text-foreground tabular-nums">
            {value}
          </p>
        )}
      </div>

      {footer ? <div className="mt-3 text-xs text-muted-foreground">{footer}</div> : null}
    </Card>
  );
}
