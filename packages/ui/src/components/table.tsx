import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

export interface TableProps extends ComponentProps<"table"> {
  /**
   * Who draws the border around the table.
   *
   * `bordered` (the default) is the standalone case: the table is its own object on the
   * page, so it carries its own frame. `none` is for a table already inside one —
   * `DataTable` puts its filter row, its table and its pager inside a single card, and a
   * second border 1px inside the first reads as a mistake rather than as structure.
   */
  frame?: "bordered" | "none";
}

export function Table({ className, frame = "bordered", ...props }: TableProps) {
  return (
    <div
      className={cn(
        "relative w-full overflow-x-auto",
        frame === "bordered" && "rounded-[var(--sh-radius)] border border-border",
      )}
    >
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("bg-muted text-muted-foreground", className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={className} {...props} />;
}

export function TableFooter({ className, ...props }: ComponentProps<"tfoot">) {
  return (
    <tfoot className={cn("border-t border-border bg-muted/50 font-medium", className)} {...props} />
  );
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "border-t border-border first:border-t-0 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn("px-4 py-3 text-start font-medium whitespace-nowrap", className)}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-4 py-3", className)} {...props} />;
}

export function TableCaption({ className, ...props }: ComponentProps<"caption">) {
  return <caption className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />;
}
