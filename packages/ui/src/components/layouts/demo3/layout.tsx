"use client";

import { ReactNode, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Download } from "lucide-react";
import { useBodyClass } from "@/hooks/use-body-class";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSettings } from "@/providers/settings-provider";
import { Button } from "@/components/ui/button";
import { Footer } from "./components/footer";
import { Header } from "./components/header";
import { Navbar } from "./components/navbar";
import { Sidebar } from "./components/sidebar";
import { Toolbar, ToolbarActions, ToolbarHeading } from "./components/toolbar";

export function Demo3Layout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { setOption } = useSettings();
  const isMobileMode = useIsMobile();

  useBodyClass(`
    [--header-height:58px] 
    [--sidebar-width:58px] 
    [--navbar-height:56px] 
    lg:overflow-hidden 
    bg-muted!
  `);

  useEffect(() => {
    setOption("layout", "demo3");
    setOption("container", "fluid");
  }, [setOption]);

  return (
    <>
      <div className="flex grow">
        <Header />

        <div className="flex grow flex-col pt-(--header-height) lg:flex-row">
          {!isMobileMode && <Sidebar />}

          <Navbar />

          <div className="mx-5 mb-5 flex grow rounded-b-xl border-x border-b border-border bg-background lg:ms-(--sidebar-width) lg:mt-(--navbar-height)">
            <div className="kt-scrollable-y flex grow flex-col pt-7 lg:[scrollbar-width:auto] lg:[&_[data-slot=container]]:pe-2">
              <main className="grow" role="content">
                {pathname !== "/" &&
                  !pathname.includes("/user-management") &&
                  !pathname.includes("/store-client") && (
                    <Toolbar>
                      <ToolbarHeading />
                      <ToolbarActions>
                        <Button variant="outline" size="sm" asChild>
                          <Link href={"/account/home/get-started"}>
                            <Download />
                            Export
                          </Link>
                        </Button>
                      </ToolbarActions>
                    </Toolbar>
                  )}
                {children}
              </main>
              <Footer />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
