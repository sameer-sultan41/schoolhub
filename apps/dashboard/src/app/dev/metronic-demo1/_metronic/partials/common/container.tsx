"use client";

import { type ReactNode } from "react";

import { cn } from "@schoolhub/ui";

import { useSettings } from "../../settings-provider";

// Ported from packages/ui's partials/common/container.tsx. cva's two-option
// variant was inlined as a plain conditional to avoid a new
// class-variance-authority dependency in apps/dashboard for one variant.
export interface ContainerProps {
  children?: ReactNode;
  width?: "fixed" | "fluid";
  className?: string;
}

export function Container({ children, width, className = "" }: ContainerProps) {
  const { settings } = useSettings();
  const effectiveWidth = width ?? settings.container;

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
