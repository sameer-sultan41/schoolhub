import { Skeleton } from "@schoolhub/ui";

/** Shape-matched to the bare placeholder page.tsx renders today. */
export default function Loading() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-64" />
    </div>
  );
}
