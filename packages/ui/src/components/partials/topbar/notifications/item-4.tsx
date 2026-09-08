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

export default function Item4() {
  return (
    <div className="flex grow gap-2.5 px-5">
      <Avatar>
        <AvatarImage src="/media/avatars/300-10.png" alt="avatar" />
        <AvatarFallback>CH</AvatarFallback>
        <AvatarIndicator className="-end-1.5 -bottom-1.5">
          <AvatarStatus variant="offline" className="size-2.5" />
        </AvatarIndicator>
      </Avatar>

      <div className="flex grow flex-col gap-3.5">
        <div className="flex flex-col gap-1">
          <div className="mb-px text-sm font-medium">
            <Link href="#" className="text-mono font-semibold hover:text-primary">
              Jane Perez
            </Link>
            <span className="text-secondary-foreground"> invites you to review a file. </span>
          </div>

          <span className="flex items-center text-xs font-medium text-muted-foreground">
            3 hours ago
            <span className="bg-mono/30 mx-1.5 size-1 rounded-full"></span>
            742kb
          </span>
        </div>

        <Card className="flex flex-row items-center gap-1.5 rounded-lg bg-muted/70 p-2.5 shadow-none">
          <img src={toAbsoluteUrl("/media/file-types/pdf.svg")} className="h-5" alt="image" />
          <Link
            href="#"
            className="me-1 text-xs font-medium text-secondary-foreground hover:text-primary"
          >
            Launch_nov24.pptx
          </Link>
          <span className="text-xs font-medium text-muted-foreground">Edited 39 mins ago</span>
        </Card>
      </div>
    </div>
  );
}
