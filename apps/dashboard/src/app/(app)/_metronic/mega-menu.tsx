"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@schoolhub/ui";

import { MENU_MEGA } from "@/app/(app)/_metronic/menu-config";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/app/(app)/_metronic/navigation-menu";
import { MegaMenuSubAccount } from "@/app/(app)/_metronic/partials/mega-menu/mega-menu-sub-account";
import { MegaMenuSubApps } from "@/app/(app)/_metronic/partials/mega-menu/mega-menu-sub-apps";
import { MegaMenuSubNetwork } from "@/app/(app)/_metronic/partials/mega-menu/mega-menu-sub-network";
import { MegaMenuSubProfiles } from "@/app/(app)/_metronic/partials/mega-menu/mega-menu-sub-profiles";
import { useMenu } from "@/app/(app)/_metronic/use-menu";

// Ported verbatim from packages/ui's layouts/demo1/components/mega-menu.tsx.
export function MegaMenu() {
  const pathname = usePathname();
  const { isActive, hasActiveChild } = useMenu(pathname);
  const homeItem = MENU_MEGA[0] ?? {};
  const publicProfilesItem = MENU_MEGA[1] ?? {};
  const myAccountItem = MENU_MEGA[2] ?? {};
  const networkItem = MENU_MEGA[3] ?? {};
  const appsStore = MENU_MEGA[4] ?? {};

  const linkClass =
    "text-sm text-secondary-foreground font-medium hover:text-primary hover:bg-transparent focus:text-primary focus:bg-transparent data-[active=true]:text-primary data-[active=true]:bg-transparent data-[state=open]:text-primary data-[state=open]:bg-transparent";

  return (
    <NavigationMenu>
      <NavigationMenuList className="gap-0">
        <NavigationMenuItem>
          <NavigationMenuLink asChild>
            <Link
              href={homeItem.path || "/"}
              className={cn(linkClass)}
              data-active={isActive(homeItem.path) || undefined}
            >
              {homeItem.title}
            </Link>
          </NavigationMenuLink>
        </NavigationMenuItem>

        <NavigationMenuItem>
          <NavigationMenuTrigger
            className={cn(linkClass)}
            data-active={hasActiveChild(publicProfilesItem.children) || undefined}
          >
            {publicProfilesItem.title}
          </NavigationMenuTrigger>
          <NavigationMenuContent className="p-0">
            <MegaMenuSubProfiles items={MENU_MEGA} />
          </NavigationMenuContent>
        </NavigationMenuItem>

        <NavigationMenuItem>
          <NavigationMenuTrigger
            className={cn(linkClass)}
            data-active={hasActiveChild(myAccountItem.children) || undefined}
          >
            {myAccountItem.title}
          </NavigationMenuTrigger>
          <NavigationMenuContent className="p-0">
            <MegaMenuSubAccount items={MENU_MEGA} />
          </NavigationMenuContent>
        </NavigationMenuItem>

        <NavigationMenuItem>
          <NavigationMenuTrigger
            className={cn(linkClass)}
            data-active={hasActiveChild(networkItem.children || []) || undefined}
          >
            {networkItem.title}
          </NavigationMenuTrigger>
          <NavigationMenuContent className="p-0">
            <MegaMenuSubNetwork items={MENU_MEGA} />
          </NavigationMenuContent>
        </NavigationMenuItem>

        <NavigationMenuItem>
          <NavigationMenuTrigger
            className={cn(linkClass)}
            data-active={hasActiveChild(appsStore.children || []) || undefined}
          >
            {appsStore.title}
          </NavigationMenuTrigger>
          <NavigationMenuContent className="p-0">
            <MegaMenuSubApps items={MENU_MEGA} />
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  );
}
