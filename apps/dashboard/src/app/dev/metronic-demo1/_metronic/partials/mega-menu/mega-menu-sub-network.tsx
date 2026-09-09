"use client";

import { Badge } from "@schoolhub/ui";

import type { MenuConfig, MenuItem } from "../../menu-config";
import { MegaMenuFooter, MegaMenuSubDefault, MegaMenuSubHighlighted } from "./components";

// Ported verbatim from packages/ui's partials/mega-menu/mega-menu-sub-network.tsx.
export function MegaMenuSubNetwork({ items }: { items: MenuConfig }) {
  const networkItem = items[3] ?? {};
  const networkItemGeneral = networkItem.children?.[0] ?? {};
  const networkItemOthers = networkItem.children?.[1] ?? {};

  return (
    <div className="w-full flex-col gap-0 lg:w-[670px]">
      <div className="flex flex-col lg:flex-row">
        <div className="mt-2 flex shrink-0 flex-col gap-5 bg-accent/30 px-3 py-4 lg:mt-0 lg:w-[250px] lg:border-e lg:border-border lg:p-7.5">
          <h3 className="h-3.5 ps-2.5 text-sm leading-none font-semibold text-foreground">
            {networkItemGeneral.title}
          </h3>
          <div className="flex flex-col">
            {networkItemGeneral.children && MegaMenuSubHighlighted(networkItemGeneral.children)}
          </div>
        </div>
        <div className="grow pt-4 pb-2 lg:p-7.5 lg:pb-5">
          <div className="grid gap-5 lg:grid-cols-2">
            {networkItemOthers.children?.map((item: MenuItem, index) => (
              <div key={`network-${index}`} className="flex flex-col gap-5">
                <h3 className="flex h-3.5 items-center gap-1.5 ps-2.5 text-sm leading-none font-semibold text-foreground">
                  {item.title}
                  {item.badge && (
                    <Badge variant="primary" size="sm" appearance="light">
                      {item.badge}
                    </Badge>
                  )}
                </h3>
                <div className="flex flex-col">
                  {item.children && MegaMenuSubDefault(item.children)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <MegaMenuFooter />
    </div>
  );
}
