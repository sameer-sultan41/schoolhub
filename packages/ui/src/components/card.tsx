import { type VariantProps, cva } from "class-variance-authority";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * Colours and depth come from theme tokens only. Tailwind's own `shadow-sm`/`shadow-md`
 * are deliberately unused: that scale is neutral black at a fixed opacity, and a grey
 * shadow under a blue-tinted surface reads as two materials rather than one — the
 * commonest tell of an unmodified component kit. `--sh-elevation-*` carries the brand hue
 * in light mode and falls back to depth-of-black in dark, where a tinted shadow is
 * invisible anyway.
 */
const cardVariants = cva("rounded-[var(--sh-radius)] border text-surface-foreground", {
  variants: {
    elevation: {
      /**
       * Sits ON the page — the default, and what every existing card gets. Visually
       * the same weight as the `shadow-sm` this replaces, so nothing already built
       * changes; the difference is that the shadow now carries the brand hue instead
       * of neutral black.
       */
      flat: "border-border bg-surface shadow-elevation-1",
      /** Sits ABOVE the page — a stat tile, a panel that should read as its own object. */
      raised: "border-border bg-surface-raised shadow-elevation-2",
      /** Floats — a popover, a dragged item, a card that has been picked up. */
      floating: "border-transparent bg-surface-raised shadow-elevation-3",
    },
    tone: {
      surface: "",
      /**
       * The one gradient in the system. Allowed ONCE PER SCREEN, on that screen's hero
       * element, and never as decoration — see theme.css's `--sh-gradient-spotlight`.
       */
      spotlight: "border-transparent bg-spotlight text-primary-foreground",
    },
  },
  defaultVariants: { elevation: "flat", tone: "surface" },
});

export type CardProps = HTMLAttributes<HTMLDivElement> & VariantProps<typeof cardVariants>;

export function Card({ className, elevation, tone, ...props }: CardProps) {
  return <div className={cn(cardVariants({ elevation, tone }), className)} {...props} />;
}

export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /** Rendered on the trailing side of the header — actions, badges, menus. */
  actions?: ReactNode;
}

export function CardHeader({ className, children, actions, ...props }: CardHeaderProps) {
  return (
    <div
      className={cn("flex items-start justify-between gap-4 px-6 pt-6 pb-4", className)}
      {...props}
    >
      <div className="space-y-1">{children}</div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}

export function CardTitle({ className, children, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn("font-heading text-base leading-none font-semibold", className)} {...props}>
      {children}
    </h3>
  );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 pb-6", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center gap-2 border-t border-border px-6 py-4", className)}
      {...props}
    />
  );
}
