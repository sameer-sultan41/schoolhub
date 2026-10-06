"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetTitle,
} from "@schoolhub/ui";

import { useIsDesktopShell } from "@/hooks/use-is-desktop-shell";

/**
 * A `Dialog` on desktop, a bottom `Drawer` on mobile — the two are different Radix/vaul
 * primitives under the hood (see the plan this shipped from: no single component swaps
 * between them), so this picks one per render and shares that choice with its own
 * subcomponents via context, rather than each subcomponent re-deciding independently.
 *
 * Drawer-vs-Dialog/Sheet is decided by `useIsDesktopShell()` (1024px), not
 * `@schoolhub/ui`'s own `useIsMobile()` (768px) — the shell itself (`Shell`/`Header`)
 * already switches to mobile-style chrome (hamburger menu, no docked sidebar) at 1024px
 * (`use-is-desktop-shell.ts`'s own comment on why), so a dialog choosing its primitive
 * off the narrower 768px breakpoint would render a centered desktop Dialog at a width
 * where everything else on screen is already presenting as mobile.
 *
 * Reading a live breakpoint value here (rather than deciding once at mount) is safe in a
 * way it wasn't for the app shell: every caller renders this with `open` starting
 * `false` — none opens on initial load from a URL param or similar — so the value has no
 * visible effect until a user actually opens one, by which point React has long since
 * settled on the real value. A future caller that can start open would need to re-check
 * this reasoning, the same way `use-is-desktop-shell.ts` had to for the shell.
 */
const ResponsiveDialogContext = createContext<boolean | null>(null);

/** Whether the current `ResponsiveDialog`/`ResponsiveSheet` rendered as a `Drawer` —
 * exported for a caller that needs to adjust its own content for the mobile drawer
 * (e.g. `StaffDetailSheet`'s footer going icon-only there), not just the chrome
 * around it that this file's other components already handle. */
export function useIsDrawer(): boolean {
  const isMobile = useContext(ResponsiveDialogContext);
  if (isMobile === null) {
    throw new Error("Responsive dialog subcomponents must be rendered inside <ResponsiveDialog>.");
  }
  return isMobile;
}

interface ResponsiveRootProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  /** True when this dialog opens from inside another already-open
   * ResponsiveDialog/ResponsiveSheet's mobile Drawer (e.g. a row action opened from
   * within the tabbed student detail sheet). On mobile, nests via vaul's
   * `Drawer.NestedRoot` instead of a second independent `Drawer.Root`, which vaul
   * doesn't support stacking without. No effect on desktop, which always renders an
   * independent `Dialog` regardless of nesting. */
  nested?: boolean;
}

export function ResponsiveDialog({
  open,
  onOpenChange,
  children,
  nested = false,
}: ResponsiveRootProps) {
  const isMobile = !useIsDesktopShell();
  return (
    <ResponsiveDialogContext.Provider value={isMobile}>
      {isMobile ? (
        // handleOnly: this family's one caller (Add Member) is a form — without it, a
        // user scrolled to the top who swipes down to see the top edge closes the
        // drawer and wipes every field (vaul's own drag-anywhere default only checks
        // the scroll container's scrollTop, not "is this a form with unsaved input").
        // dismissible={false}: handleOnly only blocks a content-area drag from
        // starting the close gesture — vaul's default dismissible={true} still lets
        // a backdrop tap or Escape close instantly, the exact same data loss through
        // a different door. Hardcoded here rather than a prop: revisit if a non-form
        // caller needs the full dismiss-anywhere behavior back.
        <Drawer
          open={open}
          onOpenChange={onOpenChange}
          nested={nested}
          handleOnly
          dismissible={false}
        >
          {children}
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          {children}
        </Dialog>
      )}
    </ResponsiveDialogContext.Provider>
  );
}

export function ResponsiveDialogContent({
  className,
  children,
  closeLabel,
}: {
  /** Applied to `DialogContent` only — a desktop centered dialog's width/position
   * overrides (e.g. `max-w-2xl`) have no equivalent meaning on a full-bleed bottom
   * `Drawer`, and would otherwise leak onto it (Tailwind classes don't know which
   * branch rendered them). Style the body's own content via `ResponsiveDialogBody`'s
   * `className` instead — that one is shared on purpose. */
  className?: string;
  children: ReactNode;
  closeLabel: string;
}) {
  return useIsDrawer() ? (
    <DrawerContent closeLabel={closeLabel}>{children}</DrawerContent>
  ) : (
    <DialogContent className={className} closeLabel={closeLabel}>
      {children}
    </DialogContent>
  );
}

export function ResponsiveDialogHeader({ children }: { children: ReactNode }) {
  const Header = useIsDrawer() ? DrawerHeader : DialogHeader;
  return <Header>{children}</Header>;
}

export function ResponsiveDialogTitle({ children }: { children: ReactNode }) {
  const Title = useIsDrawer() ? DrawerTitle : DialogTitle;
  return <Title>{children}</Title>;
}

export function ResponsiveDialogBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const Body = useIsDrawer() ? DrawerBody : DialogBody;
  return <Body className={className}>{children}</Body>;
}

export function ResponsiveDialogFooter({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const Footer = useIsDrawer() ? DrawerFooter : DialogFooter;
  return <Footer className={className}>{children}</Footer>;
}

/**
 * A `Sheet` (side panel) on desktop, a bottom `Drawer` on mobile — same idea as
 * `ResponsiveDialog` above, for the one screen (`StaffDetailSheet`) that opens from a
 * row click rather than a toolbar button and stays a side panel on desktop, unlike the
 * two dialogs `ResponsiveDialog` covers.
 */
export function ResponsiveSheet({ open, onOpenChange, children }: ResponsiveRootProps) {
  const isMobile = !useIsDesktopShell();
  return (
    <ResponsiveDialogContext.Provider value={isMobile}>
      {isMobile ? (
        <Drawer open={open} onOpenChange={onOpenChange}>
          {children}
        </Drawer>
      ) : (
        <Sheet open={open} onOpenChange={onOpenChange}>
          {children}
        </Sheet>
      )}
    </ResponsiveDialogContext.Provider>
  );
}

export function ResponsiveSheetContent({
  className,
  children,
  closeLabel,
}: {
  /** Applied to `SheetContent` only — see `ResponsiveDialogContent`'s identical note;
   * a side panel's width overrides don't carry over to a full-bleed bottom `Drawer`. */
  className?: string;
  children: ReactNode;
  closeLabel: string;
}) {
  return useIsDrawer() ? (
    <DrawerContent closeLabel={closeLabel}>{children}</DrawerContent>
  ) : (
    <SheetContent className={className} closeLabel={closeLabel}>
      {children}
    </SheetContent>
  );
}

export function ResponsiveSheetTitle({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const Title = useIsDrawer() ? DrawerTitle : SheetTitle;
  return <Title className={className}>{children}</Title>;
}

export function ResponsiveSheetBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const Body = useIsDrawer() ? DrawerBody : SheetBody;
  return <Body className={className}>{children}</Body>;
}

export function ResponsiveSheetFooter({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const Footer = useIsDrawer() ? DrawerFooter : SheetFooter;
  return <Footer className={className}>{children}</Footer>;
}
