"use client";

import Link from "next/link";
import { CircleCheck, LucideIcon, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { AvatarGroup } from "../common/avatar-group";
import { Rating } from "../common/rating";

interface ITeamProps {
  icon: LucideIcon;
  title: string;
  description: string;
  labels: string[];
  team: {
    size?: string;
    group: Array<{ filename?: string; variant?: string; fallback?: string }>;
    more?: {
      number: number;
      variant: string;
    };
    className?: string;
  };
  connected: boolean;
  rating: {
    value: number;
    round: number;
  };
}

const CardTeam = ({
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
    <Card>
      <CardContent className="grid gap-7 py-7.5">
        <div className="grid place-items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-full bg-accent/60 ring-1 ring-input">
            <Icon size={16} className="text-2xl text-secondary-foreground" />
          </div>
          <div className="grid place-items-center">
            <Link
              href="#"
              className="text-mono hover:text-primary-active mb-px text-base font-medium"
            >
              {title}
            </Link>
            <span className="text-center text-sm text-secondary-foreground">{description}</span>
          </div>
        </div>
        <div className="grid">
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-secondary-foreground uppercase">skills</span>
            <div className="flex flex-wrap gap-1.5">
              {labels.map((label, index) => {
                return renderItem(label, index);
              })}
            </div>
          </div>
          <div className="border-t border-dashed border-input"></div>
          <div className="my-2.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-secondary-foreground uppercase">rating</span>
            <Rating rating={rating.value} round={rating.round} />
          </div>
          <div className="mb-3.5 border-t border-dashed border-input"></div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-secondary-foreground uppercase">members</span>
            <AvatarGroup
              group={team.group}
              more={team.more}
              className={team.className}
              size={team.size}
            />
          </div>
        </div>
      </CardContent>
      <CardFooter className="justify-center">
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
      </CardFooter>
    </Card>
  );
};

export { CardTeam, type ITeamProps };
