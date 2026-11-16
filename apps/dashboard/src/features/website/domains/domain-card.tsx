"use client";

import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
} from "@schoolhub/ui";

import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { enumLabel } from "@/lib/enum-label";
import { formatLastUpdated } from "@/lib/helpers";
import { Services, type CustomDomainRecord } from "@/services";
import { isVerifiable } from "@/services/modules/website/custom-domains/custom-domains-constant";
import { primaryBlocker } from "@/services/modules/website/custom-domains/custom-domains-helper";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import { refusalReason, withReasonText } from "@/features/website/shared/reason-message";
import { DnsRecords } from "./dns-records";
import { DomainBadges } from "./domain-badges";
import { DOMAIN_ERROR_KEY, DOMAIN_REASON_SCOPE } from "./domain-labels";
import { RemoveDomainDialog } from "./remove-domain-dialog";
import { CUSTOM_DOMAINS_KEY } from "./use-custom-domains";

export interface DomainPermissions {
  /** `website.custom-domain.update`: Check DNS and Make primary. */
  canUpdate: boolean;
  /** `website.custom-domain.delete`: Remove. */
  canDelete: boolean;
}

/**
 * One domain: its status, HTTPS and primary badges, what the last DNS check found, the records to
 * add, and its actions. A check that fails or can't finish is a 200 the card reads from the
 * record; a refusal (a 409 `domain_taken`, a 422) shows on the card in the viewer's language.
 */
export function DomainCard({
  domain,
  permissions,
}: {
  domain: CustomDomainRecord;
  permissions: DomainPermissions;
}) {
  const t = useTranslations("website.domains");
  const tCommon = useTranslations("common");
  const tReasons = useTranslations("website.reasons");
  const queryClient = useQueryClient();
  const invalidateWebsite = useInvalidateModule(WEBSITE_QUERY_MODULE);
  const [removing, setRemoving] = useState(false);
  // The last verify refusal's `meta.reason`, to tell it apart from the stored check's code.
  const [verifyReason, setVerifyReason] = useState<string | null>(null);
  const headingId = useId();
  const blockerId = useId();
  const blocker = primaryBlocker(domain);

  const replace = (saved: CustomDomainRecord) => {
    queryClient.setQueryData<CustomDomainRecord[]>(CUSTOM_DOMAINS_KEY, (rows) =>
      rows?.map((row) => (row.id === saved.id ? saved : row)),
    );
    invalidateWebsite();
  };

  const verify = useConfirmAction({
    mutationFn: async () => {
      try {
        return await Services.customDomains.verifyCustomDomain(domain.id);
      } catch (refusal) {
        // A 409 stored the claim `failed` before answering: read it again.
        invalidateWebsite();
        setVerifyReason(refusalReason(refusal));
        throw withReasonText(refusal, tReasons, DOMAIN_REASON_SCOPE);
      }
    },
    onSuccess: (saved) => {
      replace(saved);
      if (saved.status === "active")
        toast.success(t("verifyResult.active", { domain: saved.domain }));
      else if (saved.status === "failed")
        toast.error(t("verifyResult.failed", { domain: saved.domain }));
      else toast.warning(t("verifyResult.inconclusive"));
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  const makePrimary = useConfirmAction({
    mutationFn: async () => {
      try {
        return await Services.customDomains.setPrimaryCustomDomain(domain.id, true);
      } catch (refusal) {
        throw withReasonText(refusal, tReasons, DOMAIN_REASON_SCOPE);
      }
    },
    onSuccess: (saved) => {
      // Setting one primary clears the other: the whole list is read again.
      replace(saved);
      toast.success(t("primaryDone", { domain: saved.domain }));
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  const lastError = domain.last_error_code
    ? enumLabel(t, DOMAIN_ERROR_KEY, domain.last_error_code)
    : domain.last_error;
  // A 409 `domain_taken` is also stored as the last check's code: say it once.
  const verifyError =
    verifyReason !== null && verifyReason === domain.last_error_code ? null : verify.error;
  const actionErrors = [verifyError, makePrimary.error].filter(
    (message): message is string => message !== null,
  );
  const busy = verify.isPending || makePrimary.isPending;

  return (
    <Card aria-labelledby={headingId} role="region">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <h2
              id={headingId}
              dir="ltr"
              className="text-base font-semibold break-all text-foreground"
            >
              {domain.domain}
            </h2>
            <DomainBadges domain={domain} />
            {domain.verified_at ? (
              <p className="text-xs text-muted-foreground">
                {t("verifiedAt", { when: formatLastUpdated(domain.verified_at) })}
              </p>
            ) : null}
          </div>
        </div>
        {lastError ? (
          <Alert
            variant={domain.status === "failed" ? "destructive" : "warning"}
            appearance="light"
          >
            <AlertContent>
              <AlertTitle>{t("lastCheck")}</AlertTitle>
              <AlertDescription>{lastError}</AlertDescription>
            </AlertContent>
          </Alert>
        ) : null}
        {actionErrors.map((message) => (
          <Alert key={message} variant="destructive">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ))}
        {domain.dns_records.length > 0 ? <DnsRecords records={domain.dns_records} /> : null}
        <div className="flex flex-wrap items-center gap-2">
          {permissions.canUpdate && isVerifiable(domain) ? (
            <Button
              type="button"
              isLoading={verify.isPending}
              loadingLabel={t("status.verifying")}
              disabled={busy}
              onClick={() => {
                setVerifyReason(null);
                verify.confirm();
              }}
            >
              {t("actions.verify")}
            </Button>
          ) : null}
          {permissions.canUpdate && !domain.is_primary ? (
            <Button
              type="button"
              variant="outline"
              isLoading={makePrimary.isPending}
              loadingLabel={tCommon("saving")}
              disabled={busy || blocker !== null}
              aria-describedby={blocker ? blockerId : undefined}
              onClick={makePrimary.confirm}
            >
              {t("actions.makePrimary")}
            </Button>
          ) : null}
          {permissions.canDelete ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setRemoving(true);
              }}
            >
              {t("actions.remove")}
            </Button>
          ) : null}
        </div>
        {permissions.canUpdate && !domain.is_primary && blocker ? (
          <p id={blockerId} className="text-xs text-muted-foreground">
            {t(`primaryBlocked.${blocker}`)}
          </p>
        ) : null}
      </CardContent>
      {removing && (
        <RemoveDomainDialog
          domain={domain}
          onOpenChange={(open) => {
            if (!open) setRemoving(false);
          }}
        />
      )}
    </Card>
  );
}
