"use client";

import { toAbsoluteUrl } from "@/lib/helpers";

export function ScreenLoader() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 transition-opacity duration-700 ease-in-out">
      <img
        className="h-[30px] max-w-none"
        src={toAbsoluteUrl("/media/app/mini-logo.svg")}
        alt="logo"
      />
      <div className="text-sm font-medium text-muted-foreground">Loading...</div>
    </div>
  );
}
