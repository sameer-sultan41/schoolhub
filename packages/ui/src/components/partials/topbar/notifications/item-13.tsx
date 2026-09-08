"use client";

import Link from "next/link";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarIndicator,
  AvatarStatus,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function Item13() {
  return (
    <div className="flex grow gap-2.5 px-5">
      <Avatar>
        <AvatarImage src="/media/avatars/300-25.png" alt="avatar" />
        <AvatarFallback>CH</AvatarFallback>
        <AvatarIndicator className="-end-1.5 -bottom-1.5">
          <AvatarStatus variant="online" className="size-2.5" />
        </AvatarIndicator>
      </Avatar>

      <div className="flex grow flex-col gap-3.5">
        <div className="flex flex-col gap-1">
          <div className="mb-px text-sm font-medium">
            <Link href="#" className="text-mono font-semibold hover:text-primary">
              Samuel Lee
            </Link>
            <span className="text-secondary-foreground"> requested to add user to </span>
            <Link href="#" className="font-semibold text-primary hover:text-primary">
              TechSynergy
            </Link>
          </div>

          <span className="flex items-center text-xs font-medium text-muted-foreground">
            22 hours ago
            <span className="bg-mono/30 mx-1.5 size-1 rounded-full"></span>
            Dev Team
          </span>
        </div>

        <Card className="flex flex-row items-center justify-between gap-1.5 rounded-lg bg-muted/70 px-2.5 py-2 shadow-none">
          <div className="flex flex-col">
            <Link href="#" className="text-mono text-xs font-medium hover:text-primary">
              Ronald Richards
            </Link>
            <Link href="#" className="text-xs font-medium text-muted-foreground hover:text-primary">
              ronald.richards@gmail.com
            </Link>
          </div>

          <Link
            href="#"
            className="text-xs font-medium text-secondary-foreground hover:text-primary"
          >
            Go to profile
          </Link>
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
