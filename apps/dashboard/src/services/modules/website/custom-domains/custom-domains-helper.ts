import type { CustomDomainRecord } from "./custom-domains-type";

/** Why a domain can't be made primary yet, mirroring `set_primary`'s refusals (`not_active`,
 * `tls_not_issued`); `null` when it can. The server still decides. */
export function primaryBlocker(
  domain: Pick<CustomDomainRecord, "status" | "tls_status">,
): "not_active" | "tls_not_issued" | null {
  if (domain.status !== "active") return "not_active";
  if (domain.tls_status !== "issued") return "tls_not_issued";
  return null;
}
