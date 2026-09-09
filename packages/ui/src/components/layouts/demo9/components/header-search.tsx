"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function HeaderSearch() {
  const handleInputChange = () => {};

  return (
    <div className="hidden items-center md:flex">
      <div className="relative">
        <Search className="absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search"
          onChange={handleInputChange}
          className="min-w-0 px-9"
          value=""
        />
        <span className="absolute end-3.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          cmd + /
        </span>
      </div>
    </div>
  );
}
