import type { ApiSuccessEnvelope } from "@schoolhub/types";
import { env } from "./env";

/**
 * The renderer's ONLY route to the API — and it is read-only by construction.
 *
 * There is no `post`, `patch`, or `delete` here and there must never be one: the machine
 * token is scoped to `website.public-content.view`, and a write helper would be a security
 * regression even if the API rejected it (website-builder.md §6). Public form submissions go
 * from the browser straight to the rate-limited `/api/v1/public/...` endpoints — they never
 * pass through this token.
 */

export interface ReadOptions {
  /** ISR revalidation window in seconds. Defaults to the configured safety net. */
  revalidate?: number;
  /** Cache tags for on-demand invalidation from the publish webhook. */
  tags?: string[];
  query?: Record<string, string | number | undefined>;
}

export class ContentFetchError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ContentFetchError";
    this.status = status;
  }
}

function buildUrl(path: string, query: ReadOptions["query"]): string {
  const url = new URL(
    path.startsWith("/") ? path.slice(1) : path,
    `${env.API_BASE_URL.replace(/\/+$/, "")}/`,
  );
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * GET a public-content resource as the machine client.
 *
 * @returns the unwrapped `data`, or `null` on 404 so callers can render `notFound()`
 *          instead of a 500. Any other failure throws.
 */
export async function readJson<TData>(
  path: string,
  options: ReadOptions = {},
): Promise<TData | null> {
  const response = await fetch(buildUrl(path, options.query), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${env.WEBSITE_MACHINE_TOKEN}`,
    },
    next: {
      revalidate: options.revalidate ?? env.CONTENT_REVALIDATE_SECONDS,
      ...(options.tags ? { tags: options.tags } : {}),
    },
  });

  if (response.status === 404) return null;

  if (!response.ok) {
    throw new ContentFetchError(
      `Public content request failed: ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  const payload = (await response.json()) as ApiSuccessEnvelope<TData>;
  return payload.data;
}

/** Per-tenant cache tag, so a publish event can invalidate exactly one school's pages. */
export function tenantTag(tenantId: string): string {
  return `tenant:${tenantId}`;
}

/** Per-path cache tag within a tenant. */
export function pageTag(tenantId: string, path: string): string {
  return `tenant:${tenantId}:page:${path || "/"}`;
}
