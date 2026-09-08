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
        "flex shrink-0 items-center bg-background py-4 transition-[height] lg:h-(--header-height) lg:py-0",
        headerStickyOn &&
          "fixed top-0 right-0 left-0 z-10 bg-background/70 pe-[var(--removed-body-scroll-bar-size,0px)] shadow-xs backdrop-blur-md transition-[height]",
      )}
    >
      <Container className="flex flex-wrap items-center gap-2 lg:gap-4">
        <HeaderLogo />
        <HeaderTopbar />
      </Container>
    </header>
  );
};

export { Header };
