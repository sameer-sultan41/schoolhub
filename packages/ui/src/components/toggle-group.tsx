"use client";

/**
 * shadcn/ui ToggleGroup (registry new-york-v4), ported per AGENTS.md §0c.
 *
 * Upstream splits the cva out into a standalone Toggle component and re-uses it here.
 * This repo has no Toggle and no caller for one, so the variants live in this file:
 * port what is used, not the whole registry.
 *
 * Rounding and the border overlap are logical — `first:rounded-s-*` / `last:rounded-e-*`
 * and `-ms-px` — never `rounded-l/r` or `-ml-px`, so a segmented control mirrors
 * correctly under Urdu.
 */

import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

const toggleGroupItemVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-1 whitespace-nowrap border border-border",
    "text-sm font-medium transition-colors",
    "first:rounded-s-[var(--sh-radius)] last:rounded-e-[var(--sh-radius)]",
    // Collapse the shared edge between neighbours so the group reads as one control
    // rather than a row of separate buttons.
    "-ms-px first:ms-0",
    "hover:bg-muted",
    "focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    "focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground",
    "disabled:pointer-events-none disabled:opacity-50",
  ),
  {
    variants: {
      size: { sm: "h-8 px-2.5 text-xs", md: "h-9 px-3" },
    },
    defaultVariants: { size: "md" },
  },
);

export type ToggleGroupProps = ComponentProps<typeof ToggleGroupPrimitive.Root>;

export function ToggleGroup({ className, ...props }: ToggleGroupProps) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn("flex items-stretch", className)}
      {...props}
    />
  );
}

export type ToggleGroupItemProps = ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleGroupItemVariants>;

export function ToggleGroupItem({ className, size, ...props }: ToggleGroupItemProps) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(toggleGroupItemVariants({ size }), className)}
      {...props}
    />
  );
}
