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
import { Button } from "@/components/ui/button";

export default function Item17() {
  return (
    <div className="flex grow gap-2.5 px-5">
      <Avatar>
        <AvatarImage src="/media/avatars/300-19.png" alt="avatar" />
        <AvatarFallback>CH</AvatarFallback>
        <AvatarIndicator className="-end-1.5 -bottom-1.5">
          <AvatarStatus variant="online" className="size-2.5" />
        </AvatarIndicator>
      </Avatar>

      <div className="flex grow flex-col gap-2.5">
        <div className="mb-1 flex flex-col gap-1">
          <div className="mb-px text-sm font-medium">
            <Link href="#" className="text-mono font-semibold hover:text-primary">
              Natalie Wood
            </Link>
            <span className="text-secondary-foreground"> wants to edit marketing project </span>
          </div>
          <span className="flex items-center text-xs font-medium text-muted-foreground">
            1 day ago
            <span className="bg-mono/30 mx-1.5 size-1 rounded-full"></span>
            Designer
          </span>
        </div>

        <div className="kt-card flex flex-row items-center gap-1.5 rounded-lg bg-muted/70 p-2.5 shadow-none">
          <div className="flex h-[30px] w-[26px] shrink-0 items-center justify-center rounded-sm border border-border bg-white">
            <img src={toAbsoluteUrl("/media/brand-logos/jira.svg")} className="h-5" alt="image" />
          </div>

          <Link
            href="#"
            className="me-1 text-xs font-medium text-secondary-foreground hover:text-primary"
          >
            User-feedback.jira
          </Link>
          <span className="text-xs font-medium text-muted-foreground">Edited 1 hour ago</span>
        </div>

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
