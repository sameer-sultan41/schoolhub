import type { CustomDomainErrorCode, CustomDomainStatus, CustomDomainTlsStatus } from "@/services";

/** Label and badge maps for a domain's states, keyed under `website.domains` (L32): exhaustive,
 * so a new enum member fails the compile until it has wording. */

export const DOMAIN_STATUS_LABEL_KEY: Readonly<Record<CustomDomainStatus, string>> = {
  pending_dns: "status.pending_dns",
  verifying: "status.verifying",
  active: "status.active",
  failed: "status.failed",
  disabled: "status.disabled",
};

export const DOMAIN_STATUS_BADGE: Readonly<
  Record<CustomDomainStatus, "secondary" | "info" | "success" | "destructive" | "warning">
> = {
  pending_dns: "secondary",
  verifying: "info",
  active: "success",
  failed: "destructive",
  disabled: "warning",
};

export const TLS_STATUS_LABEL_KEY: Readonly<Record<CustomDomainTlsStatus, string>> = {
  pending: "tls.pending",
  issued: "tls.issued",
  failed: "tls.failed",
};

export const TLS_STATUS_BADGE: Readonly<
  Record<CustomDomainTlsStatus, "secondary" | "success" | "destructive">
> = {
  pending: "secondary",
  issued: "success",
  failed: "destructive",
};

/** What the last DNS check found, in the viewer's language; the server's `last_error` prose is
 * the fallback for a code the map does not know yet. */
export const DOMAIN_ERROR_KEY: Readonly<Record<CustomDomainErrorCode, string>> = {
  txt_missing: "errors.txt_missing",
  txt_mismatch: "errors.txt_mismatch",
  cname_missing: "errors.cname_missing",
  cname_mismatch: "errors.cname_mismatch",
  lookup_timeout: "errors.lookup_timeout",
  lookup_failed: "errors.lookup_failed",
  domain_taken: "errors.domain_taken",
  target_unconfigured: "errors.target_unconfigured",
};

/** `website.reasons.domains.*`: a domain refusal's own wording (`withReasonText` scope). */
export const DOMAIN_REASON_SCOPE = "domains";
