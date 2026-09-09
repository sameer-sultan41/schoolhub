"use client";

import { type ReactNode } from "react";

import { cn } from "@schoolhub/ui";

import { usePreference } from "@/lib/preferences/preferences-provider";

// Ported from packages/ui's partials/common/container.tsx. cva's two-option
// variant was inlined as a plain conditional to avoid a new
// class-variance-authority dependency in apps/dashboard for one variant.
//
// Reads the real, viewer-set "content width" preference (components/layout-controls.tsx)
// rather than Metronic's own _metronic/settings.ts `container` field — that field had
// exactly one reader (this component), so the choice now goes through the same
// preferences system every other layout control uses instead of a second, parallel one.
export interface ContainerProps {
  children?: ReactNode;
  width?: "fixed" | "fluid";
  className?: string;
}

export function Container({ children, width, className = "" }: ContainerProps) {
  const contentLayout = usePreference("content_layout");
  const effectiveWidth = width ?? (contentLayout === "centered" ? "fixed" : "fluid");

  return (
    <div
      data-slot="container"
      className={cn(
        "mx-auto w-full px-4 lg:px-6",
        effectiveWidth === "fixed" && "max-w-[1320px]",
        className,
      )}
    >
      {children}
    </div>
  );
}
