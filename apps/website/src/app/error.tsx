"use client";

import { Alert, AlertDescription, AlertTitle, Button } from "@schoolhub/ui";
import { useEffect } from "react";

/**
 * Catches a render/data error while serving a tenant's public page. Hardcoded English,
 * matching not-found.tsx's own convention — this app has no next-intl wired up yet.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error while rendering a public page:", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl items-center justify-center px-6 py-24">
      <Alert variant="danger">
        <AlertTitle>Something went wrong</AlertTitle>
        <AlertDescription className="space-y-4">
          <p>This page hit an unexpected error. Try again in a moment.</p>
          <Button variant="outline" size="sm" onClick={reset}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    </main>
  );
}
