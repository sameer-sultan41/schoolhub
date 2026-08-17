import { z } from "zod";

/**
 * Renderer configuration.
 *
 * `API_BASE_URL` and `WEBSITE_MACHINE_TOKEN` are **server-only** — they are read in server
 * components, route handlers, and middleware, and must never be prefixed `NEXT_PUBLIC_` or
 * referenced from a client component. The machine token is scoped to
 * `website.public-content.view` (read-only, published content only).
 */
const envSchema = z.object({
  API_BASE_URL: z.url(),
  WEBSITE_MACHINE_TOKEN: z.string().min(1),
  /** Apex domain for tenant wildcard subdomains: `<slug>.<platform-domain>`. */
  NEXT_PUBLIC_PLATFORM_DOMAIN: z.string().min(1),
  /** ISR safety net; publish webhooks do the real invalidation. */
  CONTENT_REVALIDATE_SECONDS: z.coerce.number().int().positive().default(300),
  REVALIDATE_WEBHOOK_SECRET: z.string().min(1).optional(),
});

const parsed = envSchema.safeParse({
  API_BASE_URL: process.env.API_BASE_URL,
  WEBSITE_MACHINE_TOKEN: process.env.WEBSITE_MACHINE_TOKEN,
  NEXT_PUBLIC_PLATFORM_DOMAIN: process.env.NEXT_PUBLIC_PLATFORM_DOMAIN,
  CONTENT_REVALIDATE_SECONDS: process.env.CONTENT_REVALIDATE_SECONDS,
  REVALIDATE_WEBHOOK_SECRET: process.env.REVALIDATE_WEBHOOK_SECRET,
});

if (!parsed.success) {
  throw new Error(`Invalid website environment configuration:\n${z.prettifyError(parsed.error)}`);
}

export const env = parsed.data;

/** Subdomain labels that can never belong to a tenant. */
export const RESERVED_SUBDOMAINS = new Set([
  "www",
  "api",
  "app",
  "admin",
  "dashboard",
  "static",
  "cdn",
  "mail",
  "status",
]);
