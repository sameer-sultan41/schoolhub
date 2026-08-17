import { ApiError } from "@schoolhub/api-client";
import { QueryClient, defaultShouldDehydrateQuery } from "@tanstack/react-query";

/**
 * TanStack Query owns all server state (tech-stack.md §3).
 *
 * Retry policy is deliberate: a 4xx from the API is an answer, not a blip — retrying a 403 or
 * a 422 just delays the error the user needs to see. Only transport failures and 5xx retry.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (error instanceof ApiError) {
    return error.status === 0 || error.isServerError || error.isRateLimited;
  }
  return false;
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Long enough that a server-rendered payload is not refetched on hydration.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        refetchOnWindowFocus: false,
        throwOnError: false,
      },
      mutations: {
        // Never auto-retry a mutation: money and side-effecting endpoints are
        // idempotency-keyed server-side, and a blind retry can double-submit the rest.
        retry: false,
      },
      dehydrate: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === "pending",
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * One client per request on the server, one shared client in the browser — the standard
 * App Router pattern. A module-level singleton on the server would leak one tenant's data
 * into another tenant's request.
 */
export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

/**
 * Query-key factory. Keys start with the module so a mutation can invalidate a whole
 * module's cache without knowing every screen that reads it.
 */
export const queryKeys = {
  session: () => ["session"] as const,
  tenant: () => ["tenant"] as const,
  module: (module: string) => [module] as const,
  list: (module: string, resource: string, params?: Record<string, unknown>) =>
    [module, resource, "list", params ?? {}] as const,
  detail: (module: string, resource: string, id: string) =>
    [module, resource, "detail", id] as const,
};
