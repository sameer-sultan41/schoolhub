"use client";

import type { MenuConfig, MenuItem } from "@/app/(app)/_metronic/menu-config";
import {
  MegaMenuFooter,
  MegaMenuSubDefault,
} from "@/app/(app)/_metronic/partials/mega-menu/components";

// Ported verbatim from packages/ui's partials/mega-menu/mega-menu-sub-apps.tsx.
export function MegaMenuSubApps({ items }: { items: MenuConfig }) {
  const appsItem = items[4] ?? {};

  return (
    <div className="w-full gap-0 lg:w-[775px]">
      <div className="pt-4 pb-2 lg:p-7.5">
        <div className="flex lg:gap-10">
          {appsItem.children?.map((item: MenuItem, index) => (
            <div key={`profile-${index}`} className="flex grow flex-col">
              <h3 className="mb-2 ps-2.5 text-sm leading-none font-semibold text-foreground lg:mb-4">
                {item.title}
              </h3>
              <div className="grid grow lg:grid-cols-2 lg:gap-5">
                {item.children?.map((item: MenuItem, index) => (
                  <div key={`apps-sub-${index}`} className="grow space-y-0.5">
                    {item.children && MegaMenuSubDefault(item.children)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <MegaMenuFooter />
    </div>
  );
}
