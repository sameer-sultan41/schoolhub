"use client";

import Link from "next/link";
import { toAbsoluteUrl } from "@/lib/helpers";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface ITournamentProps {
  image: string;
  logo: string;
  title: string;
  time: string;
  labels: string[];
  progress: {
    variant: string;
    value: number;
    slotNumber: number;
    leftNumber: number;
  };
}

const CardTournament = ({ image, logo, title, time, labels, progress }: ITournamentProps) => {
  const renderItem = (label: string, index: number) => {
    return (
      <Badge key={index} size="sm" variant="secondary">
        {label}
      </Badge>
    );
  };

  return (
    <Card className="mb-5 w-[285px] shadow-none">
      <div
        className="h-56 w-[285px] rounded-t-xl bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url(${toAbsoluteUrl(`/media/images/600x600/${image}`)})`,
        }}
      ></div>
      <div className="card-border card-rounded-b mb-4 grid gap-6 px-5 pt-3.5 pb-3">
        <div className="flex items-center gap-2.5">
          <img src={toAbsoluteUrl(`/media/brand-logos/${logo}`)} className="size" alt="image" />
          <div className="grid grid-cols-1 gap-0.5">
            <Link
              href="#"
              className="text-mono hover:text-primary-active mb-px text-base font-medium"
            >
              {title}
            </Link>
            <time className="flex items-center gap-1.5 text-xs text-secondary-foreground">
              <div className="h-1.5 w-1.5 gap-1.5 rounded-full bg-destructive"></div> {time}
            </time>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {labels.map((label, index) => {
            return renderItem(label, index);
          })}
        </div>
        <div className="mb-0.5 grid gap-1.5">
          <Progress
            value={progress?.value}
            indicatorClassName={progress?.variant}
            className="h-1"
          />
          <div className="flex place-content-between items-center">
            <span className="text-xs font-medium text-secondary-foreground">
              {progress.slotNumber} slots
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              {progress.leftNumber} left
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
};

export { CardTournament, type ITournamentProps };
