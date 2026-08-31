import { type VariantProps, cva } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

const alertVariants = cva("w-full space-y-1 rounded-[var(--sh-radius)] border px-4 py-3 text-sm", {
  variants: {
    variant: {
      default: "border-border bg-surface text-surface-foreground",
      danger: "border-danger/40 bg-danger/10 text-danger",
      success: "border-success/40 bg-success/10 text-success",
      warning: "border-warning/50 bg-warning/15 text-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface AlertProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

/**
 * `role="alert"` only for `variant="danger"` — an assertive live-region announcement is
 * right for "your request failed", wrong for a quiet default/success/warning callout that
 * would otherwise interrupt whatever the screen reader is already reading. A caller that
 * genuinely needs a different role (e.g. `role="status"`) can still pass one through
 * `...props`, which lands after this default and wins.
 */
export function Alert({ className, variant, ...props }: AlertProps) {
  return (
    <div
      role={variant === "danger" ? "alert" : undefined}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("font-medium tracking-tight", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-sm [&_p]:leading-relaxed", className)} {...props} />;
}

export { alertVariants };
