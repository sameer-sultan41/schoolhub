import { Skeleton } from "@schoolhub/ui";

/** Shown while a page's server-side data fetch (tenant resolution, CMS content) is pending. */
export default function Loading() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-16">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-48 w-full" />
    </main>
  );
}
