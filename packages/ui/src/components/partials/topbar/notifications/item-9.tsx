"use client";

import Link from "next/link";
import { CircleCheck } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarIndicator,
  AvatarStatus,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

export default function Item9() {
  return (
    <div className="flex gap-2.5 px-5">
      <Avatar>
        <AvatarImage src="/media/avatars/300-21.png" alt="avatar" />
        <AvatarFallback>CH</AvatarFallback>
        <AvatarIndicator className="-end-1.5 -bottom-1.5">
          <AvatarStatus variant="online" className="size-2.5" />
        </AvatarIndicator>
      </Avatar>

      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1">
          <div className="mb-px text-sm font-medium">
            <Link href="#" className="text-mono font-semibold hover:text-primary">
              Selene Silverleaf
            </Link>
            <span className="text-secondary-foreground"> created a tasks in </span>
            <Link href="#" className="text-primary hover:text-primary">
              Design Project
            </Link>
          </div>

          <span className="flex items-center text-xs font-medium text-muted-foreground">
            4 days ago
            <span className="bg-mono/30 mx-1.5 size-1 rounded-full"></span>
            Manager
          </span>
        </div>

        <div className="grid gap-1.5">
          <Badge
            size="sm"
            variant="success"
            appearance="light"
            className="me-1 text-xs text-green-500"
          >
            <CircleCheck /> Feature Prioritization
          </Badge>
          <Badge size="sm" variant="secondary" className="me-1 text-xs text-secondary-foreground">
            <CircleCheck /> Last Month User Research
          </Badge>
        </div>
      </div>
    </div>
  );
}
