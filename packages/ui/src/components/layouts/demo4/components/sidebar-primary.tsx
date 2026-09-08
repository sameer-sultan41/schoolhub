"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppsDropdownMenu } from "@/partials/topbar/apps-dropdown-menu";
import { ChatSheet } from "@/partials/topbar/chat-sheet";
import { UserDropdownMenu } from "@/partials/topbar/user-dropdown-menu";
import {
  BarChart3,
  Bell,
  CheckSquare,
  Code,
  LayoutGrid,
  MessageCircleMore,
  MessageSquare,
  Settings,
  Shield,
  ShieldUser,
  ShoppingCart,
  UserCircle,
  Users,
} from "lucide-react";
import { getHeight } from "@/lib/dom";
import { toAbsoluteUrl } from "@/lib/helpers";
import { cn } from "@/lib/utils";
import { useViewport } from "@/hooks/use-viewport";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface MenuItem {
  icon: React.ComponentType<{ className?: string }>;
  tooltip: string;
  path: string;
  rootPath?: string;
}

const menuItems: MenuItem[] = [
  { icon: BarChart3, tooltip: "Dashboard", path: "/", rootPath: "/" },
  {
    icon: UserCircle,
    tooltip: "Profile",
    path: "/public-profile/profiles/default",
    rootPath: "/public-profile/",
  },
  {
    icon: Settings,
    tooltip: "Account",
    path: "/account/home/get-started",
    rootPath: "/account/",
  },
  {
    icon: Users,
    tooltip: "Network",
    path: "/network/get-started",
    rootPath: "/network/",
  },
  {
    tooltip: "User Management",
    icon: ShieldUser,
    path: "/user-management/users",
    rootPath: "/user-management/",
  },
  {
    icon: ShoppingCart,
    tooltip: "Store - Client",
    path: "/store-client/home",
    rootPath: "",
  },
  {
    icon: Shield,
    tooltip: "Authentication",
    path: "/authentication/get-started",
    rootPath: "/authentication/",
  },
  {
    icon: MessageSquare,
    tooltip: "Security Logs",
    path: "/account/security/security-log",
    rootPath: "/account/",
  },
  {
    icon: Bell,
    tooltip: "Notifications",
    path: "/account/notifications",
    rootPath: "",
  },
  {
    icon: CheckSquare,
    tooltip: "ACL",
    path: "/account/members/roles",
    rootPath: "",
  },
  { icon: Code, tooltip: "API Keys", path: "/account/api-keys", rootPath: "" },
];

export function SidebarPrimary() {
  const headerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const [scrollableHeight, setScrollableHeight] = useState<number>(0);
  const [viewportHeight] = useViewport();
  const scrollableOffset = 80;
  const pathname = usePathname();

  useEffect(() => {
    if (headerRef.current && footerRef.current) {
      const headerHeight = getHeight(headerRef.current);
      const footerHeight = getHeight(footerRef.current);
      const availableHeight = viewportHeight - headerHeight - footerHeight - scrollableOffset;
      setScrollableHeight(availableHeight);
    } else {
      setScrollableHeight(viewportHeight);
    }
  }, [viewportHeight]);

  const [selectedMenuItem, setSelectedMenuItem] = useState(menuItems[0]);

  useEffect(() => {
    menuItems.forEach((item) => {
      if (item.rootPath === pathname || (item.rootPath && pathname.includes(item.rootPath))) {
        setSelectedMenuItem(item);
      }
    });
  }, [pathname]);

  return (
    <TooltipProvider>
      <div className="flex w-[70px] shrink-0 flex-col items-stretch gap-5 border-e border-input py-5">
        <div ref={headerRef} className="hidden shrink-0 items-center justify-center lg:flex">
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
        </div>

        <div className="flex shrink-0 grow">
          <div
            className="kt-scrollable-y-hover flex shrink-0 grow flex-col gap-2.5 ps-4"
            style={{ height: `${scrollableHeight}px` }}
          >
            {menuItems.map((item, index) => (
              <Tooltip key={index}>
                <TooltipTrigger asChild>
                  <Button
                    asChild
                    variant="ghost"
                    mode="icon"
                    {...(item === selectedMenuItem ? { "data-state": "open" } : {})}
                    className={cn(
                      "size-9 shrink-0 rounded-md",
                      "data-[state=open]:border data-[state=open]:border-input data-[state=open]:bg-background data-[state=open]:text-primary",
                      "hover:border hover:border-input hover:bg-background hover:text-primary",
                    )}
                  >
                    <Link href={item.path}>
                      <item.icon className="size-4.5!" />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{item.tooltip}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        <div ref={footerRef} className="flex shrink-0 flex-col items-center gap-4">
          <ChatSheet
            trigger={
              <Button
                variant="ghost"
                mode="icon"
                className="size-9 hover:bg-background hover:[&_svg]:text-primary"
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
                className="size-9 hover:bg-background hover:[&_svg]:text-primary"
              >
                <LayoutGrid className="size-4.5!" />
              </Button>
            }
          />
          <UserDropdownMenu
            trigger={
              <img
                className="size-9 shrink-0 cursor-pointer rounded-full border border-border"
                src={toAbsoluteUrl("/media/avatars/300-2.png")}
                alt="User Avatar"
              />
            }
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
