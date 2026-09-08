"use client";

import { Check } from "lucide-react";

export default function Item14() {
  return (
    <div className="flex grow items-center gap-2.5 px-5">
      <div className="bg-green-500-soft border-success-transparent flex size-8 items-center justify-center rounded-full border">
        <Check className="text-lg text-green-500" />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-secondary-foreground">
          You have succesfully verified your account
        </span>
        <span className="text-xs font-medium text-muted-foreground">2 days ago</span>
      </div>
    </div>
  );
}
