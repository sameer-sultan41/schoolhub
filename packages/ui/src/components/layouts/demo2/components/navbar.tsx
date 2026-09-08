"use client";

import { Container } from "@/components/common/container";
import { NavbarLinks } from "./navbar-links";
import { NavbarMenu } from "./navbar-menu";

export function Navbar() {
  return (
    <div className="mb-5 border-b border-border pb-5 lg:mb-10 lg:pb-0">
      <Container className="flex flex-wrap items-center justify-between gap-2">
        <NavbarMenu />
        <NavbarLinks />
      </Container>
    </div>
  );
}
