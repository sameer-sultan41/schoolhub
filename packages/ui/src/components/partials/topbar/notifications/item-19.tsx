"use client";

import Link from "next/link";
import { UserRoundCheck } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarIndicator,
  AvatarStatus,
} from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";

export default function Item19() {
  return (
    <div className="flex grow gap-2.5 px-5">
      <Avatar>
        <AvatarImage src="/media/avatars/300-17.png" alt="avatar" />
        <AvatarFallback>CH</AvatarFallback>
        <AvatarIndicator className="-end-1.5 -bottom-1.5">
          <AvatarStatus variant="online" className="size-2.5" />
        </AvatarIndicator>
      </Avatar>

      <div className="flex grow flex-col gap-2.5">
        <div className="mb-1 flex flex-col gap-1">
          <div className="mb-px text-sm font-medium">
            <Link href="#" className="text-mono font-semibold hover:text-primary">
              Aaron Foster
            </Link>
            <span className="text-secondary-foreground"> requested to view </span>
          </div>
          <span className="flex items-center text-xs font-medium text-muted-foreground">
            3 day ago
            <span className="bg-mono/30 mx-1.5 size-1 rounded-full"></span>
            Larsen Ltd
          </span>
        </div>

        <Card className="kt-card flex flex-row items-center gap-1.5 rounded-lg bg-muted/70 px-2.5 py-1.5 shadow-none">
          <UserRoundCheck size={16} className="text-base text-green-500" />
          <span className="text-sm font-medium text-green-500">You allowed Aaron to view</span>
        </Card>
      </div>
    </div>
  );
}
