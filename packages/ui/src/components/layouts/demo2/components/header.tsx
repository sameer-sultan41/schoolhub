"use client";

import { useEffect, useState } from "react"; // Add useState to the imports
import { cn } from "@/lib/utils";
import { useScrollPosition } from "@/hooks/use-scroll-position";
import { useSettings } from "@/providers/settings-provider";
import { Container } from "@/components/common/container";
import { HeaderLogo } from "./header-logo";
import { HeaderTopbar } from "./header-topbar";

export function Header() {
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
        "flex h-(--header-height) shrink-0 items-center transition-[height] in-data-[sticky-header=on]:pe-[var(--removed-body-scroll-bar-size,0px)]",
        settings.layouts.demo2.headerSticky &&
          headerStickyOn &&
          "fixed start-0 end-0 top-0 z-10 bg-background/70 shadow-xs backdrop-blur-md transition-[height]",
      )}
    >
      <Container className="flex items-center justify-between lg:gap-4">
        <HeaderLogo />
        <HeaderTopbar />
      </Container>
    </header>
  );
}
