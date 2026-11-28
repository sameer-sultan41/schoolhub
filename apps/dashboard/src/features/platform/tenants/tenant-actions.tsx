"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { PermissionKey } from "@schoolhub/types";
import { Button } from "@schoolhub/ui";

import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import type { TenantRecord, TenantStatus } from "@/services";
import { PLATFORM_KEYS } from "@/features/platform/platform-permissions";
import { DeleteTenantDialog } from "./delete-tenant-dialog";
import { ProvisionDialog } from "./provision-dialog";
import { ReinstateDialog } from "./reinstate-dialog";
import { TenantFormDialog } from "./tenant-form-dialog";
import { TenantReasonDialog } from "./tenant-reason-dialog";

type TenantDialog = "edit" | "provision" | "suspend" | "reinstate" | "delete" | "restore";

interface ActionSpec {
  dialog: TenantDialog;
  /** The key the API gates the action on (`tenants/viewset.py`'s `required_permission_map`). */
  permission: PermissionKey;
  /** The statuses the lifecycle allows the action from (platform-admin.md §7.4); the server
   * refuses every other with 409 `invalid_transition`. */
  from: readonly TenantStatus[];
  variant?: "outline" | "destructive";
}

const ACTIONS: readonly ActionSpec[] = [
  {
    dialog: "edit",
    permission: PLATFORM_KEYS.tenantUpdate,
    from: ["provisioning", "trial", "active", "past_due", "suspended"],
    variant: "outline",
  },
  { dialog: "provision", permission: PLATFORM_KEYS.tenantProvision, from: ["provisioning"] },
  {
    dialog: "suspend",
    permission: PLATFORM_KEYS.tenantSuspend,
    from: ["trial", "active", "past_due"],
    variant: "destructive",
  },
  { dialog: "reinstate", permission: PLATFORM_KEYS.tenantReinstate, from: ["suspended"] },
  {
    dialog: "delete",
    permission: PLATFORM_KEYS.tenantDelete,
    from: ["provisioning", "active", "suspended"],
    variant: "destructive",
  },
  { dialog: "restore", permission: PLATFORM_KEYS.tenantDelete, from: ["deprovisioned"] },
];

/** Whether a deprovisioned school's retention window is still open (`:restore` refuses after
 * it with 409 `retention_expired`). */
function canStillRestore(tenant: TenantRecord, now: number): boolean {
  return tenant.deprovision_after !== null && Date.parse(tenant.deprovision_after) > now;
}

/**
 * A school's lifecycle actions, each shown only where the lifecycle allows it from the school's
 * status and the viewer holds its exact key; UX only, the API enforces both. `children` is a slot
 * after the built-in actions (the page puts impersonation there). Each dialog is mounted only while
 * open, so it starts fresh with a new `Idempotency-Key`.
 */
export function TenantActions({
  tenant,
  children,
}: {
  tenant: TenantRecord;
  children?: ReactNode;
}) {
  const t = useTranslations("platform");
  const { data: user } = useCurrentUser();
  const [dialog, setDialog] = useState<TenantDialog | null>(null);
  const [now] = useState(() => Date.now());

  const visible = ACTIONS.filter(
    (action) =>
      action.from.includes(tenant.status) &&
      hasPermission(user, action.permission) &&
      (action.dialog !== "restore" || canStillRestore(tenant, now)),
  );
  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {visible.map((action) => (
          <Button
            key={action.dialog}
            variant={action.variant ?? "primary"}
            onClick={() => {
              setDialog(action.dialog);
            }}
          >
            {t(`lifecycle.${action.dialog}.action`)}
          </Button>
        ))}
        {children}
      </div>
      {dialog === "edit" && <TenantFormDialog open onOpenChange={close} tenant={tenant} />}
      {dialog === "provision" && <ProvisionDialog open onOpenChange={close} tenant={tenant} />}
      {(dialog === "suspend" || dialog === "restore") && (
        <TenantReasonDialog action={dialog} open onOpenChange={close} tenant={tenant} />
      )}
      {dialog === "reinstate" && <ReinstateDialog open onOpenChange={close} tenant={tenant} />}
      {dialog === "delete" && <DeleteTenantDialog open onOpenChange={close} tenant={tenant} />}
    </>
  );
}
