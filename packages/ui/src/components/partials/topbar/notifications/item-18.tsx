"use client";

import Link from "next/link";
import { toAbsoluteUrl } from "@/lib/helpers";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarIndicator,
  AvatarStatus,
} from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";

interface IItem18Item {
  image: string;
  title: string;
  id: string;
}
type IItem18Items = Array<IItem18Item>;

export default function Item18() {
  const items: IItem18Items = [
    {
      image: "6.jpg",
      title: "Geometric Patterns",
      id: "81023",
    },
    {
      image: "1.jpg",
      title: "Artistic Expressions",
      id: "67890",
    },
  ];

  const renderItem = (item: IItem18Item, index: number) => {
    return (
      <Card
        key={index}
        className="flex w-40 flex-col gap-3.5 overflow-hidden bg-muted/70 shadow-none"
      >
        <div
          className="kt-card-rounded-t h-24 shrink-0 bg-cover bg-no-repeat"
          style={{
            backgroundImage: `url(${toAbsoluteUrl(`/media/images/600x600/${item.image}`)})`,
          }}
        ></div>

        <div className="px-2.5 pb-2">
          <Link
            href="#"
            className="mb-0.5 block text-xs leading-4 font-medium text-secondary-foreground hover:text-primary"
          >
            {item.title}
          </Link>
          <div className="text-xs font-medium text-muted-foreground">
            Token ID:
            <span className="text-xs font-medium text-secondary-foreground">{item.id}</span>
          </div>
        </div>
      </Card>
    );
  };

  return (
    <div className="flex grow gap-2.5 px-5">
      <Avatar>
        <AvatarImage src="/media/avatars/300-1.png" alt="avatar" />
        <AvatarFallback>CH</AvatarFallback>
        <AvatarIndicator className="-end-1.5 -bottom-1.5">
          <AvatarStatus variant="online" className="size-2.5" />
        </AvatarIndicator>
      </Avatar>

      <div className="flex grow flex-col gap-2.5">
        <div className="mb-1 flex flex-col gap-1">
          <div className="mb-px text-sm font-medium">
            <Link href="#" className="text-mono font-semibold hover:text-primary">
              Jane Perez
            </Link>
            <span className="text-secondary-foreground"> added 2 new works to </span>
            <Link href="#" className="font-semibold text-primary hover:text-primary">
              Inspirations 2024
            </Link>
          </div>

          <span className="flex items-center text-xs font-medium text-muted-foreground">
            23 hours ago
            <span className="bg-mono/30 mx-1.5 size-1 rounded-full"></span>
            Craftwork Design
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          {items.map((item, index) => {
            return renderItem(item, index);
          })}
        </div>
      </div>
    </div>
  );
}
