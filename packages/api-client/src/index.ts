/**
 * @schoolhub/api-client — typed transport for the SchoolHub REST API.
 *
 * `schema.d.ts` is generated from apps/api/openapi.yaml — run `pnpm generate` after
 * any change to the backend's serializers. CI regenerates both and fails on a diff,
 * so the types here cannot describe a contract the server no longer speaks.
 *
 * Everything else exported below is the hand-written transport core: envelope
 * unwrapping, bearer auth, refresh-on-401 and pagination.
 */
export type { paths, components, operations } from "./schema";

/** Response body of an operation, e.g. `ApiResponse<"campuses_list">`. */
export type ApiSchemas = import("./schema").components["schemas"];

export { ApiClient, createApiClient, buildQueryString } from "./client";
export type {
  ApiClientConfig,
  ApiResult,
  HttpMethod,
  NextFetchOptions,
  QueryParams,
  QueryValue,
  RequestOptions,
} from "./client";

export { ApiError, codeForStatus, parseErrorEnvelope } from "./errors";

export {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  clampPageSize,
  collectPages,
  cursorOf,
  fetchPage,
  getNextPageParam,
  paginate,
} from "./pagination";
export type { PaginateOptions } from "./pagination";

export { createAccessTokenStore, refreshAccessToken } from "./token-store";
export type { AccessTokenStore, RefreshOptions } from "./token-store";
