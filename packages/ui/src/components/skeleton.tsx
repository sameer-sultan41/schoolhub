import * as React from "react";
import { cn } from "../lib/cn";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // Not part of Metronic's own Skeleton — kept as a default rather than an opt-in
      // prop, since every skeleton is inherently decorative: the meaningful state is
      // whatever `aria-busy`/`role="status"` the consumer puts on the region it sits
      // inside, and a skeleton describing itself to a screen reader is noise, not
      // information. Placed before `...props` so an explicit caller override still wins.
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-accent", className)}
      {...props}
    />
  );
}

export { Skeleton };
