"use client";

import { Star } from "lucide-react";

import { cn } from "../lib/cn";

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
