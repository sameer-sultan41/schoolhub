"use client";

import type { CSSProperties } from "react";
import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

/**
 * `theme="system"` is sonner's own built-in OS-preference listener — no next-themes
 * dependency needed. There is no in-app theme TOGGLE yet (only the `prefers-color-scheme`
 * media query + a `.dark` class variant reserved for one, per theme.css), so "system" is
 * also the only theme value that could be correct right now; revisit this the moment a
 * toggle exists.
 */
export function Toaster({ theme = "system", ...props }: ToasterProps) {
  return (
    <SonnerToaster
      theme={theme}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--color-popover)",
          "--normal-text": "var(--color-popover-foreground)",
          "--normal-border": "var(--color-border)",
          "--border-radius": "var(--radius)",
        } as CSSProperties
      }
      {...props}
    />
  );
}
