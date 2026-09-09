"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { toAbsoluteUrl } from "@/lib/helpers";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTrigger } from "@/components/ui/sheet";
import { Container } from "@/components/common/container";
import { SidebarPrimary } from "./sidebar-primary";
import { SidebarSecondary } from "./sidebar-secondary";

export function Header() {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const pathname = usePathname();

  // Close sheet when route changes
  useEffect(() => {
    setIsSheetOpen(false);
  }, [pathname]);

  return (
    <header className="fixed start-0 end-0 top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center bg-[var(--page-bg)] lg:hidden dark:bg-[var(--page-bg-dark)]">
      <Container className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/">
          <img
            src={toAbsoluteUrl("/media/app/mini-logo-gray.svg")}
            className="min-h-[30px] dark:hidden"
            alt=""
          />
          <img
            src={toAbsoluteUrl("/media/app/mini-logo-gray-dark.svg")}
            className="hidden min-h-[30px] dark:block"
            alt=""
          />
        </Link>

        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" mode="icon" className="-ms-2 lg:hidden">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent className="w-[var(--sidebar-width)] gap-0 p-0" side="left" close={false}>
            <SheetHeader className="space-y-0 p-0" />
            <SheetBody className="flex shrink-0 items-stretch overflow-y-auto p-0">
              <SidebarPrimary />
              <SidebarSecondary />
            </SheetBody>
          </SheetContent>
        </Sheet>
      </Container>
    </header>
  );
}
