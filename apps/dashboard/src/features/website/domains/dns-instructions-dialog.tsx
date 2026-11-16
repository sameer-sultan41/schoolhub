"use client";

import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";

import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { useIsDesktopShell } from "@/hooks/use-is-desktop-shell";
import type { CustomDomainRecord } from "@/services";
import { DnsRecords } from "./dns-records";

/** The next step after adding a domain: the records to add at the DNS provider, with copy
 * buttons. The domain's card keeps them and its Check DNS. */
export function DnsInstructionsDialog({
  domain,
  onOpenChange,
}: {
  domain: CustomDomainRecord;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("website.domains.instructions");
  const tCommon = useTranslations("common");
  const isMobile = !useIsDesktopShell();

  return (
    <ResponsiveDialog open onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t("title", { domain: domain.domain })}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody
          className={
            isMobile ? "space-y-4 overflow-y-auto" : "max-h-[65vh] space-y-4 overflow-y-auto pe-1"
          }
        >
          <p className="text-sm text-muted-foreground">{t("description")}</p>
          <DnsRecords records={domain.dns_records} />
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button
            type="button"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t("done")}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
