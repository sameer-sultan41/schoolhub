"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  Menu,
  Settings,
  Shield,
  UserCircle,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toAbsoluteUrl } from "@/lib/helpers";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTrigger } from "@/components/ui/sheet";
import { SidebarMenuDashboard } from "./sidebar-menu-dashboard";
import { SidebarMenuDefault } from "./sidebar-menu-default";

interface HeaderLogoTeam {
  title: string;
  icon?: LucideIcon;
  urlPartial: string;
  path: string;
}
type HeaderLogoTeams = Array<HeaderLogoTeam>;

interface HeaderLogoItem {
  title: string;
  icon?: LucideIcon;
}
type HeaderLogoItems = Array<HeaderLogoItem>;

interface HeaderLogoStaging {
  title: string;
  icon?: LucideIcon;
}
type HeaderLogoStagings = Array<HeaderLogoStaging>;

export function HeaderLogo() {
  const pathname = usePathname();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const isMobile = useIsMobile();

  const teams: HeaderLogoTeams = [
    {
      title: "MetronicTeam",
      icon: UserCircle,
      urlPartial: "/public-profile/",
      path: "/public-profile/profiles/default",
    },
    {
      title: "KeenTeam",
      icon: Settings,
      urlPartial: "/account/",
      path: "/",
    },
  ];

  const items: HeaderLogoItems = [
    {
      title: "Campaign",
      icon: UserCircle,
    },
    {
      title: "Fall Winter 2024 ",
      icon: Settings,
    },
    {
      title: "Barberry Autmn 24",
      icon: Users,
    },
    {
      title: "PF24 Advertising",
      icon: Shield,
    },
  ];

  const stagings: HeaderLogoStagings = [
    {
      title: "Staging",
      icon: UserCircle,
    },
    {
      title: "Account",
      icon: Settings,
    },
  ];

  const [selectedTeam, setSelectedTeam] = useState(teams[0]);
  const [selectedItem, setSelectedItem] = useState(items[0]);
  const [selectedStaging, setSelectedStaging] = useState(stagings[0]);

  // Close sheet when route changes
  useEffect(() => {
    setIsSheetOpen(false);
  }, [pathname]);

  return (
    <div className="flex items-center gap-1.5 lg:gap-5">
      <Link href="/">
        <img
          src={toAbsoluteUrl("/media/app/mini-logo-circle.svg")}
          className="min-h-[34px] dark:hidden"
          alt="logo"
        />
        <img
          src={toAbsoluteUrl("/media/app/mini-logo-circle-dark.svg")}
          className="hidden min-h-[34px] dark:inline-block"
          alt="logo"
        />
      </Link>

      {isMobile && (
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="dim" mode="icon">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent className="w-[250px] gap-0 p-0" side="left" close={false}>
            <SheetHeader className="space-y-0 p-0" />
            <SheetBody className="overflow-y-auto p-3">
              {pathname === "/" ? <SidebarMenuDashboard /> : <SidebarMenuDefault />}
            </SheetBody>
          </SheetContent>
        </Sheet>
      )}

      {!isMobile && (
        <div className="items-stretch gap-3 lg:flex">
          {/* Teams Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger className="flex cursor-pointer items-center gap-2 text-sm font-medium text-secondary-foreground">
              {selectedTeam.title}
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent sideOffset={15} side="bottom" align="start">
              {teams.map((team, index) => (
                <DropdownMenuItem
                  key={index}
                  asChild
                  className={cn(team === selectedTeam && "bg-accent")}
                  onSelect={() => setSelectedTeam(team)}
                >
                  <Link href={team.path}>
                    {team.icon && <team.icon />}
                    {team.title}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <span className="px-2.5 text-sm font-medium text-muted-foreground md:inline">/</span>

          {/* Items Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger className="flex cursor-pointer items-center gap-2 text-sm font-medium text-secondary-foreground">
              {selectedItem.title}
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent sideOffset={15} side="bottom" align="start">
              {items.map((item, index) => (
                <DropdownMenuItem
                  key={index}
                  asChild
                  className={cn(item === selectedItem && "bg-accent")}
                  onSelect={() => setSelectedItem(item)}
                >
                  <Link href="/">
                    {item.icon && <item.icon />}
                    {item.title}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <span className="px-2.5 text-sm font-medium text-muted-foreground">/</span>

          {/* Staging Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger className="flex cursor-pointer items-center gap-2 text-sm font-medium text-secondary-foreground">
              {selectedStaging.title}
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent sideOffset={15} side="bottom" align="start">
              {stagings.map((staging, index) => (
                <DropdownMenuItem
                  key={index}
                  asChild
                  className={cn(staging === selectedStaging && "bg-accent")}
                  onSelect={() => setSelectedStaging(staging)}
                >
                  <Link href="/">
                    {staging.icon && <staging.icon />}
                    {staging.title}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
