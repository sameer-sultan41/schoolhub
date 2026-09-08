"use client";

import { LoaderCircleIcon } from "lucide-react";

export function ContentLoader() {
  return (
    <div className="relative top-1/2 flex -translate-x-1/2 flex-col items-center justify-center self-center">
      <div className="flex items-center gap-2.5">
        <LoaderCircleIcon className="animate-spin text-muted-foreground opacity-50" />
        <span className="text-sm font-medium text-muted-foreground">Loading...</span>
      </div>
    </div>
  );
}
