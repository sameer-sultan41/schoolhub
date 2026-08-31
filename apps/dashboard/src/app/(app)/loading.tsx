import { Skeleton } from "@schoolhub/ui";

/**
 * Shown inside AppShell's <main> while any (app) segment's async server component is
 * still loading — chrome (sidebar, header) stays visible immediately since this only
 * replaces `children`, not the layout around it. Shape-matches the most common content
 * this app renders today (a stat-tile grid) rather than a generic spinner.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24 rounded-[var(--sh-radius)]" />
        ))}
      </div>
    </div>
  );
}
