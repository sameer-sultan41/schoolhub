import { DetailSkeleton, ScreenHeaderSkeleton } from "@schoolhub/ui";

/**
 * Route-level loading state for `/staff/[staffId]`.
 *
 * Shape-matched rather than generic: the header block plus the staff record: avatar, name, the
 * tab strip, and the field pairs beneath it.
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
      <DetailSkeleton />
    </div>
  );
}
