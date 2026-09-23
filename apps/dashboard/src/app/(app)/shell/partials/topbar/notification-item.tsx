"use client";

import { useState } from "react";
import Link from "next/link";
import { Image as ImageIcon } from "lucide-react";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarIndicator,
  AvatarStatus,
  Badge,
  BadgeDot,
  Card,
  Input,
} from "@schoolhub/ui";

// Consolidated from packages/ui's partials/topbar/notifications/item-1.tsx through
// item-20.tsx — the vendor ships one file per sample notification (mostly
// identical markup, different copy). Reduced to the two real shapes those 20
// files render (a "mention" with an inline reply card, and a plain "activity"
// line), driven by data instead of 20 near-duplicate components. Content below
// is Metronic's own real sample data, taken from the vendor's actual call sites.
export type NotificationVariant = "mention" | "activity";

export interface NotificationItemData {
  variant: NotificationVariant;
  userName: string;
  avatar: string;
  description: string;
  link?: string;
  label?: string;
  time: string;
  specialist?: string;
  text?: string;
  badgeColor?: "online" | "offline";
  info?: string;
}

export function NotificationItem(item: NotificationItemData) {
  if (item.variant === "mention") {
    return <MentionItem {...item} />;
  }
  return <ActivityItem {...item} />;
}

function MentionItem({
  userName,
  avatar,
  description,
  link,
  label,
  time,
  specialist,
  text,
}: NotificationItemData) {
  const [replyInput, setReplyInput] = useState("");

  return (
    <div className="flex grow gap-2.5 px-5">
      <Avatar>
        <AvatarImage src={`/media/avatars/${avatar}`} alt="avatar" />
        <AvatarFallback>CH</AvatarFallback>
        <AvatarIndicator className="-end-1.5 -bottom-1.5">
          <AvatarStatus variant="online" className="size-2.5" />
        </AvatarIndicator>
      </Avatar>
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium">
            <Link href="#" className="text-mono font-semibold hover:text-primary">
              {userName}
            </Link>
            <span className="text-secondary-foreground"> {description} </span>
            {link && (
              <Link href="#" className="text-primary hover:text-primary">
                {link}
              </Link>
            )}
            {label && <span className="text-secondary-foreground"> {label} </span>}
          </div>
          <span className="flex items-center text-xs font-medium text-muted-foreground">
            {time}
            {specialist && (
              <>
                <span className="bg-mono/30 mx-1.5 size-1 rounded-full"></span>
                {specialist}
              </>
            )}
          </span>
        </div>
        {text && (
          <Card className="flex flex-col gap-2.5 rounded-lg bg-muted/70 p-3.5 shadow-none">
            <div className="mb-px text-sm font-semibold text-secondary-foreground">
              <span className="font-medium text-secondary-foreground">{text}</span>
            </div>
            <div className="relative w-full sm:max-w-full">
              <ImageIcon className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Reply"
                value={replyInput}
                onChange={(e) => {
                  setReplyInput(e.target.value);
                }}
                className="w-full"
              />
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function ActivityItem({
  userName,
  avatar,
  description,
  link,
  badgeColor,
  time,
  info,
}: NotificationItemData) {
  return (
    <div className="flex grow items-center gap-2.5 px-5">
      <Avatar>
        <AvatarImage src={`/media/avatars/${avatar}`} alt="avatar" />
        <AvatarFallback>CH</AvatarFallback>
        <AvatarIndicator className="-end-1.5 -bottom-1.5">
          <AvatarStatus
            variant={badgeColor === "offline" ? "offline" : "online"}
            className="size-2.5"
          />
        </AvatarIndicator>
      </Avatar>
      <div className="flex grow flex-col gap-1">
        <div className="text-sm font-medium">
          <Link href="#" className="text-mono font-semibold hover:text-primary">
            {userName}
          </Link>
          <span className="text-secondary-foreground"> {description} </span>
          {link && (
            <Link href="#" className="text-primary hover:text-primary">
              {link}
            </Link>
          )}
        </div>
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {time}
          {info && (
            <Badge size="sm" variant="secondary" appearance="light">
              <BadgeDot />
              {info}
            </Badge>
          )}
        </span>
      </div>
    </div>
  );
}
