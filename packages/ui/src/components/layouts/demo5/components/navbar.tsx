"use client";

import { Container } from "@/components/common/container";
import { NavbarMenu } from "./navbar-menu";

const Navbar = () => {
  return (
    <div className="bg-bg-background mb-5 border-y border-border lg:mb-8">
      <Container className="flex flex-wrap items-center justify-between gap-2">
        <NavbarMenu />
      </Container>
    </div>
  );
};

export { Navbar };
