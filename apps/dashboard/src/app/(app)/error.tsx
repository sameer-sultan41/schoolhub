"use client";

import { Alert, AlertDescription, AlertTitle, Button } from "@schoolhub/ui";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

/**
 * Catches a render/data error anywhere in the (app) segment. Runs inside the root
 * layout's providers (unlike global-error.tsx), so next-intl is available here.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");
  const tCommon = useTranslations("common");

  useEffect(() => {
    console.error("Unhandled error in the (app) segment:", error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center py-12">
      <Alert variant="danger" className="max-w-md">
        <AlertTitle>{t("pageErrorTitle")}</AlertTitle>
        <AlertDescription className="space-y-4">
          <p>{t("pageErrorBody")}</p>
          <Button variant="outline" size="sm" onClick={reset}>
            {tCommon("retry")}
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
