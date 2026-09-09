"use client";

import type { MenuConfig, MenuItem } from "../../menu-config";
import { MegaMenuFooter, MegaMenuSubDefault } from "./components";

// Ported verbatim from packages/ui's partials/mega-menu/mega-menu-sub-profiles.tsx.
export function MegaMenuSubProfiles({ items }: { items: MenuConfig }) {
  const publicProfilesItem = items[1] ?? {};

  return (
    <div className="w-full gap-0 lg:w-[875px]">
      <div className="pt-4 pb-2 lg:p-7.5">
        <div className="grid gap-5 lg:grid-cols-2 lg:gap-10">
          {publicProfilesItem.children?.map((item: MenuItem, index) => (
            <div key={`profile-${index}`} className="flex flex-col">
              <h3 className="mb-2 ps-2.5 text-sm leading-none font-semibold text-foreground lg:mb-4">
                {item.title}
              </h3>
              <div className="grid lg:grid-cols-2 lg:gap-5">
                {item.children?.map((item: MenuItem, index) => (
                  <div key={`profile-sub-${index}`} className="space-y-0.5">
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
