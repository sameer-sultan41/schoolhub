"use client";

import {
  AccordionMenu,
  type AccordionMenuClassNames,
  AccordionMenuItem,
  AccordionMenuLabel,
  Badge,
} from "@schoolhub/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback } from "react";
import { MENU_SIDEBAR, type MenuConfig, type MenuItem } from "./menu-config";

/**
 * Copied from Metronic's own `sidebar-menu.tsx` — same classNames, same buildMenu
 * structure — with two substitutions: `@schoolhub/ui`'s `AccordionMenu`/`Badge` in place
 * of Metronic's own `@/components/ui/*` imports (already-ported, visually identical
 * components — see packages/ui/src/components/accordion-menu.tsx), and MENU_SIDEBAR
 * (menu-config.ts, this directory) built from schoolhub's real nav items instead of
 * Metronic's own demo content. No `children`/nested-item branch: nothing in schoolhub's
 * nav nests today, so Metronic's own recursive buildMenuItemChildren is omitted rather
 * than kept as untested, unreachable code.
 */
export function SidebarMenu() {
  const pathname = usePathname();

  const matchPath = useCallback(
    (path: string): boolean => path === pathname || (path.length > 1 && pathname.startsWith(path)),
    [pathname],
  );

  const classNames: AccordionMenuClassNames = {
    root: "lg:ps-1 space-y-3",
    group: "gap-px",
    label:
      "uppercase text-xs font-medium text-muted-foreground/70 pt-2.25 pb-px group-data-[collapsed=true]:hidden",
    item: "h-8 hover:bg-transparent text-accent-foreground hover:text-primary data-[selected=true]:text-primary data-[selected=true]:bg-muted data-[selected=true]:font-medium",
  };

  const buildMenu = (items: MenuConfig) =>
    items.map((item, index) =>
      item.heading ? buildMenuHeading(item, index) : buildMenuItem(item, index),
    );

  const buildMenuItem = (item: MenuItem, index: number) => {
    if (item.disabled) {
      return (
        <AccordionMenuItem key={index} value={`disabled-${index}`} className="text-sm font-medium">
          {item.icon ? <item.icon data-slot="accordion-menu-icon" /> : null}
          <span data-slot="accordion-menu-title" className="group-data-[collapsed=true]:hidden">
            {item.title}
          </span>
          <Badge
            variant="secondary"
            size="sm"
            className="ms-auto me-[-10px] group-data-[collapsed=true]:hidden"
          >
            Soon
          </Badge>
        </AccordionMenuItem>
      );
    }
    return (
      <AccordionMenuItem
        key={index}
        value={item.path ?? ""}
        className="text-sm font-medium"
        asChild
      >
        <Link href={item.path ?? "#"} className="flex grow items-center justify-between gap-2">
          {item.icon ? <item.icon data-slot="accordion-menu-icon" /> : null}
          <span data-slot="accordion-menu-title" className="group-data-[collapsed=true]:hidden">
            {item.title}
          </span>
        </Link>
      </AccordionMenuItem>
    );
  };

  const buildMenuHeading = (item: MenuItem, index: number) => (
    <AccordionMenuLabel key={index}>{item.heading}</AccordionMenuLabel>
  );

  return (
    <div className="kt-scrollable-y-hover flex shrink-0 grow px-5 py-5 lg:max-h-[calc(100vh-5.5rem)]">
      <AccordionMenu
        selectedValue={pathname}
        matchPath={matchPath}
        type="single"
        collapsible
        classNames={classNames}
      >
        {buildMenu(MENU_SIDEBAR)}
      </AccordionMenu>
    </div>
  );
}
