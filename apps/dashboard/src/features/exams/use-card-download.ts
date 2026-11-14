"use client";

import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { resolveErrorMessage } from "@/lib/error-message";
import { downloadFile } from "@/lib/helpers";

export interface CardDownloadOptions<TCard extends { id: string }> {
  /** The card's own `:download` action: a short-lived signed link to its PDF. */
  fetchUrl: (id: string) => Promise<string>;
  /** The file name to save it under. */
  filename: (card: TCard) => string;
  /** Shown when the failure names nothing more specific. */
  failedMessage: string;
}

/**
 * Downloads a card's PDF (an admit card, a report card) through its own `:download` link, never a
 * hand-built URL; a refusal (no document yet, revoked) toasts the server's reason. `download` is
 * stable, so a columns memo can depend on it; `downloadingId` is the card whose link is in flight.
 */
export function useCardDownload<TCard extends { id: string }>({
  fetchUrl,
  filename,
  failedMessage,
}: CardDownloadOptions<TCard>) {
  const tErrors = useTranslations("errors");
  const { mutate, isPending, variables } = useMutation({
    mutationFn: async (card: TCard) => ({ card, url: await fetchUrl(card.id) }),
    onSuccess: ({ card, url }) => {
      downloadFile(url, filename(card));
    },
    onError: (error: unknown) => {
      toast.error(resolveErrorMessage(error, tErrors, failedMessage));
    },
  });

  const download = useCallback(
    (card: TCard) => {
      mutate(card);
    },
    [mutate],
  );

  return { download, downloadingId: isPending ? variables.id : null };
}
