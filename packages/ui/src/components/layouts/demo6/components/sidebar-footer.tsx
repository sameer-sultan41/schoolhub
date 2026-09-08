"use client";

import { ChatSheet } from "@/partials/topbar/chat-sheet";
import { NotificationsSheet } from "@/partials/topbar/notifications-sheet";
import { UserDropdownMenu } from "@/partials/topbar/user-dropdown-menu";
import { MessageCircleMore, MessageSquareDot } from "lucide-react";
import { toAbsoluteUrl } from "@/lib/helpers";
import { Button } from "@/components/ui/button";

export function SidebarFooter() {
  return (
    <div className="flex-center flex h-14 shrink-0 justify-between ps-4 pe-3.5">
      <UserDropdownMenu
        trigger={
          <img
            className="size-9 shrink-0 cursor-pointer rounded-full border-2 border-secondary"
            src={toAbsoluteUrl("/media/avatars/300-2.png")}
            alt="User Avatar"
          />
        }
      />

      <div className="flex-center flex gap-1.5">
        <NotificationsSheet
          trigger={
            <Button
              variant="ghost"
              mode="icon"
              className="hover:bg-background hover:[&_svg]:text-primary"
            >
              <MessageSquareDot className="size-4.5!" />
            </Button>
          }
        />
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
      </div>
    </div>
  );
}
