"use client";

import Link from "next/link";

import { AccordionMenu, AccordionMenuGroup, AccordionMenuItem, Button } from "@schoolhub/ui";

import { toAbsoluteUrl } from "../../../helpers";
import { AvatarGroup } from "../../common/avatar-group";
import type { SearchIntegrationsItem } from "./types";

// Ported verbatim from packages/ui's partials/dialogs/search/search-integrations.tsx.
export function SearchIntegrations({
  items,
  more,
}: {
  items: SearchIntegrationsItem[];
  more?: boolean;
}) {
  return (
    <AccordionMenu type="single" collapsible classNames={{ separator: "-mx-2 mb-2.5" }}>
      <AccordionMenuGroup>
        <div className="grid gap-2 px-2">
          {items.map((item, index) => (
            <AccordionMenuItem key={index} value={item.name} asChild>
              <div className="flex items-center justify-between gap-2">
                <div className="flex grow items-center gap-2">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-accent/60">
                    <img
                      src={toAbsoluteUrl(`/media/brand-logos/${item.logo}`)}
                      className="size-6 shrink-0"
                      alt={item.name}
                    />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <Link
                      href="#"
                      className="text-mono hover:text-primary-active text-sm font-semibold"
                    >
                      {item.name}
                    </Link>
                    <span className="text-xs font-medium text-secondary-foreground">
                      {item.description}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 justify-end">
                  <AvatarGroup group={item.team} />
                </div>
              </div>
            </AccordionMenuItem>
          ))}
        </div>
        {!more || (
          <AccordionMenuItem className="px-4 pt-2" value={""}>
            <Button variant="outline" className="mx-auto w-full max-w-full">
              Go to Users
            </Button>
          </AccordionMenuItem>
        )}
      </AccordionMenuGroup>
    </AccordionMenu>
  );
}
