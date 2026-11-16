"use client";

import { ModuleLanding } from "@/components/module-sections/module-landing";
import { Paths } from "@/config/paths";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { WEBSITE_SECTIONS } from "@/features/website/website-sections";
import { ContentInventory } from "./content-inventory";

/** The other sections, for a viewer who can't read the inventory (a `reception` user with only
 * the contact inbox): never `/website` itself, so the landing can't send anyone back here. */
const OTHER_SECTIONS = WEBSITE_SECTIONS.filter((section) => section.href !== Paths.WEBSITE);

/** `/website`: the content inventory for a viewer with `website.page.view`; anyone else goes to
 * the first Website section they may open. */
export function WebsiteLanding() {
  const { data: user } = useCurrentUser();
  if (user && hasPermission(user, "website.page.view")) return <ContentInventory />;
  return <ModuleLanding sections={OTHER_SECTIONS} />;
}
