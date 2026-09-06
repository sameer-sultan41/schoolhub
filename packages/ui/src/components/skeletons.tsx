import { cn } from "../lib/cn";
import { Skeleton } from "./skeleton";

/**
 * Shape-matched loading states.
 *
 * The point is that a loading table looks like a table and a loading chart looks like a
 * chart, so nothing on the page jumps when the data arrives. A single grey rectangle
 * standing in for every kind of content is the thing these replace: it tells the reader
 * only that something is happening, and then rearranges the page under them.
 *
 * Every skeleton here is `aria-hidden` by way of the `Skeleton` primitive — the container
 * that owns the loading state carries `aria-busy`, so assistive tech hears one
 * announcement rather than a wall of unlabelled boxes.
 */

export function ScreenHeaderSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-3 w-24" />
    </div>
  );
}

export function TableSkeleton({
  rows = 6,
  columns = 5,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex gap-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-40" />
      </div>
      <div className="overflow-hidden rounded-[var(--sh-radius)] border border-border">
        <div className="flex gap-4 border-b border-border bg-surface-sunken px-4 py-3">
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={`head-${String(column)}`} className="h-4 flex-1" />
          ))}
        </div>
        {Array.from({ length: rows }, (_, row) => (
          <div
            key={`row-${String(row)}`}
            className="flex gap-4 border-b border-border px-4 py-3 last:border-b-0"
          >
            {Array.from({ length: columns }, (_, column) => (
              <Skeleton key={`cell-${String(row)}-${String(column)}`} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function GridSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={`tile-${String(index)}`} className="h-28 rounded-[var(--sh-radius)]" />
      ))}
    </div>
  );
}

/**
 * Bars of varying height rather than one flat block: a rectangle where a chart will be
 * reads as a broken image, and the staggered heights say "a comparison is loading here".
 * The heights are fixed, not random — a skeleton that reshuffles on every render draws
 * attention to itself, which is the opposite of its job.
 */
const CHART_SKELETON_HEIGHTS = ["h-16", "h-24", "h-32", "h-20", "h-28", "h-14"] as const;

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      <Skeleton className="h-4 w-40" />
      <div className="flex h-40 items-end gap-3">
        {CHART_SKELETON_HEIGHTS.map((height, index) => (
          <Skeleton key={`bar-${String(index)}`} className={cn("flex-1", height)} />
        ))}
      </div>
    </div>
  );
}

export function DetailSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-6", className)}>
      <div className="flex items-center gap-4">
        <Skeleton className="size-14 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={`tab-${String(index)}`} className="h-9 w-28" />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={`field-${String(index)}`} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-40" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function FormSkeleton({ fields = 6, className }: { fields?: number; className?: string }) {
  return (
    <div className={cn("space-y-6", className)}>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: fields }, (_, index) => (
          <div key={`field-${String(index)}`} className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-10 w-24" />
      </div>
    </div>
  );
}
