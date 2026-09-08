"use client";

import { cn } from "@/lib/utils";

export interface ScrollspyMenuItem {
  title: string;
  target?: string;
  active?: boolean;
  children?: ScrollspyMenuItem[];
}
export type ScrollspyMenuItems = Array<ScrollspyMenuItem>;

export interface ScrollspyMenuProps {
  items: ScrollspyMenuItem[];
}

const ScrollspyMenu = ({ items }: ScrollspyMenuProps) => {
  const buildAnchor = (item: ScrollspyMenuItem, index: number, indent: boolean = false) => {
    return (
      <div
        key={index}
        data-scrollspy-anchor={item.target}
        className={cn(
          "flex cursor-pointer items-center rounded-lg border border-transparent py-1.5 ps-2.5 pe-2.5 text-accent-foreground hover:text-primary data-[active=true]:bg-accent data-[active=true]:font-medium data-[active=true]:text-primary",
          indent ? "gap-3.5" : "gap-1.5",
        )}
      >
        <span className="relative start-px flex w-1.5 before:absolute before:top-0 before:size-1.5 before:-translate-x-2/4 before:-translate-y-2/4 before:rounded-full rtl:-start-[5px] [[data-active=true]>&]:before:bg-primary"></span>
        {item.title}
      </div>
    );
  };

  const buildSubAnchors = (items: ScrollspyMenuItems) => {
    return items.map((item, index) => {
      return buildAnchor(item, index, true);
    });
  };

  const renderChildren = (items: ScrollspyMenuItems) => {
    return items.map((item, index) => {
      if (item.children) {
        return (
          <div key={index} className="flex flex-col">
            <div className="text-mono py-2.5 ps-6 pe-2.5 text-sm font-semibold">{item.title}</div>
            <div className="flex flex-col">{buildSubAnchors(item.children)}</div>
          </div>
        );
      } else {
        return buildAnchor(item, index);
      }
    });
  };

  return (
    <div className="relative flex grow flex-col text-sm before:absolute before:start-[11px] before:top-0 before:bottom-0 before:border-s before:border-border">
      {renderChildren(items)}
    </div>
  );
};

export { ScrollspyMenu };
