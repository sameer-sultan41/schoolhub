"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@schoolhub/ui";

import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { foldUnknownFieldErrors, NON_FIELD, resolveErrorMessage } from "@/lib/error-message";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import type { WebsiteContentStatus } from "@/services";
import { withReasonText } from "./reason-message";

type PublishAction = "publish" | "unpublish" | "archive";

interface Transition {
  action: PublishAction;
  run: () => Promise<unknown>;
}

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
  /** Holds only Publish, e.g. a page with no visible section; the caller says why beside it. */
  publishDisabled?: boolean;
}

/**
 * Publish, unpublish and archive for one website record, offered by its status: Publish
 * unless published, Unpublish when published, Archive unless archived. Hidden without the
 * publish key; the API enforces it, and refuses a transition it can't make (a page with no
 * visible section) with its reason, translated when `website.reasons` knows it.
 */
export function PublishActions({
  status,
  canPublish,
  publish,
  unpublish,
  archive,
  onDone,
  disabled,
  publishDisabled,
}: PublishActionsProps) {
  const t = useTranslations("website.publishActions");
  const tErrors = useTranslations("errors");
  const tReasons = useTranslations("website.reasons");
  const invalidateWebsite = useInvalidateModule(WEBSITE_QUERY_MODULE);

  const mutation = useMutation({
    mutationFn: ({ run }: Transition) => run(),
    onSuccess: (_result, { action }) => {
      invalidateWebsite();
      toast.success(t(`done.${action}`));
      onDone?.();
    },
    onError: (error) => {
      // A refusal names a field (`sections`, `page`), never an input here: shown as one sentence.
      const refusal = foldUnknownFieldErrors(withReasonText(error, tReasons));
      toast.error(resolveErrorMessage(refusal, tErrors, t("failed"), NON_FIELD));
    },
  });

  if (!canPublish) return null;

  // Each offered action carries its own call, so there is no branch for one the record lacks.
  const transitions: Transition[] = [];
  if (status !== "published") transitions.push({ action: "publish", run: publish });
  if (status === "published") transitions.push({ action: "unpublish", run: unpublish });
  if (archive && status !== "archived") transitions.push({ action: "archive", run: archive });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {transitions.map((transition) => (
        <Button
          key={transition.action}
          variant={transition.action === "publish" ? "primary" : "outline"}
          disabled={
            disabled ||
            mutation.isPending ||
            (transition.action === "publish" && publishDisabled === true)
          }
          onClick={() => {
            mutation.mutate(transition);
          }}
        >
          {t(transition.action)}
        </Button>
      ))}
    </div>
  );
}
