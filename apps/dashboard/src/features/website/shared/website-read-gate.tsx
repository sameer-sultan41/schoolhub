"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, EmptyState, Skeleton } from "@schoolhub/ui";
import { Lock } from "lucide-react";

import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";

/** The key every CMS read needs (module doc §16: settings, menus and SEO included). */
const WEBSITE_READ_KEY = "website.page.view";

/**
 * Mounts a site screen (settings, navigation, SEO) only for a viewer who may read it. Those
 * sections are offered on their update key, but the API reads them under `website.page.view`; a
 * custom role holding only the update key gets this explanation instead of a 403, and no read is
 * sent. Children mount after the user has loaded, so their queries never start early.
 */
export function WebsiteReadGate({ children }: { children: ReactNode }) {
  const t = useTranslations("website.readGate");
  const tCommon = useTranslations("common");
  const { data: user } = useCurrentUser();

  if (user === undefined) {
    return (
      <div role="status">
        <span className="sr-only">{tCommon("loading")}</span>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!hasPermission(user, WEBSITE_READ_KEY)) {
    return (
      <Card>
        <CardContent className="p-6">
          <EmptyState icon={Lock} title={t("title")} description={t("description")} />
        </CardContent>
      </Card>
    );
  }
  return children;
}
