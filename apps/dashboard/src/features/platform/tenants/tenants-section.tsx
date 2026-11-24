"use client";

import { Suspense } from "react";
import { useTranslations } from "next-intl";

import { SectionToolbar } from "@/components/section-toolbar";
import { PLATFORM_KEYS } from "@/features/platform/platform-permissions";
import { TenantFormDialog } from "./tenant-form-dialog";
import { TenantsTable } from "./tenants-table";

/** Every school as one unit: title, New school (creating is part of provisioning, so it needs
 * `platform.tenant.provision`), and the list. The table reads the URL, so it sits in a Suspense
 * boundary. */
export function TenantsSection() {
  const t = useTranslations("platform");
  return (
    <div className="space-y-5">
      <SectionToolbar
        title={t("tenants.title")}
        description={t("tenants.summary")}
        addLabel={t("tenants.create")}
        createKey={PLATFORM_KEYS.tenantProvision}
        renderAddDialog={(onOpenChange) => <TenantFormDialog open onOpenChange={onOpenChange} />}
      />
      <Suspense>
        <TenantsTable />
      </Suspense>
    </div>
  );
}
