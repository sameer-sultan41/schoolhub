import type { CustomDomainRecord, CustomDomainStatus } from "./custom-domains-type";

/** The custom domains' constants. Reads live under `WEBSITE_QUERY_MODULE` (`website-content.ts`). */

export const CUSTOM_DOMAINS_RESOURCE = "custom-domains";

/** `MAX_CUSTOM_DOMAINS` (`website_cms/constants.py`): the server refuses a sixth (`domain_limit`). */
export const CUSTOM_DOMAIN_LIMIT = 5;

/** `DOMAIN_INPUT_MAX_LENGTH`: longer input is a 400 before the name is mapped. */
export const DOMAIN_INPUT_MAX_LENGTH = 317;

/** The statuses `:verify` accepts (`VERIFIABLE`); an active domain needs no check, and the server
 * refuses a disabled one (`not_verifiable`). */
const VERIFIABLE: Readonly<Record<CustomDomainStatus, boolean>> = {
  pending_dns: true,
  verifying: true,
  failed: true,
  active: false,
  disabled: false,
};

export function isVerifiable(domain: Pick<CustomDomainRecord, "status">): boolean {
  return VERIFIABLE[domain.status];
}
