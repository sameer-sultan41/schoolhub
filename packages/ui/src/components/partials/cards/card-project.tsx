"use client";

import Link from "next/link";
import { toAbsoluteUrl } from "@/lib/helpers";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AvatarGroup } from "../common/avatar-group";

interface IProjectProps {
  logo: string;
  name: string;
  description: string;
  startDate?: string;
  endDate?: string;
  status: {
    variant?:
      "primary" | "destructive" | "secondary" | "info" | "success" | "warning" | null | undefined;
    label: string;
  };
  progress: {
    variant: string;
    value: number;
  };
  team: {
    size?: string;
    group: Array<{ filename?: string; variant?: string; fallback?: string }>;
    more?: {
      variant?: string;
      number?: number;
    };
  };
}

const CardProject = ({
  logo,
  name,
  description,
  startDate,
  endDate,
  status,
  progress,
  team,
}: IProjectProps) => {
  return (
    <Card className="p-7.5">
      <div className="mb-3 flex items-center justify-between lg:mb-6">
        <div className="flex size-[50px] items-center justify-center rounded-lg bg-accent/60">
          <img src={toAbsoluteUrl(`/media/brand-logos/${logo}`)} className="" alt="image" />
        </div>
        <Badge size="lg" variant={status.variant} appearance="light">
          {status.label}
        </Badge>
      </div>
      <div className="mb-3 flex flex-col lg:mb-6">
        <Link
          href="#"
          className="font-media/brand text-mono hover:text-primary-active mb-px text-lg"
        >
          {name}
        </Link>
        <span className="text-sm text-secondary-foreground">{description}</span>
      </div>
      <div className="mb-3.5 flex items-center gap-5 lg:mb-7">
        <span className="text-sm text-secondary-foreground">
          Start: <span className="text-sm font-medium text-foreground">{startDate}</span>
        </span>
        <span className="text-sm text-secondary-foreground">
          End: <span className="text-sm font-medium text-foreground">{endDate}</span>
        </span>
      </div>
      <Progress
        value={progress?.value}
        indicatorClassName={progress?.variant}
        className="mb-4 h-1.5 lg:mb-8"
      />
      <AvatarGroup group={team.group} size={team.size} more={team.more} />
    </Card>
  );
};

export { CardProject, type IProjectProps };
