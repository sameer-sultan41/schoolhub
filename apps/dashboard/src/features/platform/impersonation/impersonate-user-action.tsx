"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";

import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { Services } from "@/services";
import { OPERATIONAL_STATUSES } from "@/services/modules/platform/platform-constant";
import { PLATFORM_KEYS } from "@/features/platform/platform-permissions";
import { tenantDetailKey } from "@/features/platform/tenants/tenant-detail";
import { ImpersonateUserDialog } from "./impersonate-user-dialog";

/**
 * "Impersonate user" on a school's page (the tenant detail's extra-actions slot): offered to an
 * operator holding `platform.tenant.impersonate`, for a school in trial, active or past due. UX
 * only; the API enforces both. Reads the school from the detail page's own cache entry.
 */
export function ImpersonateUserAction({ tenantId }: { tenantId: string }) {
  const t = useTranslations("platform.impersonation");
  const { data: user } = useCurrentUser();
  const { data: tenant } = useQuery({
    queryKey: tenantDetailKey(tenantId),
    queryFn: () => Services.platform.fetchTenant(tenantId),
  });
  const [open, setOpen] = useState(false);

  if (
    !tenant ||
    !hasPermission(user, PLATFORM_KEYS.tenantImpersonate) ||
    !(OPERATIONAL_STATUSES as readonly string[]).includes(tenant.status)
  ) {
    return null;
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t("action")}
      </Button>
      {open && <ImpersonateUserDialog tenant={tenant} open onOpenChange={setOpen} />}
    </>
  );
}
