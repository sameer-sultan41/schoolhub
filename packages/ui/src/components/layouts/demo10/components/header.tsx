"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { toAbsoluteUrl } from "@/lib/helpers";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTrigger } from "@/components/ui/sheet";
import { Container } from "@/components/common/container";
import { SidebarFooter } from "./sidebar-footer";
import { SidebarHeader } from "./sidebar-header";
import { SidebarMenu } from "./sidebar-menu";

export function Header() {
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  // Close sheet when route changes
  useEffect(() => {
    setIsSheetOpen(false);
  }, [pathname]);

  return (
    <header className="bg-mono fixed start-0 end-0 top-0 z-10 flex h-(--header-height) shrink-0 items-center lg:hidden dark:bg-background">
      <Container className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/">
          <img
            src={toAbsoluteUrl("/media/app/mini-logo-circle-success.svg")}
            className="h-[34px]"
            alt=""
          />
        </Link>

        {isMobile && (
          <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="dim" mode="icon" className="hover:text-white">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent className="dark w-[250px] gap-0 p-0" side="left" close={false}>
              <SheetHeader className="space-y-0 p-0" />
              <SheetBody className="flex grow flex-col overflow-y-auto p-0">
                <SidebarHeader />
                <SidebarMenu />
                <SidebarFooter />
              </SheetBody>
            </SheetContent>
          </Sheet>
        )}
      </Container>
    </header>
  );
}
