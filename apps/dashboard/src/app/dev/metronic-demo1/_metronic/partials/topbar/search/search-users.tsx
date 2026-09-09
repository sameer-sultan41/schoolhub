"use client";

import Link from "next/link";
import { EllipsisVertical } from "lucide-react";

import {
  AccordionMenu,
  AccordionMenuGroup,
  AccordionMenuItem,
  Badge,
  BadgeDot,
  Button,
} from "@schoolhub/ui";

import { toAbsoluteUrl } from "../../../helpers";
import type { SearchUsersItem } from "./types";

// Ported verbatim from packages/ui's partials/dialogs/search/search-users.tsx.
export function SearchUsers({ items, more }: { items: SearchUsersItem[]; more?: boolean }) {
  return (
    <AccordionMenu type="single" collapsible classNames={{ separator: "-mx-2 mb-2.5" }}>
      <AccordionMenuGroup>
        <div className="m-2 grid grow gap-2">
          {items.map((item, index) => (
            <AccordionMenuItem key={index} value={item.name} asChild>
              <div className="flex w-full grow items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <img
                    src={toAbsoluteUrl(`/media/avatars/${item.avatar}`)}
                    className="size-9 shrink-0 rounded-full"
                    alt={item.name}
                  />
                  <div className="flex flex-col">
                    <Link
                      href="#"
                      className="text-mono hover:text-primary-active mb-px text-sm font-semibold"
                    >
                      {item.name}
                    </Link>
                    <span className="text-sm font-normal text-muted-foreground">
                      {item.email} connections
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <Badge size="md" variant={item.color} appearance="light" shape="circle">
                    <BadgeDot /> {item.label}
                  </Badge>
                  <Button variant="ghost" mode="icon">
                    <EllipsisVertical />
                  </Button>
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
