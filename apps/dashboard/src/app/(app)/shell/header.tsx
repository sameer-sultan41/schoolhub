"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, LayoutGrid, Menu, MessageCircleMore, Search } from "lucide-react";

import {
  Button,
  cn,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTrigger,
  toAbsoluteUrl,
  useIsMobile,
  useScrollPosition,
} from "@schoolhub/ui";

import { LayoutControls } from "@/components/layout-controls";

import { Container } from "@/app/(app)/shell/partials/common/container";
import { AppsDropdownMenu } from "@/app/(app)/shell/partials/topbar/apps-dropdown-menu";
import { ChatSheet } from "@/app/(app)/shell/partials/topbar/chat-sheet";
import { NotificationsSheet } from "@/app/(app)/shell/partials/topbar/notifications-sheet";
import { SearchDialog } from "@/app/(app)/shell/partials/topbar/search-dialog";
import { UserDropdownMenu } from "@/app/(app)/shell/partials/topbar/user-dropdown-menu";
import { Breadcrumb } from "@/app/(app)/shell/breadcrumb";
import { SidebarMenu } from "@/app/(app)/shell/sidebar-menu";

// Ported from packages/ui's layouts/demo1/components/header.tsx. The
// StoreClientTopbar branch (a /store-client-only page that doesn't exist in
// this app) was dropped, and so was the desktop/mobile mega-menu — it
// duplicated the sidebar's own real nav with more of Metronic's demo content
// (Public Profile/Network/Store/My Account), adding no capability the sidebar
// didn't already have once the sidebar became permission-aware.
export function Header() {
  const [isSidebarSheetOpen, setIsSidebarSheetOpen] = useState(false);

  const pathname = usePathname();
  const mobileMode = useIsMobile();

  const scrollPosition = useScrollPosition();
  const headerSticky: boolean = scrollPosition > 0;

  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setIsSidebarSheetOpen(false);
  }

  return (
    <header
      className={cn(
        "header fixed start-0 end-0 top-0 z-10 flex shrink-0 items-stretch border-b border-transparent bg-background pe-[var(--removed-body-scroll-bar-size,0px)]",
        headerSticky && "border-b border-border",
      )}
    >
      <Container className="flex items-stretch justify-between lg:gap-4">
        <div className="flex items-center gap-1 gap-2.5 lg:hidden">
          <Link href="/dashboard" className="shrink-0">
            <img
              src={toAbsoluteUrl("/media/app/mini-logo.svg")}
              className="h-[25px] w-full"
              alt="mini-logo"
            />
          </Link>
          <div className="flex items-center">
            {mobileMode && (
              <Sheet open={isSidebarSheetOpen} onOpenChange={setIsSidebarSheetOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" mode="icon">
                    <Menu className="text-muted-foreground/70" />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  className="w-[275px] gap-0 p-0"
                  side="start"
                  close={false}
                  closeLabel="Close"
                >
                  <SheetHeader className="space-y-0 p-0" />
                  <SheetBody className="overflow-y-auto p-0">
                    <SidebarMenu />
                  </SheetBody>
                </SheetContent>
              </Sheet>
            )}
          </div>
        </div>

        <Breadcrumb />

        <div className="flex items-center gap-3">
          {!mobileMode && (
            <SearchDialog
              trigger={
                <Button
                  variant="ghost"
                  mode="icon"
                  shape="circle"
                  className="size-9 hover:bg-primary/10 hover:[&_svg]:text-primary"
                >
                  <Search className="size-4.5!" />
                </Button>
              }
            />
          )}
          <NotificationsSheet
            trigger={
              <Button
                variant="ghost"
                mode="icon"
                shape="circle"
                className="size-9 hover:bg-primary/10 hover:[&_svg]:text-primary"
              >
                <Bell className="size-4.5!" />
              </Button>
            }
          />
          <ChatSheet
            trigger={
              <Button
                variant="ghost"
                mode="icon"
                shape="circle"
                className="size-9 hover:bg-primary/10 hover:[&_svg]:text-primary"
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
                shape="circle"
                className="size-9 hover:bg-primary/10 hover:[&_svg]:text-primary"
              >
                <LayoutGrid className="size-4.5!" />
              </Button>
            }
          />
          <LayoutControls />
          <UserDropdownMenu
            trigger={
              <img
                className="size-9 shrink-0 cursor-pointer rounded-full border-2 border-green-500"
                src={toAbsoluteUrl("/media/avatars/300-2.png")}
                alt="User Avatar"
              />
            }
          />
        </div>
      </Container>
    </header>
  );
}
