"use client";

import { useEffect, type ReactNode } from "react";
import { useIsMobile } from "./use-mobile";

import { Footer } from "./footer";
import { Header } from "./header";
import { useSettings } from "./settings-provider";
import { Sidebar } from "./sidebar";

// Ported from packages/ui's vendored layouts/demo1/layout.tsx (Metronic's own Demo1
// shell), plus one addition: toggling `data-theme-preset="metronic"` on <html> so
// packages/ui's existing metronic.css preset actually applies to this route.
export function Shell({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const { settings, setOption } = useSettings();

  useEffect(() => {
    document.documentElement.dataset.themePreset = "metronic";
    return () => {
      delete document.documentElement.dataset.themePreset;
    };
  }, []);

  useEffect(() => {
    const bodyClass = document.body.classList;
    if (settings.layouts.demo1.sidebarCollapse) {
      bodyClass.add("sidebar-collapse");
    } else {
      bodyClass.remove("sidebar-collapse");
    }
  }, [settings]);

  useEffect(() => {
    setOption("layout", "demo1");
  }, [setOption]);

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
