"use client";

import { toAbsoluteUrl } from "@/lib/helpers";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface Avatar {
  path?: string;
  filename?: string;
  fallback?: string;
  variant?: string;
}

type Avatars = Array<Avatar>;

interface AvatarGroupProp {
  size?: string;
  group: Avatar[];
  more?: { variant?: string; number?: number | string; label?: string };
  className?: string;
}

function AvatarGroup({ size, group, more, className }: AvatarGroupProp) {
  const avatarSize = size ? size : "size-7";

  const renderItem = (each: Avatar, index: number) => {
    return (
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
  };

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

export { AvatarGroup, type Avatar, type Avatars, type AvatarGroupProp };
