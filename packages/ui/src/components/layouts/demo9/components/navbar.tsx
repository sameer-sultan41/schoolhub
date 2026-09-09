"use client";

import { Container } from "@/components/common/container";
import { MegaMenu } from "./mega-menu";

export function Navbar() {
  return (
    <div className="border-y border-border bg-muted/80 lg:flex lg:items-stretch">
      <Container className="flex flex-wrap items-center justify-between gap-2 px-0 lg:px-7.5">
        <MegaMenu />
      </Container>
    </div>
  );
}
