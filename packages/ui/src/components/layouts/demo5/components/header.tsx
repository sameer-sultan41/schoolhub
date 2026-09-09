"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useScrollPosition } from "@/hooks/use-scroll-position";
import { useSettings } from "@/providers/settings-provider";
import { Container } from "@/components/common/container";
import { HeaderLogo } from "./header-logo";
import { HeaderTopbar } from "./header-topbar";

const Header = () => {
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
        "flex h-(--header-height) shrink-0 items-center bg-(--header-bg) transition-[height] dark:bg-(--header-bg-dark)",
        headerStickyOn &&
          "fixed start-0 end-0 top-0 z-10 bg-white/70 shadow-xs backdrop-blur-md transition-[height]",
      )}
    >
      <Container width="fluid" className="flex flex-wrap items-center justify-between lg:gap-4">
        <HeaderLogo />
        <HeaderTopbar />
      </Container>
    </header>
  );
};

export { Header };
