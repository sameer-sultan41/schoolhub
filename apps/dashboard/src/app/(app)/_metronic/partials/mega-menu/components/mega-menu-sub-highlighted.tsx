"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Badge, cn } from "@schoolhub/ui";

import type { MenuConfig } from "@/app/(app)/_metronic/menu-config";
import { NavigationMenuLink } from "@/app/(app)/_metronic/navigation-menu";
import { useMenu } from "@/app/(app)/_metronic/use-menu";

// Ported verbatim from packages/ui's partials/mega-menu/components/mega-menu-sub-highlighted.tsx.
export function MegaMenuSubHighlighted(items: MenuConfig) {
  const pathname = usePathname();
  const { isActive } = useMenu(pathname);

  const buildItems = (items: MenuConfig): ReactNode =>
    items.map((item, index) => (
      <NavigationMenuLink key={index} asChild>
        <Link
          {...(isActive(item.path) && { "data-active": true })}
          href={item.path || ""}
          className={cn(
            "border border-transparent hover:border-border hover:bg-background",
            "flex flex-row items-center gap-2.5 rounded-md px-2.5 py-2 text-sm",
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
    ));

  return buildItems(items);
}
