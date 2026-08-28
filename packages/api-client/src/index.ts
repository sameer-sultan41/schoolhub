/**
 * @schoolhub/api-client — typed transport for the SchoolHub REST API.
 *
 * The resource layer (`students.list()`, `feeInvoices.create()`, …) is GENERATED from the
 * backend's OpenAPI 3.1 spec — see README.md. Everything exported here is the hand-written
 * transport core the generated code sits on.
 */
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
