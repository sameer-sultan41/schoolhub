"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { toAbsoluteUrl } from "@/lib/helpers";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTrigger } from "@/components/ui/sheet";
import { MegaMenu } from "./mega-menu";
import { MegaMenuMobile } from "./mega-menu-mobile";

const HeaderLogo = () => {
  const pathname = usePathname();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const isMobile = useIsMobile();

  // Close sheet when route changes
  useEffect(() => {
    setIsSheetOpen(false);
  }, [pathname]);

  return (
    <div className="flex grow items-stretch gap-1.5 lg:gap-10">
      <div className="flex items-center gap-2.5">
        <Link href="/">
          <img
            src={toAbsoluteUrl("/media/app/mini-logo-circle-primary.svg")}
            className="min-h-[34px] dark:hidden"
            alt="logo"
          />
          <img
            src={toAbsoluteUrl("/media/app/mini-logo-circle-primary-dark.svg")}
            className="hidden min-h-[34px] dark:inline-block"
            alt="logo"
          />
        </Link>

        <h3 className="text-mono hidden text-lg font-medium lg:block">Metronic</h3>
      </div>

      {!isMobile ? (
        <MegaMenu />
      ) : (
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="dim" mode="icon">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent className="w-[275px] gap-0 p-0" side="left" close={false}>
            <SheetHeader className="space-y-0 p-0" />
            <SheetBody className="flex grow flex-col p-0">
              <MegaMenuMobile />
            </SheetBody>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
};

export { HeaderLogo };
