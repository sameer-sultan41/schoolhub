"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@schoolhub/ui";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import type { SeoTarget } from "@/services";
import { SeoForm } from "./seo-form";

/** The site's own row: `target_type=site`, with no record id. */
const SITE_TARGET: SeoTarget = { targetType: "site" };

/**
 * The site-wide SEO defaults (`/website/seo`): what every page falls back to when its own SEO
 * leaves a field empty. Each page, post, event and album sets its own from its editor.
 */
export function SiteSeo() {
  const t = useTranslations("website.seo");
  const { data: user } = useCurrentUser();

  return (
    <div className="space-y-5">
      <Toolbar>
        <ToolbarHeading title={t("siteTitle")} description={t("siteSummary")} />
      </Toolbar>
      <Card>
        <CardContent className="max-w-2xl p-6">
          <SeoForm target={SITE_TARGET} canUpdate={hasPermission(user, "website.seo.update")} />
        </CardContent>
      </Card>
    </div>
  );
}
