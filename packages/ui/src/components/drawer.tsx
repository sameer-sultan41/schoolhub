"use client";

import * as React from "react";
import { cn } from "../lib/cn";
import { X } from "lucide-react";
import { Drawer as DrawerPrimitive } from "vaul";

/**
 * A bottom-anchored sheet for narrow screens — the mobile counterpart this package's
 * `Dialog` swaps into on a caller's own breakpoint check (see apps/dashboard's
 * `ResponsiveDialog`, which decides when; this component only renders the drawer
 * itself).
 *
 * Ported from the Metronic Next.js template's `components/ui/drawer.tsx` (itself a
 * shadcn/vaul wrapper) rather than designed from scratch (ADR-0009). Departures from
 * that source:
 *
 * 1. `closeLabel` is a required prop and `DrawerContent` renders a visible close
 *    button — the vendor file has neither; this package has no i18n of its own, so a
 *    hardcoded "Close" fallback would always ship untranslated. Matches `Dialog`'s and
 *    `Sheet`'s identical `closeLabel` prop.
 * 2. `DrawerHeader`'s `sm:text-left` is `sm:text-start` — a physical-direction class
 *    would stay left-aligned under `dir="rtl"` instead of following the reading
 *    direction (packages/ui/AGENTS.md's logical-direction rule).
 * 3. `shouldScaleBackground` defaults to `false`, not the vendor's `true` — vaul only
 *    applies that scale effect when the page has a `[data-vaul-drawer-wrapper]`
 *    element, which this app doesn't render; defaulting `true` here would be a no-op
 *    today but a surprising "the whole page just tinted black" the day someone adds one.
 * 4. `DrawerOverlay`'s `bg-black/80` is `bg-black/30` plus a blur, matching `Dialog`'s
 *    and `Sheet`'s identical overlay treatment (a design-consistency choice, not a fix).
 * 5. `DrawerContent`/`DrawerOverlay` take `overlay`/`close` props (default `true`),
 *    mirroring `Dialog`'s and `Sheet`'s identical toggles, and `DrawerContent` caps its
 *    own height (`max-h-[85vh]`) — the vendor version has no height limit at all.
 * 6. New `DrawerBody`, matching `Dialog`'s/`Sheet`'s `*Body` slot for scrollable content
 *    between the header and footer — the vendor file has no equivalent.
 * 7. `DrawerTitle`'s type scale (`text-base font-semibold text-foreground`) matches
 *    `Dialog`'s/`Sheet`'s own title styling instead of the vendor's larger
 *    `text-lg leading-none tracking-tight` — visual consistency across all three.
 */
function Drawer({
  shouldScaleBackground = false,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return (
    <DrawerPrimitive.Root
      data-slot="drawer"
      shouldScaleBackground={shouldScaleBackground}
      {...props}
    />
  );
}

function DrawerTrigger({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerPortal({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerClose({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn("fixed inset-0 z-50 bg-black/30 [backdrop-filter:blur(4px)]", className)}
      {...props}
    />
  );
}

interface DrawerContentProps extends React.ComponentProps<typeof DrawerPrimitive.Content> {
  overlay?: boolean;
  close?: boolean;
  /**
   * Accessible name for the built-in close button (its only content is an icon).
   * Required even when `close` is false — see `Dialog.closeLabel`'s identical
   * reasoning.
   */
  closeLabel: string;
}

function DrawerContent({
  className,
  children,
  overlay = true,
  close = true,
  closeLabel,
  ...props
}: DrawerContentProps) {
  return (
    <DrawerPortal>
      {overlay && <DrawerOverlay />}
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto max-h-[85vh] flex-col rounded-t-[10px] border border-border bg-background",
          className,
        )}
        {...props}
      >
        <div
          aria-hidden="true"
          className="mx-auto mt-4 h-2 w-[100px] shrink-0 rounded-full bg-muted"
        />
        {children}
        {close && (
          <DrawerClose
            className="absolute end-5 top-4 cursor-pointer rounded-sm opacity-60 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none"
            aria-label={closeLabel}
          >
            <X className="size-4" />
          </DrawerClose>
        )}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn("grid gap-1.5 p-4 text-center sm:text-start", className)}
      {...props}
    />
  );
}

function DrawerBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-body"
      className={cn("grow overflow-y-auto px-4 py-2.5", className)}
      {...props}
    />
  );
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

function DrawerTitle({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("text-base font-semibold text-foreground", className)}
      {...props}
    />
  );
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
};
