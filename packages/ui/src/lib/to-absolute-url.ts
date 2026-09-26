/**
 * Returns a root-relative asset path unchanged.
 *
 * It used to prefix `process.env.NEXT_PUBLIC_BASE_PATH`, but a shared package must not read an
 * app's environment (ADR-0014), and that variable was set nowhere — so it was already a
 * passthrough. If an app ever needs a base path, Next.js's own `basePath` config is the
 * supported mechanism. Kept (rather than inlined at its ~27 call sites, mostly Metronic demo
 * code due for removal) so those call sites don't churn.
 */
export function toAbsoluteUrl(pathname: string): string {
  return pathname;
}
