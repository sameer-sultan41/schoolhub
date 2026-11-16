"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@schoolhub/ui";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { LoadErrorCard } from "@/components/load-error-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { enumLabel } from "@/lib/enum-label";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import type { NavigationMenuLocation } from "@/services";
import { NAVIGATION_MENU_LOCATIONS } from "@/services/modules/website/navigation-menus/navigation-menus-constant";
import { MenuEditor } from "./menu-editor";
import { useNavigationMenus, usePublishedPages } from "./use-navigation-menus";

/** Each location's label key under `website.navigation` (L32). */
const LOCATION_LABEL_KEY: Readonly<Record<NavigationMenuLocation, string>> = {
  header: "locations.header",
  footer_primary: "locations.footer_primary",
  footer_secondary: "locations.footer_secondary",
};

const FIRST_LOCATION: NavigationMenuLocation = NAVIGATION_MENU_LOCATIONS[0] ?? "header";

/**
 * The site's menus (`/website/navigation`): one tab per location, each its own two-level editor
 * with its own Save. Every tab stays mounted while another is shown, so unsaved edits in one
 * survive a look at another.
 */
export function NavigationEditor() {
  const t = useTranslations("website.navigation");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { data: user } = useCurrentUser();
  const canUpdate = hasPermission(user, "website.navigation.update");
  const menusQuery = useNavigationMenus();
  const pagesQuery = usePublishedPages();
  const [location, setLocation] = useState<NavigationMenuLocation>(FIRST_LOCATION);
  const menus = menusQuery.data;
  const pages = pagesQuery.data;
  const error = menusQuery.error ?? pagesQuery.error;

  let body: ReactNode;
  if (menus && pages) {
    body = (
      <Tabs
        value={location}
        onValueChange={(value) => {
          const next = NAVIGATION_MENU_LOCATIONS.find((candidate) => candidate === value);
          if (next) setLocation(next);
        }}
      >
        <TabsList variant="line" aria-label={t("locationsLabel")}>
          {menus.map((menu) => (
            <TabsTrigger key={menu.location} value={menu.location}>
              {enumLabel(t, LOCATION_LABEL_KEY, menu.location)}
            </TabsTrigger>
          ))}
        </TabsList>
        {menus.map((menu) => (
          <TabsContent
            key={menu.location}
            value={menu.location}
            forceMount
            className="pt-4 data-[state=inactive]:hidden"
          >
            <Card>
              <CardContent className="p-6">
                <MenuEditor menu={menu} pages={pages} canUpdate={canUpdate} />
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    );
  } else if (error) {
    body = (
      <LoadErrorCard
        message={resolveErrorMessage(error, tErrors, t("loadError"))}
        onRetry={() => {
          void menusQuery.refetch();
          void pagesQuery.refetch();
        }}
      />
    );
  } else {
    body = (
      <div role="status" className="space-y-4">
        <span className="sr-only">{tCommon("loading")}</span>
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-64 w-full" />
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
