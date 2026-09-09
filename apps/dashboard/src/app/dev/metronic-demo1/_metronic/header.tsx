"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  LayoutGrid,
  Menu,
  MessageCircleMore,
  Search,
  SquareChevronRight,
} from "lucide-react";

import {
  Button,
  cn,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTrigger,
} from "@schoolhub/ui";
import { useIsMobile } from "./use-mobile";

import { toAbsoluteUrl } from "./helpers";
import { MegaMenu } from "./mega-menu";
import { MegaMenuMobile } from "./mega-menu-mobile";
import { Container } from "./partials/common/container";
import { AppsDropdownMenu } from "./partials/topbar/apps-dropdown-menu";
import { ChatSheet } from "./partials/topbar/chat-sheet";
import { NotificationsSheet } from "./partials/topbar/notifications-sheet";
import { SearchDialog } from "./partials/topbar/search-dialog";
import { UserDropdownMenu } from "./partials/topbar/user-dropdown-menu";
import { Breadcrumb } from "./breadcrumb";
import { SidebarMenu } from "./sidebar-menu";
import { useScrollPosition } from "./use-scroll-position";

// Ported from packages/ui's layouts/demo1/components/header.tsx. The
// StoreClientTopbar branch (a /store-client-only page that doesn't exist in
// this preview) was dropped — dead code here, always renders the normal topbar.
export function Header() {
  const [isSidebarSheetOpen, setIsSidebarSheetOpen] = useState(false);
  const [isMegaMenuSheetOpen, setIsMegaMenuSheetOpen] = useState(false);

  const pathname = usePathname();
  const mobileMode = useIsMobile();

  const scrollPosition = useScrollPosition();
  const headerSticky: boolean = scrollPosition > 0;

  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setIsSidebarSheetOpen(false);
    setIsMegaMenuSheetOpen(false);
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
            {mobileMode && (
              <Sheet open={isMegaMenuSheetOpen} onOpenChange={setIsMegaMenuSheetOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" mode="icon">
                    <SquareChevronRight className="text-muted-foreground/70" />
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
                    <MegaMenuMobile />
                  </SheetBody>
                </SheetContent>
              </Sheet>
            )}
          </div>
        </div>

        {pathname.startsWith("/account") ? <Breadcrumb /> : !mobileMode && <MegaMenu />}

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
