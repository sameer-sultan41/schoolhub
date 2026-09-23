"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Calendar, Settings, Settings2, Shield, Users } from "lucide-react";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  ScrollArea,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@schoolhub/ui";

import {
  NotificationItem,
  type NotificationItemData,
} from "@/app/(app)/shell/partials/topbar/notification-item";

// Adapted from packages/ui's partials/topbar/notifications-sheet.tsx. The vendor
// version imports 20 separate per-notification components (item-1.tsx .. item-20.tsx,
// mostly identical markup); this keeps its Sheet/Tabs/dropdown chrome verbatim but
// drives the notification lists from data through the consolidated NotificationItem
// (see that file's own note) — same real Metronic sample content, fewer files.
const ALL_TAB: NotificationItemData[] = [
  {
    variant: "mention",
    userName: "Joe Lincoln",
    avatar: "300-4.png",
    description: "mentioned you in",
    link: "Latest Trends",
    label: "topic",
    time: "18 mins ago",
    specialist: "Web Design 2024",
    text: "For an expert opinion, check out what Mike has to say on this topic!",
  },
  {
    variant: "activity",
    userName: "Guy Hawkins",
    avatar: "300-27.png",
    badgeColor: "offline",
    description: "requested access to",
    link: "AirSpace",
    time: "14 hours ago",
    info: "Dev Team",
  },
  {
    variant: "activity",
    userName: "Raymond Pawell",
    avatar: "300-11.png",
    badgeColor: "online",
    description: "posted a new article",
    link: "2024 Roadmap",
    time: "1 hour ago",
    info: "Roadmap",
  },
];

const INBOX_TAB: NotificationItemData[] = [
  {
    variant: "activity",
    userName: "Benjamin Harris",
    avatar: "300-30.png",
    badgeColor: "offline",
    description: "requested to upgrade plan",
    time: "4 days ago",
    info: "Marketing",
  },
  {
    variant: "activity",
    userName: "Isaac Morgan",
    avatar: "300-24.png",
    badgeColor: "online",
    description: "mentioned you in",
    link: "Data Transmission",
    time: "6 days ago",
    info: "Dev Team",
  },
];

const TEAM_TAB: NotificationItemData[] = [
  {
    variant: "activity",
    userName: "Adrian Vale",
    avatar: "300-6.png",
    badgeColor: "offline",
    description: "posted a new article",
    link: "Marketing",
    time: "2 days ago",
    info: "Marketing",
  },
  {
    variant: "mention",
    userName: "Selene Silverleaf",
    avatar: "300-21.png",
    description: "commented on",
    link: "SiteSculpt",
    time: "4 days ago",
    specialist: "Manager",
    text: "This design is simply stunning! From layout to color, it's a work of art!",
  },
  {
    variant: "activity",
    userName: "Thalia Fox",
    avatar: "300-13.png",
    badgeColor: "online",
    description: "has invited you to join",
    link: "Design Research",
    time: "4 days ago",
    info: "Dev Team",
  },
];

const FOLLOWING_TAB: NotificationItemData[] = [
  {
    variant: "activity",
    userName: "Chloe Morgan",
    avatar: "300-34.png",
    badgeColor: "online",
    description: "posted a new article",
    link: "User Experience",
    time: "1 day ago",
    info: "Nexus",
  },
  {
    variant: "activity",
    userName: "Thalia Fox",
    avatar: "300-13.png",
    badgeColor: "offline",
    description: "has invited you to join",
    link: "Design Research",
    time: "4 days ago",
    info: "Dev Team",
  },
];

function NotificationList({ items }: { items: NotificationItemData[] }) {
  return (
    <div className="flex flex-col gap-5">
      {items.map((item, index) => (
        <div key={index}>
          {index > 0 && <div className="mb-5 border-b border-b-border" />}
          <NotificationItem {...item} />
        </div>
      ))}
    </div>
  );
}

export function NotificationsSheet({ trigger }: { trigger: ReactNode }) {
  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        className="inset-5 start-auto h-auto gap-0 rounded-lg p-0 sm:w-[500px] sm:max-w-none [&_[data-slot=sheet-close]]:end-5 [&_[data-slot=sheet-close]]:top-4.5"
        closeLabel="Close"
      >
        <SheetHeader className="mb-0">
          <SheetTitle className="p-3">Notifications</SheetTitle>
        </SheetHeader>
        <SheetBody className="p-0">
          <ScrollArea className="h-[calc(100vh-10.5rem)]">
            <Tabs defaultValue="all" className="relative w-full">
              <TabsList variant="line" className="mb-5 w-full px-5">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="inbox" className="relative">
                  Inbox
                  <div className="absolute -end-1 top-1 h-1.5 w-1.5 rounded-full bg-green-500" />
                </TabsTrigger>
                <TabsTrigger value="team">Team</TabsTrigger>
                <TabsTrigger value="following">Following</TabsTrigger>
                <div className="flex grow items-center justify-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" mode="icon" className="mb-1">
                        <Settings className="size-4.5!" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-44" side="bottom" align="end">
                      <DropdownMenuItem asChild>
                        <Link href="/account/members/teams">
                          <Users /> Invite Users
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <Settings2 />
                          <span>Team Settings</span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuPortal>
                          <DropdownMenuSubContent className="w-44">
                            <DropdownMenuItem asChild>
                              <Link href="/account/members/import-members">
                                <Shield />
                                Find Members
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href="/account/members/import-members">
                                <Calendar /> Meetings
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href="/account/members/import-members">
                                <Shield /> Group Settings
                              </Link>
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuPortal>
                      </DropdownMenuSub>
                      <DropdownMenuItem asChild>
                        <Link href="/account/security/privacy-settings">
                          <Shield /> Group Settings
                        </Link>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </TabsList>

              <TabsContent value="all" className="mt-0">
                <NotificationList items={ALL_TAB} />
              </TabsContent>
              <TabsContent value="inbox" className="mt-0">
                <NotificationList items={INBOX_TAB} />
              </TabsContent>
              <TabsContent value="team" className="mt-0">
                <NotificationList items={TEAM_TAB} />
              </TabsContent>
              <TabsContent value="following" className="mt-0">
                <NotificationList items={FOLLOWING_TAB} />
              </TabsContent>
            </Tabs>
          </ScrollArea>
        </SheetBody>
        <SheetFooter className="grid grid-cols-2 gap-2.5 border-t border-border p-5">
          <Button variant="outline">Archive all</Button>
          <Button variant="outline">Mark all as read</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
