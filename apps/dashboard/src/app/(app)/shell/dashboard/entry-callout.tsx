"use client";

import { useQuery } from "@tanstack/react-query";

import { Card, CardContent, Skeleton, cn } from "@schoolhub/ui";

import { Services } from "@/services";

/**
 * Repurposed from the vendor Metronic template's entry-callout.tsx (originally a
 * KeenThemes marketing card) into a welcome banner naming the signed-in user. The
 * original's "Get Started" CTA is dropped rather than pointed at a dead link — this
 * branch has no other route to send it to yet.
 */
export function EntryCallout({ className }: { className?: string }) {
  const { data: user, isPending, isError } = useQuery({
    queryKey: ["dashboard", "current-user"],
    queryFn: () => Services.auth.fetchCurrentUser(),
  });

  return (
    <Card className={cn("h-full", className)}>
      <CardContent className="flex h-full flex-col justify-center gap-4 p-10">
        {isPending ? (
          <>
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-64" />
          </>
        ) : (
          <>
            <h2 className="text-mono text-xl font-semibold">
              {/* A failed fetch still greets, without a name — a name-less "Welcome
                  back" is a fine, honest fallback for a banner (unlike a stats widget
                  showing fabricated numbers), so this stays a plain conditional rather
                  than a QueryErrorMessage. isError is checked explicitly rather than
                  left implicit in `user` being undefined, so this reads as a chosen
                  fallback and not an accidental one. */}
              Welcome back{!isError && user ? `, ${user.full_name}` : ""}
            </h2>
            <p className="text-sm leading-5.5 font-normal text-secondary-foreground">
              Here&apos;s what&apos;s happening across your school today.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
