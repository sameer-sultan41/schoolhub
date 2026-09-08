"use client";

import Link from "next/link";
import { EllipsisVertical, Heart, Mails } from "lucide-react";
import { toAbsoluteUrl } from "@/lib/helpers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu2 } from "../dropdown-menu/dropdown-menu-2";
import { IWorkProps } from "./card-work";

const CardWorkRow = ({
  image,
  description,
  title,
  authorAvatar,
  authorName,
  likes,
  comments,
}: IWorkProps) => {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-7">
        <div className="flex flex-wrap items-center gap-5">
          <img
            src={toAbsoluteUrl(`/media/images/600x400/${image}`)}
            className="max-h-20 max-w-full shrink-0 rounded-md"
            alt="image"
          />
          <div className="grid-col grid gap-1">
            <Link
              href="#"
              className="text-mono hover:text-primary-active mb-px text-lg font-semibold"
            >
              {title}
            </Link>
            <span className="text-sm font-medium text-secondary-foreground">{description}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-5 lg:gap-7.5">
          <div className="flex items-center gap-1.5">
            <img
              src={toAbsoluteUrl(`/media/avatars/${authorAvatar}`)}
              className="h-7 rounded-full"
              alt="image"
            />
            <Link
              href="#"
              className="hover:text-primary-active mb-px text-sm font-medium text-secondary-foreground"
            >
              {authorName}
            </Link>
          </div>
          <div className="flex w-20 items-center justify-end gap-1">
            <Heart size={16} className="text-base text-muted-foreground" />
            <span className="py-2 text-sm font-medium text-secondary-foreground">{likes}</span>
            <span className="text-sm font-medium text-secondary-foreground">Likes</span>
          </div>
          <div className="flex w-28 items-center justify-end gap-1">
            <Mails size={16} className="text-base text-muted-foreground" />
            <span className="py-2 text-sm font-medium text-secondary-foreground">{comments}</span>
            <span className="text-sm font-medium text-secondary-foreground">Comments</span>
          </div>
          <DropdownMenu2
            trigger={
              <Button variant="ghost" mode="icon">
                <EllipsisVertical />
              </Button>
            }
          />
        </div>
      </div>
    </Card>
  );
};

export { CardWorkRow };
