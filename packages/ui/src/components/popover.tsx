"use client";

import * as React from "react";
import { cn } from "../lib/cn";
import { Popover as PopoverPrimitive } from "radix-ui";

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  label,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  /**
   * Accessible name for the surface. Not part of Metronic's own Popover — kept as an
   * additive convenience: a popover is a dialog-adjacent surface, and a screen reader
   * announcing an unnamed group is no better than silence. This package has no i18n of
   * its own, so pass a translated string rather than relying on a default.
   */
  label?: string;
}) {
  return (
    <PopoverPrimitive.Content
      data-slot="popover-content"
      aria-label={label}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md shadow-black/5 outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
        className,
      )}
      {...props}
    />
  );
}

export { Popover, PopoverContent, PopoverTrigger };
