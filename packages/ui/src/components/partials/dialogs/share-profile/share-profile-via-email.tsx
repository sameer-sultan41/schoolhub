"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ShareProfileViaEmail() {
  const [emailInput, setEmailInput] = useState("");
  return (
    <div className="flex flex-col gap-2.5 px-5">
      <div className="flex-center flex gap-1">
        <h2 className="text-mono text-sm font-semibold">Share via email</h2>
        <Info size={16} className="text-sm text-muted-foreground" />
      </div>

      <div className="flex-center flex gap-2.5">
        <Input
          type="email"
          placeholder="miles.turner@gmail.com"
          value={emailInput}
          onChange={(e) => setEmailInput(e.target.value)}
          className="w-full"
        />

        <Button size="md">Share</Button>
      </div>
    </div>
  );
}
