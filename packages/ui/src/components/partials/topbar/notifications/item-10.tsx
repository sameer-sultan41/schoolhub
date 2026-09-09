"use client";

import Link from "next/link";
import { AvatarGroup } from "@/partials/common/avatar-group";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarIndicator,
  AvatarStatus,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function Item10() {
  return (
    <div className="flex grow gap-2 px-5">
      <Avatar>
        <AvatarImage src="/media/avatars/300-15.png" alt="avatar" />
        <AvatarFallback>CH</AvatarFallback>
        <AvatarIndicator className="-end-1.5 -bottom-1.5">
          <AvatarStatus variant="online" className="size-2.5" />
        </AvatarIndicator>
      </Avatar>

      <div className="flex grow flex-col gap-3">
        <div className="flex flex-col gap-1">
          <div className="mb-px text-sm font-medium">
            <Link href="#" className="text-mono font-semibold hover:text-primary">
              Nova Hawthorne
            </Link>
            <span className="text-secondary-foreground"> sent you an meeting invation </span>
          </div>
          <span className="flex items-center text-xs font-medium text-muted-foreground">
            2 days ago
            <span className="bg-mono/30 mx-1.5 size-1 rounded-full"></span>
            Dev Team
          </span>
        </div>

        <Card className="rounded-lg bg-muted/70 p-2.5 shadow-none">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5">
              <div className="border-warning-transparent rounded-lg border">
                <div className="border-b-warning-transparent flex items-center justify-center rounded-t-lg border-b bg-yellow-400/10">
                  <span className="fw-medium p-1.5 text-xs text-yellow-400">Apr</span>
                </div>
                <div className="flex size-9 items-center justify-center">
                  <span className="fw-semibold text-mono text-md tracking-tight">12</span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Link
                  href="#"
                  className="text-xs font-medium text-secondary-foreground hover:text-primary"
                >
                  Peparation For Release
                </Link>
                <span className="text-xs font-medium text-secondary-foreground">
                  9:00 PM - 10:00 PM
                </span>
              </div>
            </div>

            <AvatarGroup
              size="size-6"
              group={[
                { path: "/media/avatars/300-1.png" },
                { path: "/media/avatars/300-2.png" },
                { path: "/media/avatars/300-3.png" },
                {
                  fallback: "+3",
                  variant: "text-white size-6 ring-background bg-green-500",
                },
              ]}
            />
          </div>
        </Card>

        <div className="flex flex-wrap gap-2.5">
          <Button size="sm" variant="outline">
            Decline
          </Button>
          <Button size="sm" variant="mono">
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
