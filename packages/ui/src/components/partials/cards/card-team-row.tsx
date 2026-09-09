"use client";

import Link from "next/link";
import { CircleCheck, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AvatarGroup } from "../common/avatar-group";
import { Rating } from "../common/rating";
import { ITeamProps } from "./card-team";

const CardTeamRow = ({
  icon: Icon,
  title,
  description,
  labels,
  rating,
  team,
  connected,
}: ITeamProps) => {
  const renderItem = (label: string, index: number) => {
    return (
      <Badge key={index} size="md" variant="secondary">
        {label}
      </Badge>
    );
  };

  return (
    <Card className="p-7.5">
      <div className="flex flex-wrap items-center justify-between gap-7">
        <div className="flex items-center gap-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-accent/60 ring-1 ring-input">
            <Icon size={16} className="text-2xl text-secondary-foreground" />
          </div>
          <div className="grid-col grid gap-1">
            <Link
              href="#"
              className="text-mono hover:text-primary-active mb-px text-base font-medium"
            >
              {title}
            </Link>
            <span className="text-sm text-secondary-foreground">{description}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-6 lg:gap-12">
          <div className="grid justify-end gap-5 lg:text-end">
            <span className="text-xs font-normal text-muted-foreground uppercase">skills</span>
            <div className="flex gap-1.5">
              {labels.map((label, index) => {
                return renderItem(label, index);
              })}
            </div>
          </div>
          <div className="grid justify-end gap-6 lg:text-end">
            <div className="text-xs text-secondary-foreground uppercase">rating</div>
            <Rating rating={rating.value} round={rating.round} />
          </div>
          <div className="max-w-auto grid shrink-0 justify-end gap-3.5 lg:min-w-24 lg:text-end">
            <span className="text-xs text-secondary-foreground uppercase">memebers</span>
            <AvatarGroup
              group={team.group}
              more={team.more}
              className={team.className}
              size={team.size}
            />
          </div>
          <div className="grid min-w-20 justify-end">
            {connected ? (
              <Button variant="outline">
                <Link href="#">
                  <CircleCheck size={16} />
                </Link>{" "}
                Joined
              </Button>
            ) : (
              <Button variant="primary">
                <Link href="#">
                  <Users size={16} />
                </Link>{" "}
                Join
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
};

export { CardTeamRow };
