"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { type VariantProps, cva } from "class-variance-authority";
import { X } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

/**
 * A Dialog variant, not a separate Radix primitive — same package, different Content
 * styling (edge panel instead of centered card).
 */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

function SheetOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        // bg-overlay, not bg-foreground: a scrim's job is to dim the page behind it in
        // EITHER colour scheme — --sh-color-overlay is fixed, unlike --sh-color-foreground,
        // which flips to near-white in dark mode and would wash the page instead.
        "fixed inset-0 z-50 bg-overlay/50",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

/**
 * `start`/`end`, not `left`/`right`: this drawer must open from the correct SCREEN edge in
 * both `en` (LTR) and `ur` (RTL) — `start` is the leading edge in whichever direction is
 * current, which `inset-inline-start`/`-end` (Tailwind's `start-0`/`end-0`) resolve
 * natively. tw-animate-css's slide-in utilities are physical-direction-only, so the
 * `rtl:`/`ltr:` variant picks the correct one for the resting side chosen; the resting
 * POSITION itself is what actually matters and is always logical.
 */
const sheetVariants = cva(
  "fixed z-50 flex flex-col gap-4 border-border bg-surface p-6 text-surface-foreground shadow-lg data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:animate-in data-[state=open]:duration-500",
  {
    variants: {
      side: {
        start:
          "inset-y-0 start-0 h-full w-3/4 border-e sm:max-w-sm ltr:data-[state=closed]:slide-out-to-left ltr:data-[state=open]:slide-in-from-left rtl:data-[state=closed]:slide-out-to-right rtl:data-[state=open]:slide-in-from-right",
        end: "inset-y-0 end-0 h-full w-3/4 border-s sm:max-w-sm ltr:data-[state=closed]:slide-out-to-right ltr:data-[state=open]:slide-in-from-right rtl:data-[state=closed]:slide-out-to-left rtl:data-[state=open]:slide-in-from-left",
        top: "inset-x-0 top-0 h-auto border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 h-auto border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
      },
    },
    defaultVariants: { side: "end" },
  },
);

export function SheetContent({
  className,
  children,
  side = "end",
  closeLabel,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> &
  VariantProps<typeof sheetVariants> & {
    /**
     * Accessible name for the built-in close button (its only content is an icon).
     * Required, not defaulted to "Close" — this package has no i18n of its own, so a
     * silent default here would always ship untranslated (the same reasoning already
     * applied to DataTable's emptyState/pagination labels and Dialog's closeLabel).
     */
    closeLabel: string;
  }) {
  return (
    <DialogPrimitive.Portal>
      <SheetOverlay />
      <DialogPrimitive.Content className={cn(sheetVariants({ side }), className)} {...props}>
        {children}
        <DialogPrimitive.Close className="absolute end-4 top-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none">
          <X className="size-4" />
          <span className="sr-only">{closeLabel}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

export function SheetFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mt-auto flex flex-col gap-2", className)} {...props} />;
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("font-heading text-lg font-semibold text-foreground", className)}
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}
