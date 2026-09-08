"use client";

import Link from "next/link";
import { toAbsoluteUrl } from "@/lib/helpers";
import { Card } from "@/components/ui/card";

interface ILocationProps {
  image: string;
  title: string;
  description: string;
}

const CardLocation = ({ image, title, description }: ILocationProps) => {
  return (
    <Card className="mb-4 w-[280px] border-0 shadow-none">
      <img
        src={toAbsoluteUrl(`/media/images/600x400/${image}`)}
        className="max-w-[280px] shrink-0 rounded-t-xl"
        alt="image"
      />
      <div className="card-border card-rounded-b h-full px-3.5 pt-3 pb-3.5">
        <Link href="#" className="text-mono mb-2 block text-base font-medium hover:text-primary">
          {title}
        </Link>
        <p className="text-sm text-secondary-foreground">{description}</p>
      </div>
    </Card>
  );
};

export { CardLocation, type ILocationProps };
