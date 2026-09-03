import type { AuthenticatedUser } from "@schoolhub/types";
import type { ApiResult } from "@schoolhub/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import messages from "../messages/en.json";

/** Shared render wrapper: real English messages + a retry-disabled QueryClient, matching
 * the providers every dashboard component actually renders under in production. */
export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale="en" messages={messages} now={new Date("2026-01-01")}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </NextIntlClientProvider>
    );
  }

  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}

/** Wraps `data` in the same envelope shape `apiClient`'s methods resolve to. */
export function apiResult<T>(data: T): ApiResult<T> {
  return { data, meta: undefined, requestId: null, status: 200 };
}

export function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: "u1",
    email: "admin@cityschool.test",
    phone: null,
    full_name: "Ayesha Khan",
    avatar_url: null,
    locale: "en",
    tenant_id: "t1",
    roles: [],
    permissions: [],
    ...overrides,
  };
}
