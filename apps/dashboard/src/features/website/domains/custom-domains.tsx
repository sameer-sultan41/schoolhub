"use client";

import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, CardContent, EmptyState, Skeleton } from "@schoolhub/ui";
import { Globe, Plus } from "lucide-react";

import { Toolbar, ToolbarActions, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { LoadErrorCard } from "@/components/load-error-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import type { CustomDomainRecord } from "@/services";
import { CUSTOM_DOMAIN_LIMIT } from "@/services/modules/website/custom-domains/custom-domains-constant";
import { AddDomainDialog } from "./add-domain-dialog";
import { DnsInstructionsDialog } from "./dns-instructions-dialog";
import { DomainCard } from "./domain-card";
import { useCustomDomains } from "./use-custom-domains";

type Dialog = { kind: "add" } | { kind: "instructions"; domain: CustomDomainRecord };

/**
 * `/website/domains`: the school's own addresses for its website. Each domain shows its status,
 * HTTPS and primary badges, what the last DNS check found and the records to add; Add, Check DNS,
 * Make primary and Remove each show with their own key. The subdomain always keeps working.
 */
export function CustomDomains() {
  const t = useTranslations("website.domains");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { data: user } = useCurrentUser();
  const query = useCustomDomains();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const limitId = useId();
  const permissions = {
    canUpdate: hasPermission(user, "website.custom-domain.update"),
    canDelete: hasPermission(user, "website.custom-domain.delete"),
  };
  const canCreate = hasPermission(user, "website.custom-domain.create");
  const domains = query.data;
  const atLimit = (domains?.length ?? 0) >= CUSTOM_DOMAIN_LIMIT;

  let body: ReactNode;
  if (domains && domains.length > 0) {
    body = (
      <div className="space-y-4">
        {domains.map((domain) => (
          <DomainCard key={domain.id} domain={domain} permissions={permissions} />
        ))}
      </div>
    );
  } else if (domains) {
    body = (
      <Card>
        <CardContent className="p-6">
          <EmptyState icon={Globe} title={t("emptyTitle")} description={t("emptyDescription")} />
        </CardContent>
      </Card>
    );
  } else if (query.isError) {
    body = (
      <LoadErrorCard
        message={resolveErrorMessage(query.error, tErrors, t("loadError"))}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  } else {
    body = (
      <div role="status" className="space-y-4">
        <span className="sr-only">{tCommon("loading")}</span>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Toolbar>
        <ToolbarHeading title={t("title")} description={t("summary")} />
        {canCreate ? (
          <ToolbarActions>
            <Button
              variant="primary"
              disabled={domains === undefined || atLimit}
              aria-describedby={atLimit ? limitId : undefined}
              onClick={() => {
                setDialog({ kind: "add" });
              }}
            >
              <Plus aria-hidden="true" />
              {t("add.open")}
            </Button>
          </ToolbarActions>
        ) : null}
      </Toolbar>
      {canCreate && atLimit ? (
        <p id={limitId} className="text-sm text-muted-foreground">
          {t("add.limitReached", { limit: CUSTOM_DOMAIN_LIMIT })}
        </p>
      ) : null}
      {body}
      {dialog?.kind === "add" && (
        <AddDomainDialog
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          onAdded={(domain) => {
            setDialog({ kind: "instructions", domain });
          }}
        />
      )}
      {dialog?.kind === "instructions" && (
        <DnsInstructionsDialog
          domain={dialog.domain}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      )}
    </div>
  );
}
