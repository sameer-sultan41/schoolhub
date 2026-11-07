"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@schoolhub/ui";

import { enumBadge, enumLabel } from "@/lib/enum-label";

export interface GrantStatusBadgeProps<T extends string> {
  status: T;
  labels: Readonly<Record<T, string>>;
  variants: Readonly<Record<T, "primary" | "success" | "warning" | "destructive" | "secondary">>;
}

/** A grant's or fine's status as a theme-token badge with its label (the label map and variants are the caller's exhaustive records). */
export function GrantStatusBadge<T extends string>({
  status,
  labels,
  variants,
}: GrantStatusBadgeProps<T>) {
  const t = useTranslations("fees");
  return (
    <Badge variant={enumBadge(variants, status, "secondary")} appearance="light">
      {enumLabel(t, labels, status)}
    </Badge>
  );
}
