"use client";

import { Container } from "@/components/common/container";
import { NavbarLinks } from "./navbar-links";
import { NavbarMenu } from "./navbar-menu";

export function Navbar() {
  return (
    <div className="start-(--sidebar-width) end-5 top-(--header-height) z-5 mx-5 flex h-(--navbar-height) items-stretch bg-muted lg:fixed lg:mx-0">
      <div className="flex grow items-stretch rounded-t-xl border border-border bg-background">
        <Container className="flex items-stretch justify-between gap-5">
          <NavbarMenu />
          <NavbarLinks />
        </Container>
      </div>
    </div>
  );
}
