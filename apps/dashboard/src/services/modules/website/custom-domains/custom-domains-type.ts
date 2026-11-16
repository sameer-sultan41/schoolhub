import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). */
export type CustomDomainRecord = ApiSchemas["CustomDomain"];
export type CustomDomainStatus = ApiSchemas["CustomDomainStatusEnum"];
export type CustomDomainTlsStatus = ApiSchemas["CustomDomainTlsStatusEnum"];
export type CustomDomainErrorCode = ApiSchemas["CustomDomainErrorCodeEnum"];
export type DnsRecord = ApiSchemas["DnsRecord"];
export type CustomDomainInput = ApiSchemas["CustomDomainCreate"];
