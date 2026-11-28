"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { Services, type CustomDomainRecord } from "@/services";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import { withReasonText } from "@/features/website/shared/reason-message";
import { DOMAIN_REASON_SCOPE } from "./domain-labels";

/**
 * Confirms removing a domain: the site stops answering there and keeps its subdomain. A refusal
 * shows inline and the dialog stays open.
 *
 * Mounting contract: the caller mounts this only while a removal is asked for.
 */
export function RemoveDomainDialog({
  domain,
  onOpenChange,
}: {
  domain: CustomDomainRecord;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("website.domains.remove");
  const tCommon = useTranslations("common");
  const tReasons = useTranslations("website.reasons");
  const invalidateWebsite = useInvalidateModule(WEBSITE_QUERY_MODULE);

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: async () => {
      try {
        await Services.customDomains.deleteCustomDomain(domain.id);
      } catch (refusal) {
        throw withReasonText(refusal, tReasons, DOMAIN_REASON_SCOPE);
      }
    },
    onSuccess: () => {
      invalidateWebsite();
      toast.success(t("done", { domain: domain.domain }));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open
      onOpenChange={onOpenChange}
      title={t("title", { domain: domain.domain })}
      description={t(domain.is_primary ? "descriptionPrimary" : "description")}
      confirmLabel={t("confirm")}
      variant="destructive"
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
