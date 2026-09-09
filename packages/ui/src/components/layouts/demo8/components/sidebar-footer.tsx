"use client";

import { AppsDropdownMenu } from "@/partials/topbar/apps-dropdown-menu";
import { ChatSheet } from "@/partials/topbar/chat-sheet";
import { UserDropdownMenu } from "@/partials/topbar/user-dropdown-menu";
import { LayoutGrid, MessageCircleMore } from "lucide-react";
import { toAbsoluteUrl } from "@/lib/helpers";
import { Button } from "@/components/ui/button";

export function SidebarFooter() {
  return (
    <div className="flex shrink-0 flex-col items-center gap-5 pb-5">
      <div className="flex flex-col gap-1.5">
        <ChatSheet
          trigger={
            <Button
              variant="ghost"
              mode="icon"
              className="hover:bg-background hover:[&_svg]:text-primary"
            >
              <MessageCircleMore className="size-4.5!" />
            </Button>
          }
        />
        <AppsDropdownMenu
          trigger={
            <Button
              variant="ghost"
              mode="icon"
              className="hover:bg-background hover:[&_svg]:text-primary"
            >
              <LayoutGrid className="size-4.5!" />
            </Button>
          }
        />
      </div>

      <UserDropdownMenu
        trigger={
          <img
            className="border-mono/30 size-8 shrink-0 cursor-pointer rounded-lg border-2"
            src={toAbsoluteUrl("/media/avatars/300-2.png")}
            alt="User Avatar"
          />
        }
      />
    </div>
  );
}
