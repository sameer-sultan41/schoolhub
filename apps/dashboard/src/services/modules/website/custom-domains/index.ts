import {
  createCustomDomain,
  deleteCustomDomain,
  fetchCustomDomains,
  setPrimaryCustomDomain,
  verifyCustomDomain,
} from "./custom-domains-service";

export const CustomDomainsService = {
  fetchCustomDomains,
  createCustomDomain,
  verifyCustomDomain,
  setPrimaryCustomDomain,
  deleteCustomDomain,
};
export type {
  CustomDomainErrorCode,
  CustomDomainInput,
  CustomDomainRecord,
  CustomDomainStatus,
  CustomDomainTlsStatus,
  DnsRecord,
} from "./custom-domains-type";
