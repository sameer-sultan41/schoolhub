"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@schoolhub/ui";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { LoadErrorCard } from "@/components/load-error-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { useThemes, useWebsiteSettings } from "@/features/website/shared/use-website-settings";
import { SiteSettingsForm } from "./site-settings-form";
import { SiteStatusCard } from "./site-status-card";

/**
 * The site's settings (`/website/settings`): whether visitors see it, then its theme, the
 * theme's own settings, social links and analytics id. Before the first save the API answers an
 * unsaved default (`exists: false`), and the first save creates the site.
 */
export function SiteSettings() {
  const t = useTranslations("website.settings");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const settingsQuery = useWebsiteSettings();
  const themesQuery = useThemes();
  const { data: user } = useCurrentUser();
  const canUpdate = hasPermission(user, "website.settings.update");
  const settings = settingsQuery.data;
  const themes = themesQuery.data;
  const error = settingsQuery.error ?? themesQuery.error;

  let body: ReactNode;
  if (settings && themes) {
    body = (
      <>
        <SiteStatusCard settings={settings} canUpdate={canUpdate} />
        <SiteSettingsForm settings={settings} themes={themes} canUpdate={canUpdate} />
      </>
    );
  } else if (error) {
    body = (
      <LoadErrorCard
        message={resolveErrorMessage(error, tErrors, t("loadError"))}
        onRetry={() => {
          void settingsQuery.refetch();
          void themesQuery.refetch();
        }}
      />
    );
  } else {
    body = (
      <div role="status" className="space-y-4">
        <span className="sr-only">{tCommon("loading")}</span>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Toolbar>
        <ToolbarHeading title={t("title")} description={t("summary")} />
      </Toolbar>
      {body}
    </div>
  );
}
