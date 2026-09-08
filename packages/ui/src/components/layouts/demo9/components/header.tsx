"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useScrollPosition } from "@/hooks/use-scroll-position";
import { useSettings } from "@/providers/settings-provider";
import { Container } from "@/components/common/container";
import { HeaderLogo } from "./header-logo";
import { HeaderSearch } from "./header-search";
import { HeaderTopbar } from "./header-topbar";

export function Header() {
  const pathname = usePathname();
  const { settings } = useSettings();
  const scrollPosition = useScrollPosition();
  const [headerStickyOn, setHeaderStickyOn] = useState(false);

  useEffect(() => {
    const isSticky = scrollPosition > settings.layouts.demo2.headerStickyOffset;
    setHeaderStickyOn(isSticky);
  }, [scrollPosition, settings]);

  useEffect(() => {
    if (headerStickyOn === true) {
      document.body.setAttribute("data-sticky-header", "on");
    } else {
      document.body.removeAttribute("data-sticky-header");
    }
  }, [headerStickyOn]);

  return (
    <header
      className={cn(
        "flex h-(--header-height) shrink-0 items-center transition-[height]",
        headerStickyOn &&
          "fixed start-0 end-0 top-0 z-10 bg-background/70 shadow-xs backdrop-blur-md transition-[height]",
      )}
    >
      <Container className="flex items-center gap-2.5 lg:justify-between">
        <HeaderLogo />
        {!pathname.includes("/store-client") && <HeaderSearch />}
        <HeaderTopbar />
      </Container>
    </header>
  );
}
