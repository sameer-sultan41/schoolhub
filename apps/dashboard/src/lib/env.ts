import { z } from "zod";

/**
 * Build/runtime configuration, validated once at module load.
 *
 * Only `NEXT_PUBLIC_*` values may appear here — everything sensitive stays server-side
 * (repo-structure.md §4). `process.env.X` must be referenced literally so Next can inline
 * the value at build time; a dynamic lookup would resolve to `undefined` in the browser.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.url({
    error: "NEXT_PUBLIC_API_BASE_URL must be an absolute URL, e.g. https://api.example.com/api/v1",
  }),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_DEFAULT_LOCALE: z.string().min(2).default("en"),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
});

const parsed = publicEnvSchema.safeParse({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_DEFAULT_LOCALE: process.env.NEXT_PUBLIC_DEFAULT_LOCALE,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
});

if (!parsed.success) {
  // Fail loudly at boot rather than with a confusing 404 on the first API call.
  throw new Error(
    `Invalid dashboard environment configuration:\n${z.prettifyError(parsed.error)}`,
  );
}

export const env = parsed.data;

/** Locales shipped at launch; a tenant may enable a subset (tech-stack.md §3). */
export const SUPPORTED_LOCALES = ["en", "ur"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Urdu is RTL; layouts must use logical properties so this is the only switch needed. */
export function directionFor(locale: string): "ltr" | "rtl" {
  return locale === "ur" ? "rtl" : "ltr";
}
