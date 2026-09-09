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

const Header = () => {
  const pathname = usePathname();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const isMobile = useIsMobile();

  // Close sheet when route changes
  useEffect(() => {
    setIsSheetOpen(false);
  }, [pathname]);

  return (
    <header className="fixed start-0 end-0 top-0 z-10 flex h-(--header-height) shrink-0 items-center bg-muted lg:hidden">
      <Container className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/">
          <img
            src={toAbsoluteUrl("/media/app/mini-logo-gray.svg")}
            className="min-h-[30px] dark:hidden"
            alt="image"
          />
          <img
            src={toAbsoluteUrl("/media/app/mini-logo-gray-dark.svg")}
            className="hidden min-h-[30px] dark:block"
            alt="image"
          />
        </Link>

        {isMobile && (
          <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" mode="icon">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent className="w-[275px] gap-0 p-0" side="left" close={false}>
              <SheetHeader className="space-y-0 p-0" />
              <SheetBody className="flex grow flex-col p-0">
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
};

export { Header };
