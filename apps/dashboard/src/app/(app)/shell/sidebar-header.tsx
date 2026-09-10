"use client";

import Link from "next/link";
import { ChevronFirst } from "lucide-react";

import { Button, cn, toAbsoluteUrl } from "@schoolhub/ui";

import { usePreference, usePreferenceActions } from "@/providers/preferences-provider";

// Ported verbatim from packages/ui's layouts/demo1/components/sidebar-header.tsx.
export function SidebarHeader() {
  const sidebarCollapsed = usePreference("sidebar_collapsed");
  const { setPreference } = usePreferenceActions();

  const handleToggleClick = () => {
    setPreference("sidebar_collapsed", sidebarCollapsed === "collapsed" ? "expanded" : "collapsed");
  };

  return (
    <div className="sidebar-header relative hidden shrink-0 items-center justify-between px-3 lg:flex lg:px-6">
      <Link href="/dashboard">
        <div className="dark:hidden">
          <img
            src={toAbsoluteUrl("/media/app/default-logo.svg")}
            className="default-logo h-[22px] max-w-none"
            alt="Default Logo"
          />
          <img
            src={toAbsoluteUrl("/media/app/mini-logo.svg")}
            className="small-logo h-[22px] max-w-none"
            alt="Mini Logo"
          />
        </div>
        <div className="hidden dark:block">
          <img
            src={toAbsoluteUrl("/media/app/default-logo-dark.svg")}
            className="default-logo h-[22px] max-w-none"
            alt="Default Dark Logo"
          />
          <img
            src={toAbsoluteUrl("/media/app/mini-logo.svg")}
            className="small-logo h-[22px] max-w-none"
            alt="Mini Logo"
          />
        </div>
      </Link>
      <Button
        onClick={handleToggleClick}
        size="sm"
        mode="icon"
        variant="outline"
        className={cn(
          "absolute start-full top-2/4 size-7 -translate-x-2/4 -translate-y-2/4 rtl:translate-x-2/4",
          sidebarCollapsed === "collapsed" ? "ltr:rotate-180" : "rtl:rotate-180",
        )}
      >
        <ChevronFirst className="size-4!" />
      </Button>
    </div>
  );
}
