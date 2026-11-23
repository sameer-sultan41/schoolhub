// Holds the machine token and webhook secret: a client-component import must fail the build.
import "server-only";
import { z } from "zod";

import { RESERVED_LABELS } from "./host";

/**
 * Renderer configuration.
 *
 * Every value is **server-only** and read at runtime — read in server components, route
 * handlers, and the proxy, never given the `NEXT_PUBLIC` prefix or referenced from a client
 * component. Next inlines a prefixed value set at `next build` into server bundles too, freezing
 * one environment's value into the image promoted to the next. The machine token is scoped to
 * `website.public-content.view` (read-only, published content only).
 */
const envSchema = z.object({
  API_BASE_URL: z.url(),
  WEBSITE_MACHINE_TOKEN: z.string().min(1),
  /** Apex domain for tenant wildcard subdomains: `<slug>.<platform-domain>`. */
  PLATFORM_DOMAIN: z.string().min(1),
  /**
   * Origin the browser posts public forms to, passed to the form as a prop. Empty means
   * same-origin (a reverse proxy in front of both the renderer and the API).
   */
  API_PUBLIC_ORIGIN: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]).default(""),
  /** ISR safety net; publish webhooks do the real invalidation. */
  CONTENT_REVALIDATE_SECONDS: z.coerce.number().int().positive().default(300),
  REVALIDATE_WEBHOOK_SECRET: z.string().min(1).optional(),
});

const parsed = envSchema.safeParse({
  API_BASE_URL: process.env.API_BASE_URL,
  WEBSITE_MACHINE_TOKEN: process.env.WEBSITE_MACHINE_TOKEN,
  PLATFORM_DOMAIN: process.env.PLATFORM_DOMAIN,
  API_PUBLIC_ORIGIN: process.env.API_PUBLIC_ORIGIN,
  CONTENT_REVALIDATE_SECONDS: process.env.CONTENT_REVALIDATE_SECONDS,
  REVALIDATE_WEBHOOK_SECRET: process.env.REVALIDATE_WEBHOOK_SECRET,
});

if (!parsed.success) {
  throw new Error(`Invalid website environment configuration:\n${z.prettifyError(parsed.error)}`);
}

export const env = parsed.data;

/** Re-exported, not redeclared: `lib/host.ts` owns the one canonical list. */
export const RESERVED_SUBDOMAINS = RESERVED_LABELS;
