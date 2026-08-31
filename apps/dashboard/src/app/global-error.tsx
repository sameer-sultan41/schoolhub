"use client";

import { Button } from "@schoolhub/ui";
import { useEffect } from "react";

/**
 * Catches an error in the ROOT layout itself (providers, fonts, next-intl) — the one
 * place in this app that genuinely cannot use next-intl, because the failure may be in
 * the very provider tree that would supply it. Next.js requires this file to render its
 * own <html>/<body>, since it replaces the root layout entirely. Hardcoded English only,
 * deliberately: there is no locale to read at this point, and guessing wrong would be
 * worse than a plain, working fallback in one language.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error in the root layout:", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center bg-primary px-4">
        <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-surface p-6 text-center shadow-lg">
          <p className="text-lg font-semibold text-surface-foreground">Something went wrong</p>
          <p className="text-sm text-muted-foreground">
            The application hit an unexpected error. Try again, or reload the page.
          </p>
          <Button variant="outline" block onClick={reset}>
            Try again
          </Button>
        </div>
      </body>
    </html>
  );
}
