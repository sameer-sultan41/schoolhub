"use client";

import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";

interface TimelineItemProps {
  icon: LucideIcon;
  line: boolean;
  children: ReactNode;
  removeSpace?: boolean;
}

export function TimelineItem({ line, icon: Icon, children, removeSpace }: TimelineItemProps) {
  return (
    <div className="relative flex items-start">
      {line && (
        <div className="absolute start-0 top-9 bottom-0 w-9 translate-x-1/2 border-s border-s-input rtl:-translate-x-1/2"></div>
      )}
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-input bg-accent/60 text-secondary-foreground">
        <Icon size={16} className="text-base" />
      </div>
      <div className={`ps-2.5 ${!removeSpace ? "mb-7" : ""} grow text-base`}>{children}</div>
    </div>
  );
}
