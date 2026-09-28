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
  useIsMobile,
} from "@schoolhub/ui";

/**
 * A `Dialog` on desktop, a bottom `Drawer` on mobile — the two are different Radix/vaul
 * primitives under the hood (see the plan this shipped from: no single component swaps
 * between them), so this picks one per render and shares that choice with its own
 * subcomponents via context, rather than each subcomponent re-deciding independently.
 *
 * `useIsMobile()` (768px) is safe here in a way it wasn't for the app shell
 * (`use-is-desktop-shell.ts`): a dialog only mounts after a user opens it, well after
 * hydration has settled, so there's no first-paint window for its default-`false` value
 * to be visibly wrong in.
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

export function ResponsiveDialog({ children, ...props }: React.ComponentProps<typeof Dialog>) {
  const isMobile = useIsMobile();
  const Root = isMobile ? Drawer : Dialog;
  return (
    <ResponsiveDialogContext.Provider value={isMobile}>
      <Root {...props}>{children}</Root>
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

export function ResponsiveDialogFooter({ children }: { children: ReactNode }) {
  const Footer = useIsDrawer() ? DrawerFooter : DialogFooter;
  return <Footer>{children}</Footer>;
}

/**
 * A `Sheet` (side panel) on desktop, a bottom `Drawer` on mobile — same idea as
 * `ResponsiveDialog` above, for the one screen (`StaffDetailSheet`) that opens from a
 * row click rather than a toolbar button and stays a side panel on desktop, unlike the
 * two dialogs `ResponsiveDialog` covers.
 */
export function ResponsiveSheet({ children, ...props }: React.ComponentProps<typeof Sheet>) {
  const isMobile = useIsMobile();
  const Root = isMobile ? Drawer : Sheet;
  return (
    <ResponsiveDialogContext.Provider value={isMobile}>
      <Root {...props}>{children}</Root>
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
