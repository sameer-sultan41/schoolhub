"use client";

import * as React from "react";
import { createContext, useContext } from "react";
import { cn } from "../lib/cn";
import { X } from "lucide-react";
import { Drawer as DrawerPrimitive } from "vaul";
import { Button } from "./button";

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
 * 2. `DrawerHeader` is always `text-start` (logical, not the vendor's physical
 *    `text-left`/`packages/ui/AGENTS.md`'s rule) and never centered — the vendor's
 *    `text-center sm:text-left` assumes a Dialog-like consumer that's sometimes
 *    still narrow above `sm` (640px); a Drawer only ever renders below this app's
 *    768px mobile breakpoint, so "centered below sm" was, in practice, "always
 *    centered" — reading worse, not better, on the one width this ever renders at.
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
 *    between the header and footer — the vendor file has no equivalent. It also
 *    carries `min-h-0`, which neither `Dialog`'s nor `Sheet`'s own `*Body` needs
 *    (they don't cap their own container's height the way `DrawerContent` does).
 * 7. `DrawerTitle`'s type scale (`text-base font-semibold text-foreground`) matches
 *    `Dialog`'s/`Sheet`'s own title styling instead of the vendor's larger
 *    `text-lg leading-none tracking-tight` — visual consistency across all three.
 * 8. `DrawerContent`'s built-in close button no longer uses `Drawer.Close` — vaul
 *    ignores every `Drawer.Close`-driven close (confirmed against vaul's own source)
 *    whenever a consumer sets `dismissible={false}` (e.g. a destructive confirmation
 *    that shouldn't be swiped away by accident), which would otherwise make this
 *    built-in button silently do nothing. `Drawer` now captures the caller's own
 *    `onOpenChange` in a small context, and `DrawerContent` calls that directly,
 *    bypassing vaul's `dismissible` gate the same way vaul's own docs recommend
 *    ("controlled close via application state").
 * 9. The visible drag-handle bar is `DrawerPrimitive.Handle`, not a plain
 *    `aria-hidden` div — a consumer that sets `handleOnly` (dragging only starts
 *    from the handle) needs an element vaul actually registers as the drag
 *    surface; a lookalike div renders the same pill but is inert under
 *    `handleOnly`, so the drawer becomes entirely impossible to drag behind an
 *    affordance that still visually promises otherwise.
 */
const DrawerCloseHandlerContext = createContext<(() => void) | null>(null);

function Drawer({
  shouldScaleBackground = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return (
    <DrawerCloseHandlerContext.Provider value={() => onOpenChange?.(false)}>
      <DrawerPrimitive.Root
        data-slot="drawer"
        shouldScaleBackground={shouldScaleBackground}
        onOpenChange={onOpenChange}
        {...props}
      />
    </DrawerCloseHandlerContext.Provider>
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
  const closeHandler = useContext(DrawerCloseHandlerContext);
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
        <DrawerPrimitive.Handle className="mx-auto mt-4 h-2 w-[100px] shrink-0 rounded-full bg-muted" />
        {children}
        {close && (
          <Button
            type="button"
            variant="ghost"
            mode="icon"
            data-slot="drawer-close"
            className="absolute end-5 top-4 size-auto rounded-sm p-0.5 opacity-60 hover:bg-transparent hover:opacity-100"
            aria-label={closeLabel}
            onClick={() => {
              closeHandler?.();
            }}
          >
            <X className="size-4" />
          </Button>
        )}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn("grid gap-1 p-4 text-start", className)}
      {...props}
    />
  );
}

function DrawerBody({ className, ...props }: React.ComponentProps<"div">) {
  // min-h-0: without it, a flex child's default `min-height: auto` lets it grow past
  // the space DrawerContent's flex-col actually has for it instead of shrinking to
  // fit and scrolling internally — the same class of bug min-w-0 fixes on the
  // horizontal axis (see CardTable in packages/ui/src/components/card.tsx). The
  // visible symptom was content past the fold simply being clipped by
  // DrawerContent's own max-h-[85vh], with nothing to scroll.
  return (
    <div
      data-slot="drawer-body"
      className={cn("min-h-0 grow overflow-y-auto px-4 py-2.5", className)}
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
