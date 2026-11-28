"use client";

import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";

import { FilterSelect } from "@/components/filter-select";
import { FormSelectField } from "@/components/form-select-field";
import { SearchInput } from "@/components/search-input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants";
import { humanizeSnakeCase } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  PLATFORM_QUERY_MODULE,
  TENANT_USER_PICKER_PAGE_SIZE,
  TENANT_USERS_RESOURCE,
} from "@/services/modules/platform/platform-constant";
import type { ImpersonateFormValues } from "@/services/modules/platform/platform.schema";

/**
 * Whom to act as: the school's users the console may impersonate (`GET .../users?q=&role=`),
 * narrowed by a search and a role, then picked. The picked user stays an option while the search
 * changes, so the select never blanks itself.
 */
export function TenantUserField({
  form,
  tenantId,
}: {
  form: UseFormReturn<ImpersonateFormValues>;
  tenantId: string;
}) {
  const t = useTranslations("platform.impersonation");
  const tFilters = useTranslations("platform.filters");
  const [searchInput, setSearchInput] = useState("");
  const [role, setRole] = useState("");
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const q = useDebouncedValue(searchInput.trim(), SEARCH_DEBOUNCE_MS);

  const users = useQuery({
    queryKey: queryKeys.list(PLATFORM_QUERY_MODULE, TENANT_USERS_RESOURCE, { tenantId, q, role }),
    queryFn: () =>
      Services.platform.fetchTenantUsers(tenantId, {
        q,
        role,
        pageSize: TENANT_USER_PICKER_PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });

  const options = useMemo(() => {
    const found = (users.data?.items ?? []).map((user) => ({
      id: user.id,
      name: t("userOption", { name: user.name, email: user.email }),
    }));
    return picked && !found.some((option) => option.id === picked.id) ? [picked, ...found] : found;
  }, [users.data, picked, t]);

  // The roles the listed users hold, plus the one filtered on: there is no role list to ask for.
  const roles = useMemo(() => {
    const slugs = new Set((users.data?.items ?? []).flatMap((user) => user.roles));
    if (role) slugs.add(role);
    return [...slugs].sort().map((slug) => ({ id: slug, name: humanizeSnakeCase(slug) }));
  }, [users.data, role]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          ariaLabel={t("search")}
          placeholder={t("searchPlaceholder")}
          clearLabel={tFilters("clearSearch")}
        />
        <FilterSelect
          label={t("role")}
          allLabel={t("allRoles")}
          value={role}
          onChange={setRole}
          options={roles}
        />
      </div>
      <FormSelectField
        form={form}
        name="user_id"
        label={t("user")}
        placeholder={users.isPending ? t("loadingUsers") : t("userPlaceholder")}
        options={options}
        onPick={(id) => {
          setPicked(options.find((option) => option.id === id) ?? null);
        }}
        description={users.isError ? t("usersLoadError") : undefined}
      />
    </div>
  );
}
