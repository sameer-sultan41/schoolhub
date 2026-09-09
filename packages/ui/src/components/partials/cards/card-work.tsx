"use client";

import Link from "next/link";
import { Heart, Mails } from "lucide-react";
import { toAbsoluteUrl } from "@/lib/helpers";
import { Card } from "@/components/ui/card";

interface IWorkProps {
  image: string;
  title: string;
  description?: string;
  authorAvatar: string;
  authorName: string;
  likes: number;
  comments: number;
}

const CardWork = ({ image, title, authorAvatar, authorName, likes, comments }: IWorkProps) => {
  return (
    <Card className="border-0 shadow-sm shadow-black/8">
      <img
        src={toAbsoluteUrl(`/media/images/600x400/${image}`)}
        className="h-auto w-full rounded-t-xl"
        alt="image"
      />
      <div className="card-border card-rounded-b flex flex-col gap-2 px-5 py-4.5">
        <Link
          href="/public-profile/profiles/company"
          className="text-mono text-lg font-medium hover:text-primary"
        >
          {title}
        </Link>
        <div className="flex grow items-center justify-between">
          <div className="flex grow items-center">
            <img
              src={toAbsoluteUrl(`/media/avatars/${authorAvatar}`)}
              className="me-2 size-7 rounded-full"
              alt="image"
            />
            <Link
              href="/public-profile/profiles/nft"
              className="mb-px text-sm text-foreground hover:text-primary"
            >
              {authorName}
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Heart size={16} className="text-base text-muted-foreground" />
              <span className="py-2 text-sm text-foreground">{likes}</span>
            </div>
            <div className="flex items-center gap-1">
              <Mails size={16} className="text-base text-muted-foreground" />
              <span className="py-2 text-sm text-foreground">{comments}</span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export { CardWork, type IWorkProps };
