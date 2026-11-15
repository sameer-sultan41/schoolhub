"use client";

import { useTranslations } from "next-intl";
import {
  Badge,
  BadgeDot,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";

import { STRUCTURE_STATUS } from "@/services/modules/school-organization/school-organization-constant";

/** A structure record's Active / Inactive badge. */
export function StructureStatusBadge({ isActive }: { isActive: boolean | undefined }) {
  const t = useTranslations("school");
  return isActive === false ? (
    <Badge variant="secondary" appearance="light">
      <BadgeDot />
      {t("status.inactive")}
    </Badge>
  ) : (
    <Badge variant="success" appearance="light">
      <BadgeDot />
      {t("status.active")}
    </Badge>
  );
}

/** The structure lists' status filter: all, active or inactive. */
export function StructureStatusFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (status: string) => void;
}) {
  const t = useTranslations("school");
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-40" aria-label={t("filters.status")}>
        <SelectValue placeholder={t("filters.status")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={STRUCTURE_STATUS.all}>{t("filters.all")}</SelectItem>
        <SelectItem value={STRUCTURE_STATUS.active}>{t("status.active")}</SelectItem>
        <SelectItem value={STRUCTURE_STATUS.inactive}>{t("status.inactive")}</SelectItem>
      </SelectContent>
    </Select>
  );
}
