"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu } from "lucide-react";
import { MENU_ROOT } from "@/config/menu.config";
import { toAbsoluteUrl } from "@/lib/helpers";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTrigger } from "@/components/ui/sheet";
import { SidebarMenu } from "./sidebar-menu";

export function HeaderLogo() {
  const pathname = usePathname();
  const [selectedMenuItem, setSelectedMenuItem] = useState(MENU_ROOT[1]);

  useEffect(() => {
    MENU_ROOT.forEach((item) => {
      if (item.rootPath && pathname.includes(item.rootPath)) {
        setSelectedMenuItem(item);
      }
    });
  }, [pathname]);

  return (
    <div className="flex items-center gap-2.5">
      {/* Logo */}
      <div className="flex shrink-0 items-center justify-center lg:w-(--sidebar-width)">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" mode="icon" className="-ms-2 lg:hidden">
              <Menu className="size-4!" />
            </Button>
          </SheetTrigger>
          <SheetContent className="w-(--sidebar-width) gap-0 p-0" side="left" close={false}>
            <SheetHeader className="space-y-0 p-0" />
            <SheetBody className="overflow-y-auto p-0">
              <SidebarMenu />
            </SheetBody>
          </SheetContent>
        </Sheet>

        <Link href="/" className="mx-1">
          <img
            src={toAbsoluteUrl("/media/app/mini-logo-primary.svg")}
            className="min-h-[24px] dark:hidden"
            alt="logo"
          />
          <img
            src={toAbsoluteUrl("/media/app/mini-logo-primary-dark.svg")}
            className="hidden min-h-[24px] dark:inline-block"
            alt="logo"
          />
        </Link>
      </div>

      {/* Menu Section */}
      <div className="flex items-center gap-3">
        <h3 className="hidden text-base text-accent-foreground md:block">Metronic Team</h3>
        <span className="hidden text-sm font-medium text-muted-foreground md:inline">/</span>

        <DropdownMenu>
          <DropdownMenuTrigger className="text-mono flex cursor-pointer items-center gap-2 font-medium">
            {selectedMenuItem.title}
            <ChevronDown className="size-3.5! text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent sideOffset={10} side="bottom" align="start">
            {MENU_ROOT.map((item, index) => (
              <DropdownMenuItem
                key={index}
                asChild
                className={cn(item === selectedMenuItem && "bg-accent")}
              >
                <Link href={item.path || ""}>
                  {item.icon && <item.icon />}
                  {item.title}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
