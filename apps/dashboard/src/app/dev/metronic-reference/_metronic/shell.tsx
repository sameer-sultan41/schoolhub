"use client";

import { cn } from "@schoolhub/ui";
import { type ReactNode, useState } from "react";
import { Header } from "./header";
import { Sidebar } from "./sidebar";

/**
 * Copied from Metronic's own `layout.tsx` (Demo1Layout) structurally — sidebar as a fixed
 * sibling of a content wrapper carrying the header and page body — with Metronic's own
 * `useSettings`/`document.body` class toggling replaced by plain `useState`: this
 * reference exists to be looked at, not to persist a preference across reloads. The
 * content wrapper's `lg:ps-*` swap stands in for Metronic's own CSS custom-property
 * width swap (`--sidebar-width` via a `.sidebar-collapse` body class) — same visual
 * result, without needing to vendor that stylesheet.
 */
export function MetronicReferenceShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex min-h-dvh grow">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => {
          setCollapsed((value) => !value);
        }}
      />
      <div
        className={cn(
          "flex grow flex-col transition-[padding] duration-200",
          collapsed ? "lg:ps-20" : "lg:ps-70",
        )}
      >
        <Header />
        <main className="grow p-5 lg:p-7.5">{children}</main>
      </div>
    </div>
  );
}
