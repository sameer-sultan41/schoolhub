"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, cn, Skeleton } from "@schoolhub/ui";

import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetFooter,
  ResponsiveSheetTitle,
} from "@/components/responsive-dialog";
import { LoadErrorCard } from "@/components/load-error-card";
import { resolveErrorMessage } from "@/lib/error-message";
import { formatLastUpdated } from "@/lib/helpers";
import type { WebsiteContentStatus } from "@/services";
import { ContentStatusBadge } from "./content-status-badge";
import { RichTextView } from "./rich-text-view";

/** One labelled value of a detail sheet. */
export function ContentFact({
  label,
  children,
  wide,
}: {
  label: string;
  children: ReactNode;
  /** Spans both columns, for a longer value. */
  wide?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", wide && "col-span-2")}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium break-words text-foreground">{children}</dd>
    </div>
  );
}

/** The detail as the sheet shows it, once loaded. */
export interface ContentDetailView {
  title: string;
  status: WebsiteContentStatus;
  updatedAt: string;
  /** The rich-text document (news `body`, event `description`). */
  richText: unknown;
}

export interface ContentDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `undefined` while the detail loads. */
  detail: ContentDetailView | undefined;
  error: Error | null;
  onRetry: () => void;
  /** The facts above the text (`ContentFact`s). */
  facts: ReactNode;
  /** Where the text sits: "Body" or "Description". */
  richTextLabel: string;
  /** The actions: Edit, the lifecycle and Delete. */
  footer: ReactNode;
  /** Why the viewer can't change it (a live record without the publish key), above its facts. */
  notice?: string | null;
}

/**
 * A news post or event read-only: title, status, when it last changed, its facts and its
 * rich text, with its actions in the footer. Every line derived from the detail waits for it.
 */
export function ContentDetailSheet({
  open,
  onOpenChange,
  detail,
  error,
  onRetry,
  facts,
  richTextLabel,
  footer,
  notice,
}: ContentDetailSheetProps) {
  const t = useTranslations("website.content");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent
        closeLabel={tCommon("close")}
        className="gap-0 p-0 sm:w-[520px] sm:max-w-none"
      >
        <div className="flex flex-col gap-1.5 border-b border-border px-6 py-5 pe-14">
          <ResponsiveSheetTitle className="text-lg font-semibold">
            {detail ? detail.title : t("loadingTitle")}
          </ResponsiveSheetTitle>
          {detail ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <ContentStatusBadge status={detail.status} />
              <span>{t("lastUpdated", { when: formatLastUpdated(detail.updatedAt) })}</span>
            </div>
          ) : (
            <Skeleton className="h-5 w-40" />
          )}
        </div>
        <ResponsiveSheetBody className="flex flex-col gap-6 px-6 py-5">
          {error && detail === undefined ? (
            <LoadErrorCard
              message={resolveErrorMessage(error, tErrors, t("detailLoadError"))}
              onRetry={onRetry}
            />
          ) : detail ? (
            <>
              {notice ? (
                <Alert variant="info">
                  <AlertDescription>{notice}</AlertDescription>
                </Alert>
              ) : null}
              <dl className="grid grid-cols-2 gap-x-3 gap-y-4">{facts}</dl>
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-foreground">{richTextLabel}</h3>
                <RichTextView value={detail.richText} />
              </section>
            </>
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </ResponsiveSheetBody>
        {detail ? (
          <ResponsiveSheetFooter className="flex flex-wrap gap-2 border-t border-border px-6 py-4">
            {footer}
          </ResponsiveSheetFooter>
        ) : null}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
