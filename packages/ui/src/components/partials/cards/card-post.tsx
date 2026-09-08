"use client";

import Link from "next/link";
import { Clock9 } from "lucide-react";
import { toAbsoluteUrl } from "@/lib/helpers";
import { Card } from "@/components/ui/card";

interface IPostProps {
  image: string;
  label: string;
  description: string;
  time: string;
}

const CardPost = ({ image, label, description, time }: IPostProps) => {
  return (
    <Card className="mb-5 w-[280px] shadow-none">
      <div
        className="h-[240px] w-[280px] rounded-t-xl bg-cover bg-center"
        style={{
          backgroundImage: `url(${toAbsoluteUrl(`/media/images/600x400/${image}`)})`,
        }}
      ></div>
      <div className="card-border card-rounded-b grid gap-1.5 px-5 py-4">
        <Link href="#" className="text-sm font-medium text-orange-400 hover:text-primary">
          {label}
        </Link>
        <Link
          href="#"
          className="text-mono mb-1.5 text-lg leading-6 font-medium hover:text-primary"
        >
          {description}
        </Link>
        <time className="flex items-center gap-1.5 text-sm leading-none font-medium text-secondary-foreground">
          <Clock9 size={16} className="text-lg text-muted-foreground" /> {time}
        </time>
      </div>
    </Card>
  );
};

export { CardPost, type IPostProps };
