"use client";

import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@schoolhub/ui";
import { useTranslations } from "next-intl";

import { useIsDesktopShell } from "@/hooks/use-is-desktop-shell";

/**
 * A plain confirm — Radix `AlertDialog` on desktop, a vaul `Drawer` on mobile — shared by
 * any caller that needs only a title/description/confirm button, no form fields.
 *
 * Extracted now rather than copy-pasted a third time: `exit-staff-dialog.tsx` and
 * `student-documents-tab.tsx`'s delete confirmation both have their own one-off version
 * of this split, both keyed on `useIsMobile()` (768px) instead of this app's real
 * breakpoint convention, `useIsDesktopShell()` (1024px) — `withdraw-student-dialog.tsx`
 * already uses the correct one. Migrating those two existing copies onto this component
 * would also fix their 768–1023px bug, but that's a separate, pre-existing issue outside
 * this phase's own goal — deferred to its own follow-up `fix` PR (see `deferred-work.md`).
 *
 * Desktop uses `AlertDialogAction`'s own `preventDefault` + manual `onConfirm` call to
 * avoid Radix auto-closing the dialog before an async mutation resolves — same pattern as
 * `withdraw-student-dialog.tsx`.
 */
export interface ResponsiveAlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  isPending: boolean;
  /** A server error to show inline, without closing the dialog — e.g. a 422
   * segregation-of-duties rejection on a transfer decision. */
  error?: string;
  /** `AlertDialogAction`'s own variant — e.g. `"destructive"` for a reject decision.
   * Omitted entirely for the default styling, never `"default"` (not a real value either
   * primitive accepts). */
  variant?: "destructive";
}

export function ResponsiveAlertDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  isPending,
  error,
  variant,
}: ResponsiveAlertDialogProps) {
  const isDesktop = useIsDesktopShell();
  const tCommon = useTranslations("common");

  const errorAlert = error ? (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null;

  if (isDesktop) {
    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          {errorAlert}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant={variant}
              disabled={isPending}
              onClick={(event) => {
                event.preventDefault();
                onConfirm();
              }}
            >
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} dismissible={false}>
      <DrawerContent role="alertdialog" closeLabel={tCommon("close")}>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        {errorAlert}
        <DrawerFooter>
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {tCommon("cancel")}
          </Button>
          <Button variant={variant} disabled={isPending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
