"use client";

import { ReactNode, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SearchDialog } from "@/partials/dialogs/search/search-dialog";
import { ChatSheet } from "@/partials/topbar/chat-sheet";
import { Download, MessageCircleMore, Search } from "lucide-react";
import { useBodyClass } from "@/hooks/use-body-class";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSettings } from "@/providers/settings-provider";
import { Button } from "@/components/ui/button";
import { StoreClientTopbar } from "@/app/(protected)/store-client/components/common/topbar";
import { Footer } from "./components/footer";
import { Header } from "./components/header";
import { Sidebar } from "./components/sidebar";
import { Toolbar, ToolbarActions, ToolbarHeading } from "./components/toolbar";

export function Demo8Layout({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const { setOption } = useSettings();
  const pathname = usePathname();

  // Using the custom hook to set classes on the body
  useBodyClass(`
    [--header-height:60px]
    [--sidebar-width:90px]
    bg-muted!
  `);

  useEffect(() => {
    setOption("layout", "demo8");
  }, [setOption]);

  return (
    <>
      <div className="flex grow">
        {isMobile && <Header />}

        <div className="flex grow flex-col pt-(--header-height) lg:flex-row lg:pt-0">
          {!isMobile && <Sidebar />}

          <div className="m-4 mt-0 flex grow flex-col rounded-xl border border-input bg-background lg:m-5 lg:ms-(--sidebar-width)">
            <div className="kt-scrollable-y-auto flex grow flex-col pt-5 lg:[scrollbar-width:auto]">
              <main className="grow" role="content">
                {!pathname.includes("/user-management") && (
                  <Toolbar>
                    <ToolbarHeading />
                    <ToolbarActions>
                      <>
                        {pathname.startsWith("/store-client") ? (
                          <StoreClientTopbar />
                        ) : (
                          <>
                            <SearchDialog
                              trigger={
                                <Button
                                  variant="ghost"
                                  mode="icon"
                                  className="hover:[&_svg]:text-primary"
                                >
                                  <Search className="size-4.5!" />
                                </Button>
                              }
                            />
                            <ChatSheet
                              trigger={
                                <Button
                                  variant="ghost"
                                  mode="icon"
                                  className="hover:[&_svg]:text-primary"
                                >
                                  <MessageCircleMore className="size-4.5!" />
                                </Button>
                              }
                            />
                            <Button
                              variant="outline"
                              asChild
                              className="ms-2.5 hover:text-primary hover:[&_svg]:text-primary"
                            >
                              <Link href={"/account/home/get-started"}>
                                <Download />
                                Export
                              </Link>
                            </Button>
                          </>
                        )}
                      </>
                    </ToolbarActions>
                  </Toolbar>
                )}

                {children}
              </main>
            </div>

            <Footer />
          </div>
        </div>
      </div>
    </>
  );
}
