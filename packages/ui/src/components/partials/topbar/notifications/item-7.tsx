"use client";

import Link from "next/link";
import { AvatarGroup } from "@/partials/common/avatar-group";
import { CalendarDays, Lock, MapPin, NotepadText, Timer, Users } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarIndicator,
  AvatarStatus,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function Item7() {
  return (
    <div className="flex grow gap-2.5 px-5">
      <Avatar>
        <AvatarImage src="/media/avatars/300-15.png" alt="avatar" />
        <AvatarFallback>CH</AvatarFallback>
        <AvatarIndicator className="-end-1.5 -bottom-1.5">
          <AvatarStatus variant="offline" className="size-2.5" />
        </AvatarIndicator>
      </Avatar>

      <div className="flex grow flex-col gap-3.5">
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

        <Card className="gap-1.5 rounded-lg bg-muted/70 py-2.5 shadow-none">
          <div className="mb-0.5 flex flex-col gap-2.5 px-2.5">
            <span className="text-xs font-medium text-secondary-foreground">
              Peparation for Release
              <Lock size={16} />
            </span>

            <div className="flex items-center gap-2.5">
              <Badge
                size="sm"
                variant="warning"
                appearance="light"
                className="me-1 text-yellow-400"
              >
                <NotepadText /> Project
              </Badge>
              <Badge
                size="sm"
                variant="secondary"
                appearance="light"
                className="me-1 text-secondary-foreground"
              >
                <Users /> DigitalDream
              </Badge>
            </div>
          </div>

          <div className="my-1.5 border-b border-b-border"></div>

          <div className="flex flex-wrap items-center justify-between gap-2.5 px-2.5">
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-0.5">
                  <CalendarDays size={16} className="me-0.5 text-xs text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">22 April 2024</span>
                </div>

                <div className="flex items-center gap-0.5">
                  <Timer size={16} className="text-xs text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">
                    12:00 PM - 14:00 PM
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-0.5">
                <MapPin size={16} className="text-xs text-muted-foreground" />
                <div className="text-xs font-medium text-muted-foreground">
                  Online
                  <Link href="#" className="font-medium text-primary hover:text-primary">
                    Zoom Meeting
                  </Link>
                </div>
              </div>
            </div>

            <AvatarGroup
              size="size-6"
              group={[
                { path: "/media/avatars/300-4.png" },
                { path: "/media/avatars/300-1.png" },
                { path: "/media/avatars/300-2.png" },
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
