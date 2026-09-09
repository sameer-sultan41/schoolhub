"use client";

import Link from "next/link";
import { toAbsoluteUrl } from "@/lib/helpers";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarIndicator,
  AvatarStatus,
} from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";

export default function Item6() {
  return (
    <div className="flex grow gap-2.5 px-5">
      <Avatar>
        <AvatarImage src="/media/avatars/300-14.png" alt="avatar" />
        <AvatarFallback>CH</AvatarFallback>
        <AvatarIndicator className="-end-1.5 -bottom-1.5">
          <AvatarStatus variant="offline" className="size-2.5" />
        </AvatarIndicator>
      </Avatar>

      <div className="flex grow flex-col gap-3.5">
        <div className="flex flex-col gap-1">
          <div className="mb-px text-sm font-medium">
            <Link href="#" className="text-mono font-semibold hover:text-primary">
              Tyler Hero{" "}
            </Link>
            <span className="text-secondary-foreground"> wants to view your design project </span>
          </div>
          <span className="flex items-center text-xs font-medium text-muted-foreground">
            3 day ago
            <span className="bg-mono/30 mx-1.5 size-1 rounded-full"></span>
            Metronic Launcher mockups
          </span>
        </div>

        <Card className="flex flex-row items-center gap-1.5 rounded-lg bg-muted/70 p-2.5 shadow-none">
          <div className="flex h-[30px] w-[26px] shrink-0 items-center justify-center rounded-sm border border-border bg-background">
            <img src={toAbsoluteUrl("/media/file-types/figma.svg")} className="h-5" alt="image" />
          </div>

          <Link
            href="#"
            className="me-1 text-xs font-medium text-secondary-foreground hover:text-primary"
          >
            Launcher-UIkit.fig
          </Link>
          <span className="text-xs font-medium text-muted-foreground">Edited 2 mins ago</span>
        </Card>
      </div>
    </div>
  );
}
