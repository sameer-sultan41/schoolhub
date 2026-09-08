"use client";

import { MenuConfig, MenuItem } from "@/config/types";
import { Badge } from "@/components/ui/badge";
import { MegaMenuFooter, MegaMenuSubDefault, MegaMenuSubHighlighted } from "./components";

const MegaMenuSubAuth = ({ items }: { items: MenuConfig }) => {
  const authItem = items[4];
  const authItemGeneral = authItem.children ? authItem.children[0] : {};
  const authItemOthers = authItem.children ? authItem.children[1] : {};

  return (
    <div className="w-full flex-col gap-0 lg:w-[670px]">
      <div className="flex flex-col lg:flex-row">
        <div className="grow pt-4 pb-2 lg:p-7.5 lg:pb-5">
          <div className="grid gap-5 lg:grid-cols-2">
            {authItemGeneral.children?.map((item: MenuItem, index) => {
              return (
                <div key={`auth-${index}`} className="flex flex-col">
                  <h3 className="mb-2 ps-2.5 text-sm leading-none font-semibold text-foreground lg:mb-5">
                    {item.title}
                    {item.badge && (
                      <Badge variant="primary" size="sm" appearance="light">
                        {item.badge}
                      </Badge>
                    )}
                  </h3>
                  <div className="menu menu-default menu-fit flex-col">
                    {item.children && MegaMenuSubDefault(item.children)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="mb-4 shrink-0 bg-accent/50 px-3 py-4 lg:mb-0 lg:w-[250px] lg:border-s lg:border-border lg:p-7.5">
          <h3 className="mb-5 ps-2.5 text-sm leading-none font-semibold text-foreground">
            {authItemOthers.title}
          </h3>
          <div className="flex flex-col gap-1">
            {authItemOthers.children && MegaMenuSubHighlighted(authItemOthers.children)}
          </div>
        </div>
      </div>
      <MegaMenuFooter />
    </div>
  );
};

export { MegaMenuSubAuth };
