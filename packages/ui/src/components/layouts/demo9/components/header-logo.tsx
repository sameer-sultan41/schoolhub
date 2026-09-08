"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { toAbsoluteUrl } from "@/lib/helpers";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTrigger } from "@/components/ui/sheet";
import { MegaMenuMobile } from "./mega-menu-mobile";

export function HeaderLogo() {
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  // Close sheet when route changes
  useEffect(() => {
    setIsSheetOpen(false);
  }, [pathname]);

  return (
    <div className="flex grow items-center gap-1 lg:w-[400px] lg:grow-0">
      <div className="flex shrink-0 items-center gap-2">
        <Link href="/">
          <img
            src={toAbsoluteUrl("/media/app/mini-logo-circle.svg")}
            className="min-h-[34px] shrink-0 dark:hidden"
            alt="logo"
          />
          <img
            src={toAbsoluteUrl("/media/app/mini-logo-circle-dark.svg")}
            className="hidden min-h-[34px] shrink-0 dark:inline-block"
            alt="logo"
          />
        </Link>
        <h3 className="text-mono hidden text-lg font-medium md:block">Metronic</h3>
      </div>

      {isMobile && (
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="dim" mode="icon">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent className="w-[275px] gap-0 p-0" side="left" close={false}>
            <SheetHeader className="space-y-0 p-0" />
            <SheetBody className="overflow-y-auto p-0">
              <MegaMenuMobile />
            </SheetBody>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
