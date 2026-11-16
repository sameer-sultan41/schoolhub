"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@schoolhub/ui";
import { ExternalLink } from "lucide-react";

import { foldUnknownFieldErrors, NON_FIELD, resolveErrorMessage } from "@/lib/error-message";
import { Services } from "@/services";
import { withReasonText } from "@/features/website/shared/reason-message";

/** The new tab's target: a fresh browsing context. */
const NEW_TAB = "_blank";

/**
 * Opens the page's saved version, drafts included, on the school's own site: `:preview` returns
 * a short-lived signed URL (decision 9). The tab is opened inside the click, so a popup blocker
 * lets it through, cut off from this window (`opener = null`, as `noopener` would), then sent
 * to the URL once it arrives; it is closed again if the request fails. When the browser gives
 * no tab (pop-ups blocked), it says so rather than trying again after the request, which a
 * blocker would refuse anyway.
 */
export function PreviewPageButton({ pageId }: { pageId: string }) {
  const t = useTranslations("website.pages");
  const tErrors = useTranslations("errors");
  const tReasons = useTranslations("website.reasons");
  const mutation = useMutation({
    mutationFn: () => Services.websitePages.previewWebsitePage(pageId),
  });

  function preview() {
    const tab = window.open("", NEW_TAB);
    if (!tab) {
      toast.error(t("preview.popupBlocked"));
      return;
    }
    tab.opener = null;
    mutation.mutate(undefined, {
      onSuccess: ({ url }) => {
        tab.location.replace(url);
      },
      onError: (error) => {
        tab.close();
        const refusal = foldUnknownFieldErrors(withReasonText(error, tReasons));
        toast.error(resolveErrorMessage(refusal, tErrors, t("preview.failed"), NON_FIELD));
      },
    });
  }

  return (
    <Button
      variant="outline"
      onClick={preview}
      isLoading={mutation.isPending}
      loadingLabel={t("preview.opening")}
    >
      <ExternalLink aria-hidden="true" />
      {t("actions.preview")}
    </Button>
  );
}
