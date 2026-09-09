"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Badge, cn } from "@schoolhub/ui";

import type { MenuConfig } from "../../../menu-config";
import { NavigationMenuLink } from "../../../navigation-menu";
import { useMenu } from "../../../use-menu";

// Ported verbatim from packages/ui's partials/mega-menu/components/mega-menu-sub-default.tsx.
export function MegaMenuSubDefault(items: MenuConfig) {
  const pathname = usePathname();
  const { isActive } = useMenu(pathname);

  const buildItems = (items: MenuConfig): ReactNode =>
    items.map((item, index) => {
      if (item.children) {
        return (
          <div key={index}>
            <div className="pt-1">
              <span className="p-2.5 text-sm font-medium text-secondary-foreground">
                {item.title}
              </span>
            </div>
            {buildItems(item.children)}
          </div>
        );
      }
      return (
        <NavigationMenuLink key={index} asChild>
          <Link
            {...(isActive(item.path) && { "data-active": true })}
            href={item.path || ""}
            className={cn(
              "flex flex-row items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-accent/50",
              "[&_svg]:text-muted-foreground hover:[&_svg]:text-primary [&[data-active=true]_svg]:text-primary",
            )}
          >
            {item.icon && <item.icon className="size-4" />}
            {item.title}
            {item.disabled && (
              <Badge variant="secondary" size="sm">
                Soon
              </Badge>
            )}
            {item.badge && (
              <Badge variant="primary" size="sm" appearance="light">
                {item.badge}
              </Badge>
            )}
          </Link>
        </NavigationMenuLink>
      );
    });

  return buildItems(items);
}
