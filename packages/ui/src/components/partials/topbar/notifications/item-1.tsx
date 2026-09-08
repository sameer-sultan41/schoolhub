"use client";

import { useState } from "react";
import Link from "next/link";
import { Image as ImageIcon } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarIndicator,
  AvatarStatus,
} from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface ItemProps {
  userName: string;
  avatar: string;
  description: string;
  link: string;
  label: string;
  time: string;
  specialist: string;
  text: string;
}

export default function Item1({
  userName,
  avatar,
  description,
  link,
  label,
  time,
  specialist,
  text,
}: ItemProps) {
  const [emailInput, setEmailInput] = useState("");
  return (
    <div className="flex grow gap-2.5 px-5">
      <Avatar>
        <AvatarImage src={`/media/avatars/${avatar}`} alt="avatar" />
        <AvatarFallback>CH</AvatarFallback>
        <AvatarIndicator className="-end-1.5 -bottom-1.5">
          <AvatarStatus variant="online" className="size-2.5" />
        </AvatarIndicator>
      </Avatar>

      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium">
            <Link href="#" className="text-mono font-semibold hover:text-primary">
              {userName}
            </Link>
            <span className="text-secondary-foreground"> {description} </span>
            <Link href="#" className="text-primary hover:text-primary">
              {link}
            </Link>
            <span className="text-secondary-foreground"> {label} </span>
          </div>

          <span className="flex items-center text-xs font-medium text-muted-foreground">
            {time}
            <span className="bg-mono/30 mx-1.5 size-1 rounded-full"></span>
            {specialist}
          </span>
        </div>

        <Card className="flex flex-col gap-2.5 rounded-lg bg-muted/70 p-3.5 shadow-none">
          <div className="mb-px text-sm font-semibold text-secondary-foreground">
            <Link href="#" className="text-mono font-semibold hover:text-primary">
              @Cody{" "}
            </Link>
            <span className="font-medium text-secondary-foreground">{text}</span>
          </div>

          <div className="relative w-full sm:max-w-full">
            <ImageIcon className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Reply"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              className="w-full"
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
