/**
 * @schoolhub/types — shared types mirroring the SchoolHub API contract.
 *
 * The API-shaped types here are hand-maintained only until the OpenAPI generator lands
 * (see `packages/api-client/README.md`); the envelope, error, and pagination primitives
 * in `./api` are cross-cutting and stay hand-written.
 */
export * from "./api";
export * from "./auth";
export * from "./tenant";
export * from "./website";
