"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@schoolhub/ui";

import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { resolveErrorMessage } from "@/lib/error-message";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import type { WebsiteContentStatus } from "@/services";

type PublishAction = "publish" | "unpublish" | "archive";

export interface PublishActionsProps {
  status: WebsiteContentStatus;
  /** The record type's publish key (`website.page.publish`, …), already checked by the caller. */
  canPublish: boolean;
  publish: () => Promise<unknown>;
  unpublish: () => Promise<unknown>;
  /** Omitted for a record type with no `:archive` (gallery albums). */
  archive?: () => Promise<unknown>;
  /** Runs after a transition lands, e.g. to refresh a detail the caller holds. */
  onDone?: () => void;
  /** Holds every action, e.g. while the caller has unsaved edits. */
  disabled?: boolean;
}

/**
 * Publish, unpublish and archive for one website record, offered by its status: Publish
 * unless published, Unpublish when published, Archive unless archived. Hidden without the
 * publish key; the API enforces it, and refuses a transition it can't make (a page with no
 * visible section) with a sentence shown as it came.
 */
export function PublishActions({
  status,
  canPublish,
  publish,
  unpublish,
  archive,
  onDone,
  disabled,
}: PublishActionsProps) {
  const t = useTranslations("website.publishActions");
  const tErrors = useTranslations("errors");
  const invalidateWebsite = useInvalidateModule(WEBSITE_QUERY_MODULE);

  const mutation = useMutation({
    mutationFn: (action: PublishAction) => {
      if (action === "publish") return publish();
      if (action === "unpublish") return unpublish();
      if (!archive) return Promise.reject(new Error("Archive is not supported."));
      return archive();
    },
    onSuccess: (_result, action) => {
      invalidateWebsite();
      toast.success(t(`done.${action}`));
      onDone?.();
    },
    onError: (error) => {
      toast.error(resolveErrorMessage(error, tErrors, t("failed"), "non_field"));
    },
  });

  if (!canPublish) return null;

  const actions: PublishAction[] = [];
  if (status !== "published") actions.push("publish");
  if (status === "published") actions.push("unpublish");
  if (archive && status !== "archived") actions.push("archive");

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((action) => (
        <Button
          key={action}
          variant={action === "publish" ? "primary" : "outline"}
          disabled={disabled || mutation.isPending}
          onClick={() => {
            mutation.mutate(action);
          }}
        >
          {t(action)}
        </Button>
      ))}
    </div>
  );
}
