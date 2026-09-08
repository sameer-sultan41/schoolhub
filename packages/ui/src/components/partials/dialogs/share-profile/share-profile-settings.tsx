"use client";

import Link from "next/link";
import { LoaderPinwheel, User } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ShareProfileSettings() {
  return (
    <div className="flex flex-col gap-4 px-5">
      <h2 className="text-mono text-sm font-semibold">Settings</h2>

      <div className="flex-center flex flex-wrap justify-between gap-2">
        <div className="flex-center flex gap-1.5">
          <User size={16} className="text-muted-foreground" />

          <div className="flex-center flex text-xs font-medium text-secondary-foreground">
            Anyone at
            <Link href="#" className="link mx-1 text-xs font-medium">
              KeenThemes
            </Link>
            can view
          </div>
        </div>

        <Button mode="link" underlined="dashed">
          <Link href="#">Change Access</Link>
        </Button>
      </div>

      <div className="flex-center mb-1 flex flex-wrap justify-between gap-2">
        <div className="flex-center flex gap-1.5">
          <LoaderPinwheel size={16} className="text-muted-foreground" />

          <div className="flex-center flex text-xs font-medium text-secondary-foreground">
            Anyone with link can edit
          </div>
        </div>

        <Button mode="link" underlined="dashed">
          <Link href="#">Set Password</Link>
        </Button>
      </div>

      <Button variant="primary" className="mx-auto w-full max-w-full">
        Done
      </Button>
    </div>
  );
}
