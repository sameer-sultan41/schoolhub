"use client";

import Link from "next/link";
import { Heart, Mail } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarIndicator,
  AvatarStatus,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export default function Item12() {
  return (
    <div className="flex grow gap-2.5 px-5">
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
            <span className="text-secondary-foreground"> created message to </span>
            <Link href="#" className="text-primary hover:text-primary">
              SiteSculpt
            </Link>
            <span className="text-secondary-foreground"> project </span>
          </div>
          <span className="flex items-center text-xs font-medium text-muted-foreground">
            4 days ago
            <span className="bg-mono/30 mx-1.5 size-1 rounded-full"></span>
            Manager
          </span>
        </div>

        <Card className="flex flex-col gap-2.5 rounded-lg p-3.5 shadow-none">
          <div className="text-mono text-sm font-semibold">Dashboards</div>
          <p className="mb-1 text-sm leading-5 font-medium text-secondary-foreground">
            Hello everyone, question regarding the preparation of
            <br />
            new dashboards. The update is coming soon, when will the new themes be ready?
          </p>

          <div className="flex items-center gap-2.5">
            <Badge
              size="sm"
              variant="primary"
              appearance="light"
              className="me-1 text-sm text-primary"
            >
              <Mail /> 26 Comments
            </Badge>
            <Badge size="sm" variant="secondary" className="me-1 text-sm text-muted-foreground">
              <Heart /> 13 Likes
            </Badge>
          </div>
        </Card>
      </div>
    </div>
  );
}
