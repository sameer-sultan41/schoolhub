"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, LayoutGrid, Menu, MessageCircleMore, Search } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Button,
  cn,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTrigger,
  toAbsoluteUrl,
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
  const t = useTranslations("nav");
  const [isSidebarSheetOpen, setIsSidebarSheetOpen] = useState(false);

  const pathname = usePathname();

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
        // lg:fixed, not the shell's normal `fixed`: below 1024px the header takes a
        // proportionally much bigger bite out of a small viewport, and Shell.tsx's
        // own `header-fixed` body class (which drives demo1.css's compensating
        // wrapper padding-top) is only added at the same breakpoint — the two stay
        // in sync on purpose, see that effect's own comment.
        "header start-0 end-0 top-0 z-10 flex shrink-0 items-stretch border-b border-transparent bg-background pe-[var(--removed-body-scroll-bar-size,0px)] lg:fixed",
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
            {/* No JS gate here: the parent's `lg:hidden` already shows this only
                below the shell's desktop breakpoint, instantly and without
                depending on a client-side viewport check settling in — see
                `use-is-desktop-shell.ts` for why that check used to leave this
                unrendered on a real phone/tablet's first paint. */}
            <Sheet open={isSidebarSheetOpen} onOpenChange={setIsSidebarSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" mode="icon" aria-label={t("primary")}>
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
                <SheetBody
                  className="overflow-y-auto p-0"
                  role="navigation"
                  aria-label={t("primary")}
                >
                  <SidebarMenu />
                </SheetBody>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 items-center px-1 lg:px-3">
          <Breadcrumb />
        </div>

        <div className="flex items-center gap-3">
          {/* md:block (768px) — the mobile-nav wrapper above (logo + hamburger) is
              `lg:hidden` (1024px) for an unrelated reason (it's the docked-sidebar's
              own stand-in, so it only needs to disappear once the sidebar docks), not
              because anything else in this row needs to share its breakpoint. Search
              stays reachable at every width from 768px up, same as before this
              breakpoint was briefly (and wrongly) narrowed to 1024px, which left
              768–1023px with no search entry point at all. */}
          <div className="hidden md:block">
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
          </div>
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
          <UserDropdownMenu />
        </div>
      </Container>
    </header>
  );
}
