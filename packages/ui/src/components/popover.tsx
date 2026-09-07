"use client";

/**
 * shadcn/ui Popover (registry new-york-v4), ported per AGENTS.md §0c.
 *
 * Two adaptations from the upstream source:
 *  1. `label` is required. Upstream renders an unnamed container; a popover is a
 *     dialog-adjacent surface, and a screen reader announcing an unnamed group is no
 *     better than silence. This package has no i18n, so the name has to be a prop.
 *  2. `align` keeps Radix's own start/center/end vocabulary — already logical, so it
 *     mirrors under [dir="rtl"] with nothing to change. `side` is deliberately not
 *     surfaced: every caller in this repo anchors below its trigger, and a physical
 *     "left"/"right" would be the one direction prop that does not mirror.
 */

import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export interface PopoverContentProps extends Omit<
  ComponentProps<typeof PopoverPrimitive.Content>,
  "side"
> {
  /** Accessible name for the surface. Required — see the file header. */
  label: string;
}

export function PopoverContent({
  className,
  label,
  align = "end",
  sideOffset = 8,
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        aria-label={label}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-[var(--sh-radius)] border border-border bg-surface-raised p-4",
          "text-surface-foreground shadow-elevation-2 outline-none",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
