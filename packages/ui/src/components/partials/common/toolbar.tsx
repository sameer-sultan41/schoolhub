"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { MENU_SIDEBAR } from "@/config/menu.config";
import { useMenu } from "@/hooks/use-menu";

const Toolbar = ({ children }: { children: ReactNode }) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-5 pb-7.5 lg:items-end">
      {children}
    </div>
  );
};

const ToolbarActions = ({ children }: { children: ReactNode }) => {
  return <div className="flex items-center gap-2.5">{children}</div>;
};

const ToolbarPageTitle = ({ text }: { text?: string }) => {
  const pathname = usePathname();
  const { getCurrentItem } = useMenu(pathname);
  const item = getCurrentItem(MENU_SIDEBAR);

  return <h1 className="text-mono text-xl leading-none font-medium">{text ?? item?.title}</h1>;
};

const ToolbarDescription = ({ children }: { children: ReactNode }) => {
  return (
    <div className="flex items-center gap-2 text-sm font-normal text-secondary-foreground">
      {children}
    </div>
  );
};

const ToolbarHeading = ({ children }: { children: ReactNode }) => {
  return <div className="flex flex-col justify-center gap-2">{children}</div>;
};

export { Toolbar, ToolbarActions, ToolbarPageTitle, ToolbarHeading, ToolbarDescription };
