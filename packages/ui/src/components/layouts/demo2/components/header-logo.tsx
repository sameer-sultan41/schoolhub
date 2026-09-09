"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { MENU_ROOT } from "@/config/menu.config";
import { toAbsoluteUrl } from "@/lib/helpers";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
    <div className="flex items-center gap-2 lg:gap-5 2xl:-ms-[60px]">
      {/* Logo Section */}
      <Link href="/" className="shrink-0">
        <img
          src={toAbsoluteUrl("/media/app/mini-logo-circle.svg")}
          className="min-h-[42px] dark:hidden"
          alt="logo"
        />
        <img
          src={toAbsoluteUrl("/media/app/mini-logo-circle-dark.svg")}
          className="hidden min-h-[42px] dark:inline-block"
          alt="logo"
        />
      </Link>

      {/* Menu Section */}
      <div className="flex items-center gap-3">
        <h3 className="hidden text-base text-accent-foreground md:block">Metronic Team</h3>
        <span className="hidden text-sm font-medium text-muted-foreground md:inline">/</span>

        <DropdownMenu>
          <DropdownMenuTrigger className="text-mono flex cursor-pointer items-center gap-2 font-medium">
            {selectedMenuItem.title}
            <ChevronDown className="size-4 text-muted-foreground" />
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
