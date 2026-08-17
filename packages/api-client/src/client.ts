import type { ApiMeta, ApiSuccessEnvelope } from "@schoolhub/types";
import { ApiError, codeForStatus, parseErrorEnvelope } from "./errors";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type QueryValue = string | number | boolean | null | undefined | (string | number)[];
export type QueryParams = Record<string, QueryValue>;

/** Next.js fetch extensions, kept structural so this package never imports `next`. */
export interface NextFetchOptions {
  revalidate?: number | false;
  tags?: string[];
}

export interface RequestOptions {
  method?: HttpMethod;
  query?: QueryParams;
  /** Serialized as JSON unless it is a `FormData`/`Blob`/string, which is passed through. */
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Sent as `Idempotency-Key` (api-architecture.md §2.5). */
  idempotencyKey?: string;
  credentials?: RequestCredentials;
  cache?: RequestCache;
  next?: NextFetchOptions;
  /** Skip the refresh-on-401 retry (used by the refresh call itself). */
  skipAuthRefresh?: boolean;
}

/** Unwrapped success envelope plus the correlation id from `X-Request-ID`. */
export interface ApiResult<TData> {
  data: TData;
  meta: ApiMeta | undefined;
  requestId: string | null;
  status: number;
}

export interface ApiClientConfig {
  /** API root including the version segment, e.g. `https://api.example.com/api/v1`. */
  baseUrl: string;
  /** Returns the current access token, or null when unauthenticated. */
  getAccessToken?: () => string | null | Promise<string | null>;
  /**
   * Obtains a fresh access token after a 401 (the refresh token is an HttpOnly cookie,
   * so this typically POSTs `/auth/refresh` with `credentials: "include"`).
   * Return `null` to give up — the original 401 then propagates.
   */
  refreshAccessToken?: () => Promise<string | null>;
  /** Called when a request stays unauthenticated after a refresh attempt. */
  onUnauthorized?: (error: ApiError) => void;
  /** Injected for tests, or to pass a server-side fetch with cache options bound. */
  fetchImpl?: typeof fetch;
  defaultHeaders?: Record<string, string>;
}

export function buildQueryString(query: QueryParams | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else {
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

function isPassthroughBody(body: unknown): boolean {
  return (
    typeof body === "string" ||
    (typeof FormData !== "undefined" && body instanceof FormData) ||
    (typeof Blob !== "undefined" && body instanceof Blob) ||
    (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams)
  );
}

/**
 * The transport core of the SchoolHub API client.
 *
 * Responsibilities (all cross-cutting, none resource-specific):
 * envelope unwrapping · bearer auth header · single-flight refresh-on-401 with one retry ·
 * error normalization into {@link ApiError} · request-id propagation.
 */
export class ApiClient {
  private readonly config: ApiClientConfig;
  private readonly fetchImpl: typeof fetch;
  /** Shared across concurrent 401s so one refresh serves them all. */
  private refreshInFlight: Promise<string | null> | null = null;

  constructor(config: ApiClientConfig) {
    this.config = config;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  async request<TData>(path: string, options: RequestOptions = {}): Promise<ApiResult<TData>> {
    const accessToken = (await this.config.getAccessToken?.()) ?? null;
    const response = await this.send(path, options, accessToken);

    if (response.status !== 401 || options.skipAuthRefresh || !this.config.refreshAccessToken) {
      return this.toResult<TData>(response, path);
    }

    // 401 → refresh once, then replay the original request.
    const refreshed = await this.refreshOnce();
    if (!refreshed) {
      const error = await this.toApiError(response, path);
      this.config.onUnauthorized?.(error);
      throw error;
    }

    const retried = await this.send(path, options, refreshed);
    if (retried.status === 401) {
      const error = await this.toApiError(retried, path);
      this.config.onUnauthorized?.(error);
      throw error;
    }
    return this.toResult<TData>(retried, path);
  }

  get<TData>(path: string, options: Omit<RequestOptions, "method" | "body"> = {}) {
    return this.request<TData>(path, { ...options, method: "GET" });
  }

  post<TData>(path: string, body?: unknown, options: Omit<RequestOptions, "method"> = {}) {
    return this.request<TData>(path, { ...options, method: "POST", body });
  }

  put<TData>(path: string, body?: unknown, options: Omit<RequestOptions, "method"> = {}) {
    return this.request<TData>(path, { ...options, method: "PUT", body });
  }

  patch<TData>(path: string, body?: unknown, options: Omit<RequestOptions, "method"> = {}) {
    return this.request<TData>(path, { ...options, method: "PATCH", body });
  }

  delete<TData>(path: string, options: Omit<RequestOptions, "method"> = {}) {
    return this.request<TData>(path, { ...options, method: "DELETE" });
  }

  private async send(
    path: string,
    options: RequestOptions,
    accessToken: string | null,
  ): Promise<Response> {
    const url = joinUrl(this.config.baseUrl, path) + buildQueryString(options.query);
    const headers = new Headers({
      Accept: "application/json",
      ...this.config.defaultHeaders,
      ...options.headers,
    });

    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);

    let body: BodyInit | undefined;
    if (options.body !== undefined && options.method && options.method !== "GET") {
      if (isPassthroughBody(options.body)) {
        body = options.body as BodyInit;
      } else {
        body = JSON.stringify(options.body);
        if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      }
    }

    const init: RequestInit & { next?: NextFetchOptions } = {
      method: options.method ?? "GET",
      headers,
      ...(body === undefined ? {} : { body }),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.credentials ? { credentials: options.credentials } : {}),
      ...(options.cache ? { cache: options.cache } : {}),
      ...(options.next ? { next: options.next } : {}),
    };

    try {
      return await this.fetchImpl(url, init);
    } catch (cause) {
      throw new ApiError({
        code: "network_error",
        message: cause instanceof Error ? cause.message : "The request could not be sent.",
        status: 0,
        url,
        cause,
      });
    }
  }

  private async refreshOnce(): Promise<string | null> {
    this.refreshInFlight ??= (async () => {
      try {
        return (await this.config.refreshAccessToken?.()) ?? null;
      } catch {
        return null;
      } finally {
        // Cleared on the next microtask so concurrent callers all observe this attempt.
        queueMicrotask(() => {
          this.refreshInFlight = null;
        });
      }
    })();
    return this.refreshInFlight;
  }

  private async toResult<TData>(response: Response, path: string): Promise<ApiResult<TData>> {
    if (!response.ok) throw await this.toApiError(response, path);

    const requestId = response.headers.get("X-Request-ID");

    // 204 No Content, or an empty body on a 200.
    if (response.status === 204 || response.headers.get("Content-Length") === "0") {
      return { data: undefined as TData, meta: undefined, requestId, status: response.status };
    }

    const payload = await this.readJson(response, path);
    if (payload === null || typeof payload !== "object" || !("data" in payload)) {
      throw new ApiError({
        code: "server_error",
        message: "The API returned a response without a `data` envelope.",
        status: response.status,
        url: joinUrl(this.config.baseUrl, path),
        requestId,
      });
    }

    const envelope = payload as ApiSuccessEnvelope<TData>;
    return { data: envelope.data, meta: envelope.meta, requestId, status: response.status };
  }

  private async toApiError(response: Response, path: string): Promise<ApiError> {
    const url = joinUrl(this.config.baseUrl, path);
    const requestId = response.headers.get("X-Request-ID");
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const envelope = parseErrorEnvelope(payload);
    if (envelope) {
      return new ApiError({
        code: envelope.code,
        message: envelope.message,
        status: response.status,
        url,
        details: envelope.details ?? [],
        requestId: envelope.request_id || requestId,
      });
    }

    return new ApiError({
      code: codeForStatus(response.status),
      message: response.statusText || `Request failed with status ${response.status}.`,
      status: response.status,
      url,
      requestId,
    });
  }

  private async readJson(response: Response, path: string): Promise<unknown> {
    try {
      return await response.json();
    } catch (cause) {
      throw new ApiError({
        code: "server_error",
        message: "The API returned a malformed JSON response.",
        status: response.status,
        url: joinUrl(this.config.baseUrl, path),
        requestId: response.headers.get("X-Request-ID"),
        cause,
      });
    }
  }
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  return new ApiClient(config);
}
