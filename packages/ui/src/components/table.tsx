"use client";

import * as React from "react";
import { cn } from "../lib/cn";

interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  /**
   * Who draws the border around the table. Not part of Metronic's own Table — kept as an
   * additive convenience: `bordered` (the default, matching Metronic's own bare styling)
   * is for a table that's its own object on the page; `none` is for one already inside a
   * card (`DataTable` puts its filter row, its table and its pager inside a single card,
   * and a second border 1px inside the first reads as a mistake rather than as structure).
   */
  frame?: "bordered" | "none";
}

function Table({ className, frame = "bordered", ...props }: TableProps) {
  return (
    <div
      data-slot="table-wrapper"
      className={cn(
        "relative w-full overflow-auto",
        frame === "bordered" && "rounded-lg border border-border",
      )}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm text-foreground", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead data-slot="table-header" className={cn("[&_tr]:border-b", className)} {...props} />;
}

function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("border-t bg-muted/50 font-medium last:[&>tr]:border-b-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors data-[state=selected]:bg-muted [&:has(td):hover]:bg-muted/50",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-12 px-4 text-left align-middle font-normal text-muted-foreground rtl:text-right [&:has([role=checkbox])]:pe-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      data-slot="table-cell"
      className={cn("p-4 align-middle [&:has([role=checkbox])]:pe-0", className)}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.HTMLAttributes<HTMLTableCaptionElement>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };
