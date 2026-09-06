import { ChartSkeleton, GridSkeleton, ScreenHeaderSkeleton, Skeleton } from "@schoolhub/ui";

/**
 * Route-level loading state for `/dashboard`.
 *
 * Shape-matched to what actually arrives: the header, the full-width bell-schedule band,
 * the two-by-two panel grid, and the stat row underneath. Next renders this in place of
 * the page while its async server component resolves, so the layout it hands over to is
 * the layout that was already on screen — the point being that nothing jumps when the
 * figures land.
 *
 * The group-level `(app)/loading.tsx` remains the fallback for routes without one of
 * these; this one exists because the home screen is no longer a stat-tile grid.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <ScreenHeaderSkeleton />

      {/* The band: one wide block, not a row of tiles. */}
      <Skeleton className="h-40 rounded-[var(--sh-radius)]" />

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
        <ChartSkeleton />
        <ChartSkeleton />
      </div>

      <GridSkeleton count={8} />
    </div>
  );
}
