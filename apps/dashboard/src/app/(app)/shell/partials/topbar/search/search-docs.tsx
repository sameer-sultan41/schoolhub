"use client";

import { EllipsisVertical } from "lucide-react";

import {
  AccordionMenu,
  AccordionMenuGroup,
  AccordionMenuItem,
  Button,
  toAbsoluteUrl,
} from "@schoolhub/ui";
import type { SearchDocsItem } from "@/app/(app)/shell/partials/topbar/search/types";

// Ported verbatim from packages/ui's partials/dialogs/search/search-docs.tsx.
export function SearchDocs({ items }: { items: SearchDocsItem[] }) {
  return (
    <AccordionMenu type="single" collapsible classNames={{ separator: "-mx-2 mb-2.5" }}>
      <AccordionMenuGroup>
        <div className="grid gap-2 px-2">
          {items.map((item, index) => (
            <AccordionMenuItem key={index} value={item.desc} asChild>
              <div className="flex items-center justify-between">
                <div className="flex grow items-center gap-2.5">
                  <img src={toAbsoluteUrl(`/media/file-types/${item.image}`)} alt={item.desc} />
                  <div className="flex flex-col">
                    <span className="text-mono mb-px cursor-pointer text-sm font-semibold hover:text-primary">
                      {item.desc}
                    </span>
                    <span className="text-xs font-medium text-muted-foreground">{item.date}</span>
                  </div>
                </div>
                <Button variant="ghost" mode="icon">
                  <EllipsisVertical />
                </Button>
              </div>
            </AccordionMenuItem>
          ))}
        </div>
        <AccordionMenuItem className="px-4 pt-2.5" value={""}>
          <Button variant="outline" className="mx-auto w-full max-w-full">
            Go to Users
          </Button>
        </AccordionMenuItem>
      </AccordionMenuGroup>
    </AccordionMenu>
  );
}
