"use client";

import { Fragment } from "react";
import Link from "next/link";
import { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HexagonBadge } from "./hexagon-badge";

export interface HighlightedPostsItem {
  icon: LucideIcon;
  title: string;
  summary: string;
  path: string;
}

export type HighlightedPostsItems = Array<HighlightedPostsItem>;

export interface HighlightedPostsProps {
  posts: HighlightedPostsItem[];
}

export function HighlightedPosts({ posts }: HighlightedPostsProps) {
  const renderItem = (post: HighlightedPostsItem, index: number) => {
    return (
      <Fragment key={index}>
        <div className="flex flex-col items-start gap-2.5">
          <div className="mb-2.5">
            <HexagonBadge
              stroke="stroke-orange-200 dark:stroke-orange-950"
              fill="fill-orange-50 dark:fill-orange-950/30"
              size="size-[50px]"
              badge={<post.icon size={28} className="ps-px text-xl text-orange-400" />}
            />
          </div>
          <Link
            href={`${post.path}`}
            className="text-mono text-base font-semibold hover:text-primary"
          >
            {post.title}
          </Link>
          <p className="text-sm text-secondary-foreground">{post.summary}</p>
          <Button mode="link" underlined="dashed" asChild>
            <Link href={`${post.path}`}>Learn more</Link>
          </Button>
        </div>
        <span className="hidden border-b-border not-last:block not-last:border-b"></span>
      </Fragment>
    );
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 py-10 lg:gap-7.5">
        {posts.map((post, index) => {
          return renderItem(post, index);
        })}
      </CardContent>
    </Card>
  );
}
