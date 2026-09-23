"use client";

import { useCallback, type JSX } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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
} from "@schoolhub/ui";

import {
  MENU_MEGA_MOBILE,
  type MenuConfig,
  type MenuItem,
} from "@/app/(app)/_metronic/menu-config";

// Ported verbatim from packages/ui's layouts/demo1/components/mega-menu-mobile.tsx.
export function MegaMenuMobile() {
  const pathname = usePathname();

  const matchPath = useCallback(
    (path: string): boolean => path === pathname || (path.length > 1 && pathname.startsWith(path)),
    [pathname],
  );

  const classNames: AccordionMenuClassNames = {
    root: "space-y-1",
    group: "gap-px",
    label: "uppercase text-xs font-medium text-muted-foreground/70 pt-2.25 pb-px",
    separator: "",
    item: "h-8 hover:bg-transparent text-accent-foreground hover:text-primary data-[selected=true]:text-primary data-[selected=true]:bg-muted data-[selected=true]:font-medium",
    sub: "",
    subTrigger:
      "h-8 hover:bg-transparent text-accent-foreground hover:text-primary data-[selected=true]:text-primary data-[selected=true]:bg-muted data-[selected=true]:font-medium",
    subContent: "py-0",
    indicator: "",
  };

  const buildMenu = (items: MenuConfig): JSX.Element[] =>
    items.map((item: MenuItem, index: number) => {
      if (item.heading) return buildMenuHeading(item, index);
      if (!item.disabled) return buildMenuItemRoot(item, index);
      return <></>;
    });

  const buildMenuItemRoot = (item: MenuItem, index: number): JSX.Element => {
    if (item.children) {
      return (
        <AccordionMenuSub key={index} value={item.path || `root-${index}`}>
          <AccordionMenuSubTrigger className="text-sm font-medium">
            {item.icon && <item.icon data-slot="accordion-menu-icon" />}
            <div className="flex grow items-center justify-between gap-2">
              <span data-slot="accordion-menu-title">{item.title}</span>
              {item.badge && (
                <Badge variant="secondary" size="sm" className="ms-auto">
                  {item.badge}
                </Badge>
              )}
            </div>
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
        <Link href={item.path || "#"} className="">
          {item.icon && <item.icon data-slot="accordion-menu-icon" />}
          <div className="flex grow items-center justify-between gap-2">
            <span data-slot="accordion-menu-title">{item.title}</span>
            {item.badge && (
              <Badge variant="secondary" size="sm" className="ms-auto">
                {item.badge}
              </Badge>
            )}
          </div>
        </Link>
      </AccordionMenuItem>
    );
  };

  const buildMenuItemChildren = (items: MenuConfig, level: number = 0): JSX.Element[] =>
    items.map((item: MenuItem, index: number) =>
      !item.disabled ? buildMenuItemChild(item, index, level) : <></>,
    );

  const buildMenuItemChild = (item: MenuItem, index: number, level: number = 0): JSX.Element => {
    if (item.children) {
      return (
        <AccordionMenuSub key={index} value={item.path || `child-${level}-${index}`}>
          <AccordionMenuSubTrigger className="text-[13px]">
            {item.icon && <item.icon data-slot="accordion-menu-icon" />}
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
            {item.badge && (
              <Badge variant="secondary" size="sm" className="ms-auto">
                {item.badge}
              </Badge>
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
        <Link href={item.path || "#"}>
          {item.icon && <item.icon data-slot="accordion-menu-icon" />}
          <div className="flex grow items-center justify-between gap-2">
            <span>{item.title}</span>
            {item.badge && (
              <Badge variant="secondary" size="sm" className="ms-auto">
                {item.badge}
              </Badge>
            )}
          </div>
        </Link>
      </AccordionMenuItem>
    );
  };

  const buildMenuHeading = (item: MenuItem, index: number): JSX.Element => (
    <AccordionMenuLabel key={index}>{item.heading}</AccordionMenuLabel>
  );

  return (
    <div className="flex shrink-0 grow px-5 py-5">
      <AccordionMenu
        selectedValue={pathname}
        matchPath={matchPath}
        type="single"
        collapsible
        classNames={classNames}
      >
        {buildMenu(MENU_MEGA_MOBILE)}
      </AccordionMenu>
    </div>
  );
}
