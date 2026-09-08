"use client";

import Link from "next/link";
import { Download } from "lucide-react";
import { toAbsoluteUrl } from "@/lib/helpers";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarIndicator,
  AvatarStatus,
} from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";

export default function Item8() {
  return (
    <div className="flex grow gap-2.5 px-5">
      <Avatar>
        <AvatarImage src="/media/avatars/300-12.png" alt="avatar" />
        <AvatarFallback>CH</AvatarFallback>
        <AvatarIndicator className="-end-1.5 -bottom-1.5">
          <AvatarStatus variant="online" className="size-2.5" />
        </AvatarIndicator>
      </Avatar>

      <div className="flex grow flex-col gap-3.5">
        <div className="flex flex-col gap-1">
          <div className="mb-px text-sm font-medium">
            <Link href="#" className="text-mono font-semibold hover:text-primary">
              Skylar Frost
            </Link>
            <span className="text-secondary-foreground"> uploaded 2 attachments </span>
          </div>
          <span className="flex items-center text-xs font-medium text-muted-foreground">
            3 days ago
            <span className="bg-mono/30 mx-1.5 size-1 rounded-full"></span>
            Web Design
          </span>
        </div>

        <Card className="flex flex-row items-center justify-between gap-1.5 rounded-lg bg-muted/70 p-2.5 shadow-none">
          <div className="flex items-center gap-1.5">
            <img src={toAbsoluteUrl("/media/file-types/word.svg")} className="h-5" alt="image" />

            <span className="me-1 text-xs font-medium text-secondary-foreground">
              landing-page-ver1.docx
            </span>
            <span className="text-xs font-medium text-muted-foreground">Upload 3 days ago</span>
          </div>
          <Download size={16} className="text-md text-muted-foreground" />
        </Card>

        <Card className="flex flex-row items-center justify-between gap-1.5 rounded-lg bg-muted/70 p-2.5 shadow-none">
          <div className="flex items-center gap-1.5">
            <img src={toAbsoluteUrl("/media/file-types/word.svg")} className="h-5" alt="image" />

            <span className="me-1 text-xs font-medium text-secondary-foreground hover:text-primary">
              landing-page-ver2.docx
            </span>
            <span className="text-xs font-medium text-muted-foreground">Upload 3 days ago</span>
          </div>

          <Download size={16} className="text-md text-muted-foreground" />
        </Card>
      </div>
    </div>
  );
}
