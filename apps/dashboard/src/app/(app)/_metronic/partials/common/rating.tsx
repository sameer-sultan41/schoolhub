"use client";

import { Star } from "lucide-react";

import { cn } from "@schoolhub/ui";

// Adapted from packages/ui's partials/common/rating.tsx: the vendor version
// renders Metronic's own "Keenicons" icon font (ki-solid/ki-outline star
// glyphs), which this preview deliberately doesn't vendor. Swapped for
// lucide-react's Star, filled vs. outline, to keep the same visual meaning.
interface RatingProps {
  className?: string;
  rating: number;
}

export function Rating({ className, rating }: RatingProps) {
  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          className={cn(
            "size-4",
            index < rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/40",
          )}
        />
      ))}
    </div>
  );
}
