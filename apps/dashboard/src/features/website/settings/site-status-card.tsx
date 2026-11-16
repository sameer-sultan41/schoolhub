"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Alert, Badge, Card, CardContent, Label, Skeleton, Switch } from "@schoolhub/ui";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { websitePagePath } from "@/config/paths";
import { useConfirmAction } from "@/hooks/use-confirm-action";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { queryKeys } from "@/lib/query-client";
import { Services, type WebsiteSettingsRecord } from "@/services";
import { WEBSITE_PAGE_DETAIL_RESOURCE } from "@/services/modules/website/website-pages/website-pages-constant";
import {
  WEBSITE_SETTINGS_KEY,
  WEBSITE_SETTINGS_RESOURCE,
} from "@/services/modules/website/website-settings/website-settings-constant";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import { withReasonText } from "@/features/website/shared/reason-message";

/** The two switches that take the site live or offline; each saves on its own after a confirm. */
type StatusField = "is_published" | "maintenance_mode";

interface PendingChange {
  field: StatusField;
  value: boolean;
}

/** The site's state as visitors meet it: maintenance wins over published. */
function siteState(settings: WebsiteSettingsRecord): "live" | "maintenance" | "offline" {
  if (settings.maintenance_mode) return "maintenance";
  return settings.is_published ? "live" : "offline";
}

const STATE_BADGE = { live: "success", maintenance: "warning", offline: "secondary" } as const;

export interface SiteStatusCardProps {
  settings: WebsiteSettingsRecord;
  /** `website.settings.update`: without it the switches are read-only. */
  canUpdate: boolean;
}

/**
 * Whether visitors see the site: Published and Maintenance mode, each confirmed before it saves
 * (`PATCH /website-settings` with that one field), since either takes the site live or offline.
 * Also the home page (the API keeps it on the site's `home` page; it is shown, not chosen), and,
 * before the first save, that saving creates the site.
 */
export function SiteStatusCard({ settings, canUpdate }: SiteStatusCardProps) {
  const t = useTranslations("website.settings");
  const [pending, setPending] = useState<PendingChange | null>(null);
  const state = siteState(settings);

  return (
    <Card>
      <CardContent className="space-y-5 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-foreground">{t("status.title")}</h2>
          <Badge variant={STATE_BADGE[state]} appearance="light">
            {t(`status.state.${state}`)}
          </Badge>
        </div>
        {!settings.exists ? (
          <Alert variant="info" appearance="light">
            {t("status.notCreated")}
          </Alert>
        ) : null}
        <StatusSwitch
          label={t("status.published")}
          hint={t("status.publishedHint")}
          checked={settings.is_published ?? false}
          disabled={!canUpdate}
          onChange={(value) => {
            setPending({ field: "is_published", value });
          }}
        />
        <StatusSwitch
          label={t("status.maintenance")}
          hint={t("status.maintenanceHint")}
          checked={settings.maintenance_mode ?? false}
          disabled={!canUpdate}
          onChange={(value) => {
            setPending({ field: "maintenance_mode", value });
          }}
        />
        <Homepage settings={settings} />
      </CardContent>
      {pending && (
        <StatusConfirmDialog
          change={pending}
          onOpenChange={(open) => {
            if (!open) setPending(null);
          }}
        />
      )}
    </Card>
  );
}

function StatusSwitch({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        onCheckedChange={onChange}
      />
      <div className="space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      </div>
    </div>
  );
}

/** The site's home page: its title, linking to its editor. */
function Homepage({ settings }: { settings: WebsiteSettingsRecord }) {
  const t = useTranslations("website.settings.homepage");
  const pageId = settings.homepage_page_id ?? "";
  const query = useQuery({
    queryKey: queryKeys.detail(WEBSITE_QUERY_MODULE, WEBSITE_PAGE_DETAIL_RESOURCE, pageId),
    queryFn: () => Services.websitePages.fetchWebsitePage(pageId),
    enabled: pageId !== "",
  });

  let value: ReactNode;
  if (pageId === "") value = t("none");
  else if (query.data) {
    value = (
      <Link href={websitePagePath(pageId)} className="text-primary hover:underline">
        {query.data.title}
      </Link>
    );
  } else if (query.isError) value = t("unavailable");
  else value = <Skeleton className="h-5 w-32" />;

  return (
    <dl className="space-y-0.5">
      <dt className="text-sm font-medium text-foreground">{t("label")}</dt>
      <dd className="text-sm text-muted-foreground">{value}</dd>
      <dd className="text-xs text-muted-foreground">{t("hint")}</dd>
    </dl>
  );
}

/**
 * The confirm for one switch, saving only that field. A refusal shows inline and the dialog
 * stays open; on success the settings cache takes the server's answer.
 *
 * Mounting contract: the caller mounts this only while a change is pending, so every open is fresh.
 */
function StatusConfirmDialog({
  change,
  onOpenChange,
}: {
  change: PendingChange;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("website.settings.confirm");
  const tCommon = useTranslations("common");
  const tReasons = useTranslations("website.reasons");
  const queryClient = useQueryClient();
  const invalidateWebsite = useInvalidateModule(WEBSITE_QUERY_MODULE);
  const copy = `${change.field === "is_published" ? "publish" : "maintenance"}.${change.value ? "on" : "off"}`;
  // Unpublishing or entering maintenance takes the site away from visitors.
  const takesOffline = change.field === "maintenance_mode" ? change.value : !change.value;

  const { error, isPending, confirm } = useConfirmAction({
    mutationFn: async () => {
      try {
        return await Services.websiteSettings.updateWebsiteSettings({
          [change.field]: change.value,
        });
      } catch (refusal) {
        throw withReasonText(refusal, tReasons);
      }
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(
        queryKeys.detail(WEBSITE_QUERY_MODULE, WEBSITE_SETTINGS_RESOURCE, WEBSITE_SETTINGS_KEY),
        saved,
      );
      invalidateWebsite();
      toast.success(t(`${copy}.done`));
      onOpenChange(false);
    },
    fallbackMessage: tCommon("submitFailed"),
  });

  return (
    <ResponsiveAlertDialog
      open
      onOpenChange={onOpenChange}
      title={t(`${copy}.title`)}
      description={t(`${copy}.description`)}
      confirmLabel={t(`${copy}.confirm`)}
      variant={takesOffline ? "destructive" : undefined}
      isPending={isPending}
      error={error ?? undefined}
      onConfirm={confirm}
    />
  );
}
