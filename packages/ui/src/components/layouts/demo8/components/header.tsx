"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { toAbsoluteUrl } from "@/lib/helpers";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTrigger } from "@/components/ui/sheet";
import { Container } from "@/components/common/container";
import { SidebarFooter } from "./sidebar-footer";
import { SidebarMenu } from "./sidebar-menu";

export function Header() {
  const pathname = usePathname();
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  // Close sheet when route changes
  useEffect(() => {
    setIsSheetOpen(false);
  }, [pathname]);

  return (
    <header className="fixed start-0 end-0 top-0 z-10 flex h-(--header-height) shrink-0 items-center bg-muted">
      <Container className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/">
          <img
            src={toAbsoluteUrl("/media/app/mini-logo-gray.svg")}
            className="h-[30px] dark:hidden"
            alt="image"
          />
          <img
            src={toAbsoluteUrl("/media/app/mini-logo-gray-dark.svg")}
            className="hidden h-[30px] dark:inline-block"
            alt="image"
          />
        </Link>

        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="dim" mode="icon">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent className="w-(--sidebar-width) gap-0 p-0" side="left" close={false}>
            <SheetHeader className="space-y-0 p-0" />
            <SheetBody className="flex grow flex-col px-0 pt-5">
              <SidebarMenu />
              <SidebarFooter />
            </SheetBody>
          </SheetContent>
        </Sheet>
      </Container>
    </header>
  );
}
