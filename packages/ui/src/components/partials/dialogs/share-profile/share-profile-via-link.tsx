"use client";

import { useState } from "react";
import { Copy, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ShareProfileViaLink() {
  const [linkInput, setLinkInput] = useState("");
  return (
    <div className="flex flex-col gap-2.5 px-5">
      <div className="flex-center flex gap-1">
        <h2 className="text-mono text-sm font-semibold">Share read-only link</h2>
        <Info size={16} className="text-sm text-muted-foreground" />
      </div>

      <div className="relative w-full">
        <Input
          className="pe-10"
          type="text"
          value={linkInput}
          onChange={(e) => setLinkInput(e.target.value)}
          placeholder="https://metronic.com/profiles/x7g2vA3kZ5"
        />
        <Button
          variant="ghost"
          mode="icon"
          className="absolute end-0 top-2/4 me-1.5 -translate-y-2/4"
        >
          <Copy size={12} />
        </Button>
      </div>
    </div>
  );
}
