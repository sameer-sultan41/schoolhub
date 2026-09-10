"use client";

import { useEffect, type ReactNode } from "react";
import { useIsMobile } from "@schoolhub/ui";

import { Footer } from "@/app/(app)/shell/footer";
import { Header } from "@/app/(app)/shell/header";
import { Sidebar } from "@/app/(app)/shell/sidebar";
import { usePreference } from "@/providers/preferences-provider";

// Ported from packages/ui's vendored layouts/demo1/layout.tsx (Metronic's own Demo1
// shell). `data-theme-preset="metronic"` is set on <html> by the root layout now, not
// here — it needs to apply app-wide (auth pages included), not just while this Shell is
// mounted.
export function Shell({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const sidebarCollapsed = usePreference("sidebar_collapsed");

  useEffect(() => {
    const bodyClass = document.body.classList;
    if (sidebarCollapsed === "collapsed") {
      bodyClass.add("sidebar-collapse");
    } else {
      bodyClass.remove("sidebar-collapse");
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    const bodyClass = document.body.classList;
    bodyClass.add("demo1", "sidebar-fixed", "header-fixed");
    const timer = setTimeout(() => {
      bodyClass.add("layout-initialized");
    }, 1000);
    return () => {
      bodyClass.remove(
        "demo1",
        "sidebar-fixed",
        "sidebar-collapse",
        "header-fixed",
        "layout-initialized",
      );
      clearTimeout(timer);
    };
  }, []);

  return (
    <>
      {!isMobile && <Sidebar />}
      <div className="wrapper flex grow flex-col">
        <Header />
        <main className="grow pt-5" role="content">
          {children}
        </main>
        <Footer />
      </div>
    </>
  );
}
