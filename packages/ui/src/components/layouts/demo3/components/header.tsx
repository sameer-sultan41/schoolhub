"use client";

import { Container } from "@/components/common/container";
import { HeaderLogo } from "./header-logo";
import { HeaderTopbar } from "./header-topbar";

export function Header() {
  return (
    <header className="fixed top-0 right-0 left-0 z-10 flex h-(--header-height) shrink-0 items-center bg-muted">
      <Container className="flex items-stretch justify-between px-5 lg:gap-4 lg:ps-0">
        <HeaderLogo />
        <HeaderTopbar />
      </Container>
    </header>
  );
}
