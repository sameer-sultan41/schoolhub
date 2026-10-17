"use client";

import { useTranslations } from "next-intl";
import { Button, Card } from "@schoolhub/ui";

export interface LoadErrorCardProps {
  /** Already translated or resolved: the card says exactly this. */
  message: string;
  onRetry: () => void;
}

/** A list that failed to load: the reason, and a Retry button (`common.retry`). */
export function LoadErrorCard({ message, onRetry }: LoadErrorCardProps) {
  const tCommon = useTranslations("common");

  return (
    <Card>
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button variant="outline" onClick={onRetry}>
          {tCommon("retry")}
        </Button>
      </div>
    </Card>
  );
}
