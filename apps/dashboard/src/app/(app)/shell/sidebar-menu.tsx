"use client";

import { useCallback, type JSX } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import {
  AccordionMenu,
  AccordionMenuGroup,
  AccordionMenuItem,
  AccordionMenuLabel,
  AccordionMenuSub,
  AccordionMenuSubContent,
  AccordionMenuSubTrigger,
  Badge,
  cn,
  type AccordionMenuClassNames,
  type MenuConfig,
  type MenuItem,
} from "@schoolhub/ui";

import { MENU_SIDEBAR } from "@/app/(app)/shell/menu-config";
import { canAccessModule } from "@/lib/permissions";
import { Services } from "@/services";

// Ported verbatim from packages/ui's layouts/demo1/components/sidebar-menu.tsx —
// real nested Metronic nav, built on this repo's own AccordionMenu port.
export function SidebarMenu() {
  const pathname = usePathname();
  // Same query as UserDropdownMenu/EntryCallout (one cache entry, one request). Only a
  // handful of MENU_SIDEBAR entries carry a `module` key at all — every vendor-demo item
  // without one renders exactly as before, permission check or not.
  const { data: user } = useQuery({
    queryKey: ["dashboard", "current-user"],
    queryFn: () => Services.auth.fetchCurrentUser(),
  });
  const visibleMenu = MENU_SIDEBAR.filter(
    (item) => !item.module || canAccessModule(user, item.module),
  );

  const matchPath = useCallback(
    (path: string): boolean => path === pathname || (path.length > 1 && pathname.startsWith(path)),
    [pathname],
  );

  const classNames: AccordionMenuClassNames = {
    root: "lg:ps-1 space-y-3",
    group: "gap-px",
    label: "uppercase text-xs font-medium text-muted-foreground/70 pt-2.25 pb-px",
    separator: "",
    // bg-muted, this component's original background for a selected item, is barely
    // distinguishable from the sidebar's own bg-background under the Metronic preset
    // (oklch L .967 vs 1 — a 0.033 gap, effectively invisible) — bg-primary/10 gives the
    // selected row a real, visible highlight, and matches the primary-tinted "this is
    // active" language already used elsewhere on this page (filter buttons, badges).
    // rounded-xl (overriding itemVariants' own rounded-lg) + font-semibold (overriding
    // its plain text-sm) is what makes the highlight read as a soft, bold "pill" rather
    // than a faint tinted rectangle. hover:bg-primary/5 replaces the vendor's flat
    // hover:bg-transparent with a real (if subtle) hover state of its own, and
    // transition-all + active:scale gives both the hover tint and the selected
    // highlight a soft animated feel instead of snapping in instantly.
    // "group" marks the row as the hover source for the icon's own group-hover:scale-110
    // below — the icon is a descendant (directly, or one level down through the leaf
    // item's <Link>), so it still picks up the row's :hover regardless of nesting depth.
    item: "group h-8 rounded-xl transition-all duration-200 ease-out hover:bg-primary/5 active:scale-[0.98] text-accent-foreground hover:text-primary data-[selected=true]:text-primary data-[selected=true]:bg-primary/10 data-[selected=true]:font-semibold",
    sub: "",
    subTrigger:
      "group h-8 rounded-xl transition-all duration-200 ease-out hover:bg-primary/5 active:scale-[0.98] text-accent-foreground hover:text-primary data-[selected=true]:text-primary data-[selected=true]:bg-primary/10 data-[selected=true]:font-semibold",
    subContent: "py-0",
    indicator: "",
  };

  const buildMenu = (items: MenuConfig): JSX.Element[] =>
    items.map((item: MenuItem, index: number) => {
      if (item.heading) return buildMenuHeading(item, index);
      if (item.disabled) return buildMenuItemRootDisabled(item, index);
      return buildMenuItemRoot(item, index);
    });

  const buildMenuItemRoot = (item: MenuItem, index: number): JSX.Element => {
    if (item.children) {
      return (
        <AccordionMenuSub key={index} value={item.path || `root-${index}`}>
          <AccordionMenuSubTrigger className="text-sm font-medium">
            {item.icon && (
              <item.icon
                data-slot="accordion-menu-icon"
                className="transition-transform duration-200 group-hover:scale-110"
              />
            )}
            <span data-slot="accordion-menu-title">{item.title}</span>
          </AccordionMenuSubTrigger>
          <AccordionMenuSubContent
            type="single"
            collapsible
            parentValue={item.path || `root-${index}`}
            className="ps-6"
          >
            <AccordionMenuGroup>{buildMenuItemChildren(item.children, 1)}</AccordionMenuGroup>
          </AccordionMenuSubContent>
        </AccordionMenuSub>
      );
    }
    return (
      <AccordionMenuItem key={index} value={item.path || ""} className="text-sm font-medium">
        {/* Deliberately dropped the vendor's own `justify-between` here (verified
            verbatim in the real Metronic source) — with only an icon and a title as
            children, `justify-between` pushes the title to the row's far end instead of
            immediately after the icon. The vendor's own menu config never actually hits
            this branch (every root item with an `icon` also has `children`, which takes
            the `AccordionMenuSubTrigger` path below instead), so this was latent,
            unexercised markup — "Staff" (a real root-level icon item with no children)
            is the first item anywhere to ever render through it. */}
        <Link href={item.path || "#"} className="flex grow items-center gap-2">
          {item.icon && (
            <item.icon
              data-slot="accordion-menu-icon"
              className="transition-transform duration-200 group-hover:scale-110"
            />
          )}
          <span data-slot="accordion-menu-title">{item.title}</span>
        </Link>
      </AccordionMenuItem>
    );
  };

  const buildMenuItemRootDisabled = (item: MenuItem, index: number): JSX.Element => (
    <AccordionMenuItem key={index} value={`disabled-${index}`} className="text-sm font-medium">
      {item.icon && <item.icon data-slot="accordion-menu-icon" />}
      <span data-slot="accordion-menu-title">{item.title}</span>
      {item.disabled && (
        <Badge variant="secondary" size="sm" className="ms-auto me-[-10px]">
          Soon
        </Badge>
      )}
    </AccordionMenuItem>
  );

  const buildMenuItemChildren = (items: MenuConfig, level: number = 0): JSX.Element[] =>
    items.map((item: MenuItem, index: number) =>
      item.disabled
        ? buildMenuItemChildDisabled(item, index, level)
        : buildMenuItemChild(item, index, level),
    );

  const buildMenuItemChild = (item: MenuItem, index: number, level: number = 0): JSX.Element => {
    if (item.children) {
      return (
        <AccordionMenuSub key={index} value={item.path || `child-${level}-${index}`}>
          <AccordionMenuSubTrigger className="text-[13px]">
            {item.collapse ? (
              <span className="text-muted-foreground">
                <span className="hidden [[data-state=open]>span>&]:inline">
                  {item.collapseTitle}
                </span>
                <span className="inline [[data-state=open]>span>&]:hidden">{item.expandTitle}</span>
              </span>
            ) : (
              item.title
            )}
          </AccordionMenuSubTrigger>
          <AccordionMenuSubContent
            type="single"
            collapsible
            parentValue={item.path || `child-${level}-${index}`}
            className={cn("ps-4", !item.collapse && "relative")}
          >
            <AccordionMenuGroup>
              {buildMenuItemChildren(item.children, item.collapse ? level : level + 1)}
            </AccordionMenuGroup>
          </AccordionMenuSubContent>
        </AccordionMenuSub>
      );
    }
    return (
      <AccordionMenuItem key={index} value={item.path || ""} className="text-[13px]">
        <Link href={item.path || "#"}>{item.title}</Link>
      </AccordionMenuItem>
    );
  };

  const buildMenuItemChildDisabled = (
    item: MenuItem,
    index: number,
    level: number = 0,
  ): JSX.Element => (
    <AccordionMenuItem
      key={index}
      value={`disabled-child-${level}-${index}`}
      className="text-[13px]"
    >
      <span data-slot="accordion-menu-title">{item.title}</span>
      {item.disabled && (
        <Badge variant="secondary" size="sm" className="ms-auto me-[-10px]">
          Soon
        </Badge>
      )}
    </AccordionMenuItem>
  );

  const buildMenuHeading = (item: MenuItem, index: number): JSX.Element => (
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
        {buildMenu(visibleMenu)}
      </AccordionMenu>
    </div>
  );
}
