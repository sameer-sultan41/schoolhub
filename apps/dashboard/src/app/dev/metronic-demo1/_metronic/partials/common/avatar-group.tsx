"use client";

import { Avatar, AvatarFallback, AvatarImage, cn } from "@schoolhub/ui";

import { toAbsoluteUrl } from "../../helpers";

// Ported verbatim from packages/ui's partials/common/avatar-group.tsx.
export interface AvatarGroupAvatar {
  path?: string;
  filename?: string;
  fallback?: string;
  variant?: string;
}

export type Avatars = AvatarGroupAvatar[];

interface AvatarGroupProp {
  size?: string;
  group: AvatarGroupAvatar[];
  more?: { variant?: string; number?: number | string; label?: string };
  className?: string;
}

export function AvatarGroup({ size, group, more, className }: AvatarGroupProp) {
  const avatarSize = size ? size : "size-7";

  const renderItem = (each: AvatarGroupAvatar, index: number) => (
    <Avatar key={index} className={cn(avatarSize)}>
      {each.filename || each.path ? (
        <AvatarImage
          src={toAbsoluteUrl(each.path || `/media/avatars/${each.filename}`)}
          alt="image"
          className={cn("border-1 border-background hover:z-10", each.variant)}
        />
      ) : null}
      {each.fallback ? (
        <AvatarFallback
          className={cn(
            "relative border-1 border-background text-[11px] hover:z-10",
            size,
            each.variant,
          )}
        >
          {each.fallback}
        </AvatarFallback>
      ) : null}
    </Avatar>
  );

  return (
    <div className={cn("flex -space-x-2", className)}>
      {group.map((each, index) => renderItem(each, index))}
      {more && (
        <span
          className={cn(
            "relative flex shrink-0 cursor-default items-center justify-center rounded-full border-1 border-background text-[11px] leading-none font-semibold hover:z-10",
            avatarSize,
            more.variant,
          )}
        >
          +{more.number || more.label}
        </span>
      )}
    </div>
  );
}
