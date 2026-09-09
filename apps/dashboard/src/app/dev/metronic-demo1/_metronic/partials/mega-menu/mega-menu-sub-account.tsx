"use client";

import type { MenuConfig, MenuItem } from "../../menu-config";
import { MegaMenuSubDefault, MegaMenuSubHighlighted } from "./components";

// Ported verbatim from packages/ui's partials/mega-menu/mega-menu-sub-account.tsx.
export function MegaMenuSubAccount({ items }: { items: MenuConfig }) {
  const myAccountItem = items[2] ?? {};
  const myAccountItemGeneral = myAccountItem.children?.[0] ?? {};
  const myAccountItemOthers = myAccountItem.children?.[1] ?? {};

  return (
    <div className="flex w-full flex-col gap-0 overflow-hidden lg:w-[1200px] lg:flex-row">
      <div className="mt-2 shrink-0 bg-accent/30 px-3 py-4 lg:mt-0 lg:w-[225px] lg:border-e lg:border-border lg:p-7.5">
        <h3 className="mb-2 ps-2.5 text-sm leading-none font-semibold text-foreground lg:mb-5">
          {myAccountItemGeneral.title}
        </h3>
        <div className="flex flex-col">
          {myAccountItemGeneral.children && MegaMenuSubHighlighted(myAccountItemGeneral.children)}
        </div>
      </div>
      <div className="grow pt-4 pb-2 lg:p-7.5 lg:pb-5">
        <div className="grid gap-4 lg:grid-cols-5">
          {myAccountItemOthers.children?.map((item: MenuItem, index) => (
            <div key={`account-${index}`}>
              <h3 className="mb-2 ps-2.5 text-sm leading-none font-semibold text-foreground lg:mb-5">
                {item.title}
              </h3>
              <div className="space-y-0.5">
                {item.children && MegaMenuSubDefault(item.children)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
