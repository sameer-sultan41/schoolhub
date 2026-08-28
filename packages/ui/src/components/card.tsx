import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--sh-radius)] border border-border bg-surface text-surface-foreground shadow-sm",
        className,
      )}
      {...props}
    />
  );
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

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("font-heading text-base leading-none font-semibold", className)}
      {...props}
    />
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
