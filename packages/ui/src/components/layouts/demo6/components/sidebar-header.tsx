"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Search } from "lucide-react";
import { MENU_ROOT } from "@/config/menu.config";
import { toAbsoluteUrl } from "@/lib/helpers";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

export function SidebarHeader() {
  const pathname = usePathname();
  const [selectedMenuItem, setSelectedMenuItem] = useState(MENU_ROOT[1]);

  const handleInputChange = () => {};

  useEffect(() => {
    MENU_ROOT.forEach((item) => {
      if (item.rootPath && pathname.includes(item.rootPath)) {
        setSelectedMenuItem(item);
      }
    });
  }, [pathname]);

  return (
    <div className="mb-3.5">
      <div className="flex h-[70px] items-center justify-between gap-2.5 px-3.5">
        <Link href="/">
          <img
            src={toAbsoluteUrl("/media/app/mini-logo-circle.svg")}
            className="h-[42px] dark:hidden"
            alt=""
          />
          <img
            src={toAbsoluteUrl("/media/app/mini-logo-circle-dark.svg")}
            className="hidden h-[42px] dark:inline-block"
            alt=""
          />
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger className="text-mono flex w-[150px] cursor-pointer items-center justify-between gap-2 font-medium">
            Metronic Cloud
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

      <div className="mb-1 px-3.5 pt-2.5">
        <div className="relative">
          <Search className="absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search"
            onChange={handleInputChange}
            className="min-w-0 px-9"
            value=""
          />
          <span className="absolute end-3.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            cmd + /
          </span>
        </div>
      </div>
    </div>
  );
}
