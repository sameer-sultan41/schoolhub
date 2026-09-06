import { TableSkeleton, ScreenHeaderSkeleton } from "@schoolhub/ui";

/**
 * Route-level loading state for `/academics/promotions`.
 *
 * Shape-matched rather than generic: the header block plus the batch table: batch id, class,
 * session pair, student count and status.
 * Next renders this in place of the page while its async server component resolves, so
 * the layout it hands over to is the layout that was already on screen.
 *
 * The group-level `(app)/loading.tsx` is still the fallback for any route without one
 * of these; this one exists because a stat-tile grid is not what this screen renders.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <ScreenHeaderSkeleton />
      <TableSkeleton columns={5} />
    </div>
  );
}
