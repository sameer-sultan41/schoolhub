"use client";

import type { LucideIcon } from "lucide-react";
import { m } from "motion/react";

/** The "—" -> real-number swap, animated once. `key={value}` is what makes this a real
 * element change to Motion (not a prop update on the same node), so `initial` actually
 * fires when the count first resolves — a single, orchestrated reveal for a real state
 * change (data landing), not a repeating decorative tic on every render. */
function AnimatedStat({ value }: { value: string }) {
  return (
    <m.span
      key={value}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="inline-block text-sm leading-none font-semibold text-foreground tabular-nums"
    >
      {value}
    </m.span>
  );
}

/**
 * One toolbar stat chip: icon, animated count, label. Shared between `/staff` and
 * `/students` (and any future module's toolbar) so a tweak to this shape — spacing,
 * animation timing, icon size — only has one place to make it, not one copy per
 * module silently drifting from the others.
 *
 * Purely presentational: `value` is a string the caller has already decided on, so a
 * caller wanting a loading/unavailable distinction (e.g. a skeleton while a query is
 * still pending) renders that itself and only reaches for this component once it has
 * real text to show — see `student-toolbar.tsx`'s own `statChipState` for the pattern.
 */
export function StatChip({
  icon: Icon,
  value,
  label,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="size-3.5 text-primary" aria-hidden="true" />
      <AnimatedStat value={value} />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
