/**
 * @schoolhub/types — shared types mirroring the SchoolHub API contract.
 *
 * A new domain's own wire types come from `ApiSchemas` (`@schoolhub/api-client`),
 * re-exported from its `services/modules/<domain>/` — see ADR-0017
 * (`docs/decisions/0017-generated-wire-types-for-new-domains.md`). This file is for
 * cross-cutting types and runtime value-arrays with no generated source.
 */
export * from "./api";
export * from "./auth";
export * from "./student";
export * from "./tenant";
export * from "./website";
