"use client";

import { useEffect, type ReactNode } from "react";

import { Footer } from "@/app/(app)/shell/footer";
import { Header } from "@/app/(app)/shell/header";
import { useSettings } from "@/app/(app)/shell/settings-provider";
import { Sidebar } from "@/app/(app)/shell/sidebar";
import { useIsDesktopShell } from "@/hooks/use-is-desktop-shell";

// Ported from packages/ui's vendored layouts/demo1/layout.tsx (Metronic's own Demo1
// shell). `data-theme-preset="metronic"` is set on <html> by the root layout now, not
// here — it needs to apply app-wide (auth pages included), not just while this Shell is
// mounted.
export function Shell({ children }: { children: ReactNode }) {
  const isDesktopShell = useIsDesktopShell();
  const { settings, setOption, storeOption } = useSettings();

  useEffect(() => {
    const bodyClass = document.body.classList;
    if (settings.layouts.demo1.sidebarCollapse) {
      bodyClass.add("sidebar-collapse");
    } else {
      bodyClass.remove("sidebar-collapse");
    }
  }, [settings]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "b" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        storeOption("layouts.demo1.sidebarCollapse", !settings.layouts.demo1.sidebarCollapse);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [settings, storeOption]);

  useEffect(() => {
    setOption("layout", "demo1");
  }, [setOption]);

  useEffect(() => {
    const bodyClass = document.body.classList;
    bodyClass.add("demo1", "sidebar-fixed");
    const timer = setTimeout(() => {
      bodyClass.add("layout-initialized");
    }, 1000);
    return () => {
      bodyClass.remove("demo1", "sidebar-fixed", "sidebar-collapse", "layout-initialized");
      clearTimeout(timer);
    };
  }, []);

  // Separate from the effect above (and keyed on isDesktopShell, not mount-once):
  // a fixed header permanently spends part of an already-small mobile viewport on
  // chrome. `.header-fixed` also drives demo1.css's `.wrapper` padding-top
  // compensation for the fixed header's own height — pairing them in one effect
  // means the reserved space and the header's actual position never disagree.
  useEffect(() => {
    const bodyClass = document.body.classList;
    if (isDesktopShell) {
      bodyClass.add("header-fixed");
    } else {
      bodyClass.remove("header-fixed");
    }
    return () => {
      bodyClass.remove("header-fixed");
    };
  }, [isDesktopShell]);

  return (
    <>
      {isDesktopShell && <Sidebar />}
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
