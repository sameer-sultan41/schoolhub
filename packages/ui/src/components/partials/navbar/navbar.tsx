"use client";

import { ReactNode } from "react";

function Navbar({ children }: { children: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border md:flex-nowrap lg:mb-10 lg:items-end lg:gap-6">
      {children}
    </div>
  );
}

function NavbarActions({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1.5 flex grow items-center justify-end gap-2.5 lg:mb-0 lg:grow-0 lg:pb-4">
      {children}
    </div>
  );
}

export { Navbar, NavbarActions };
