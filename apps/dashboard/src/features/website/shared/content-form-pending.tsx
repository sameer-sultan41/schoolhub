"use client";

import { useTranslations } from "next-intl";
import { Skeleton } from "@schoolhub/ui";

import { LoadErrorCard } from "@/components/load-error-card";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { resolveErrorMessage } from "@/lib/error-message";

export interface ContentFormPendingProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  error: Error | null;
  onRetry: () => void;
}

/**
 * An edit dialog while its record's detail loads (a list row lacks the rich text), or the reason
 * it could not. The form itself mounts only once the detail is in, so it starts from the saved
 * values and no prefill lands after mount.
 */
export function ContentFormPending({
  open,
  onOpenChange,
  title,
  error,
  onRetry,
}: ContentFormPendingProps) {
  const t = useTranslations("website.content");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="space-y-4">
          {error ? (
            <LoadErrorCard
              message={resolveErrorMessage(error, tErrors, t("detailLoadError"))}
              onRetry={onRetry}
            />
          ) : (
            <>
              <p className="sr-only" role="status">
                {t("loadingTitle")}
              </p>
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-32 w-full" />
            </>
          )}
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
