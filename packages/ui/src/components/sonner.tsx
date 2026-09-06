"use client";

import type { CSSProperties } from "react";
import { Toaster as SonnerToaster, type ToasterProps } from "sonner";
import { cn } from "../lib/cn";

export interface SchoolHubToasterProps extends Omit<ToasterProps, "theme"> {
  /**
   * Required, and deliberately not defaulted to sonner's own `"system"`.
   *
   * That default was correct while the OS preference was the only mechanism in the repo.
   * apps/dashboard now ships a toggle, and a toaster still listening to the OS would put
   * one dark panel over a light app for anyone who chose light on a dark-mode machine.
   * packages/ui has no theme context of its own — it cannot depend on next-themes,
   * because apps/website mounts no provider — so the host app has to say. Same reasoning
   * as `Dialog.closeLabel` and `Button.loadingLabel`: a silent default in this package is
   * always a default that ignores the app.
   *
   * Pass `"system"` explicitly where that genuinely is the answer.
   */
  theme: "light" | "dark" | "system";
}

export function Toaster({ theme, className, style, ...props }: SchoolHubToasterProps) {
  return (
    <SonnerToaster
      theme={theme}
      className={cn("toaster group", className)}
      style={
        {
          "--normal-bg": "var(--color-popover)",
          "--normal-text": "var(--color-popover-foreground)",
          "--normal-border": "var(--color-border)",
          "--border-radius": "var(--radius)",
          ...style,
        } as CSSProperties
      }
      {...props}
    />
  );
}
