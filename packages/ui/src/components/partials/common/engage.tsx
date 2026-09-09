"use client";

import { ReactElement } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";

export interface EngageProps {
  title: string;
  description: string;
  image: ReactElement;
  more: {
    url: string;
    title: string;
  };
}

export function Engage({ title, description, image, more }: EngageProps) {
  return (
    <Card>
      <CardContent className="px-10 py-7.5 lg:pr-12.5">
        <div className="flex flex-wrap items-center gap-6 md:flex-nowrap md:gap-10">
          <div className="flex flex-col items-start gap-3">
            <h2 className="text-mono text-xl font-medium">{title}</h2>
            <p className="mb-2.5 text-sm leading-5.5 text-foreground">{description}</p>
          </div>
          {image}
        </div>
      </CardContent>
      <CardFooter className="justify-center">
        <Button mode="link" underlined="dashed" asChild>
          <Link href={more.url}>{more.title}</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
