"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Skeleton } from "@schoolhub/ui";
import { Layers } from "lucide-react";

import { LoadErrorCard } from "@/components/load-error-card";
import { Paths } from "@/config/paths";
import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { ApiError, Services } from "@/services";
import {
  FEE_STRUCTURES_DETAIL_RESOURCE,
  FEE_STRUCTURES_QUERY_MODULE,
} from "@/services/modules/fee-structures/fee-structures-constant";
import { SchedulesCard } from "./schedules-card";
import { StructureHeader } from "./structure-header";

/**
 * One fee structure: its header (scope, status, actions), then its schedules. A structure the
 * API can't find says so, with a way back: the API answers 404 alike for another school's
 * structure and for one that does not exist.
 */
export function StructurePage({ structureId }: { structureId: string }) {
  const t = useTranslations("fees");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");

  const query = useQuery({
    queryKey: queryKeys.detail(
      FEE_STRUCTURES_QUERY_MODULE,
      FEE_STRUCTURES_DETAIL_RESOURCE,
      structureId,
    ),
    queryFn: () => Services.feeStructures.fetchFeeStructure(structureId),
  });
  const { data: structure, error, isPending } = query;

  if (structure) {
    return (
      <>
        <StructureHeader structure={structure} />
        <SchedulesCard structure={structure} />
      </>
    );
  }

  if (isPending) {
    return (
      <div role="status" className="space-y-4">
        <span className="sr-only">{tCommon("loading")}</span>
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error instanceof ApiError && error.isNotFound) {
    return (
      <EmptyState
        icon={Layers}
        title={t("structures.detail.notFoundTitle")}
        description={t("structures.detail.notFoundDescription")}
        action={
          <Button variant="outline" asChild>
            <Link href={Paths.FEES_STRUCTURES}>{t("structures.actions.backToList")}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <LoadErrorCard
      message={resolveErrorMessage(error, tErrors, t("structures.detail.loadError"))}
      onRetry={() => {
        void query.refetch();
      }}
    />
  );
}
