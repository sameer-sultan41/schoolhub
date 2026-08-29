import type { Page, Route } from "@playwright/test";
import { API_PATH_PREFIX, API_ROUTE_GLOB } from "@/env";
import { type MockResponse, fail } from "./envelope";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface MockRequest {
  method: HttpMethod;
  /** Path with the `/api/v1` prefix stripped, e.g. `/auth/login`. */
  path: string;
  /** `:param` values captured from the route pattern. */
  params: Record<string, string>;
  searchParams: URLSearchParams;
  headers: Record<string, string>;
  json<T = unknown>(): T | null;
}

export type MockHandler = (request: MockRequest) => MockResponse | Promise<MockResponse>;

/** A reusable bundle of stubs for one API domain. See `./domains`. */
export type MockModule = (api: MockApi) => void;

export interface RecordedCall {
  method: HttpMethod;
  path: string;
  matched: boolean;
}

interface RegisteredRoute {
  method: HttpMethod;
  pattern: RegExp;
  paramNames: string[];
  handler: MockHandler;
}

/** `/schools/:id/campuses` → `^/schools/([^/]+)/campuses$` plus `["id"]`. */
function compile(path: string): { pattern: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const source = path
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name: string) => {
      paramNames.push(name);
      return "([^/]+)";
    });
  return { pattern: new RegExp(`^${source}$`), paramNames };
}

/**
 * Routes browser API traffic to in-test stubs.
 *
 * Interception happens at the browser boundary, so this covers the dashboard (which
 * fetches client-side through TanStack Query) but *not* Next.js server-side fetches.
 * Server-rendered data — the website renderer — belongs in the live lane instead.
 *
 * Anything not stubbed is answered with a `501` naming the route, so a missing stub
 * shows up as a readable failure rather than a timeout.
 */
export class MockApi {
  private readonly routes: RegisteredRoute[] = [];
  readonly calls: RecordedCall[] = [];

  on(method: HttpMethod, path: string, handler: MockHandler): this {
    const { pattern, paramNames } = compile(path);
    // Unshift so a later, more specific stub wins over an earlier catch-all.
    this.routes.unshift({ method, pattern, paramNames, handler });
    return this;
  }

  get(path: string, handler: MockHandler): this {
    return this.on("GET", path, handler);
  }
  post(path: string, handler: MockHandler): this {
    return this.on("POST", path, handler);
  }
  patch(path: string, handler: MockHandler): this {
    return this.on("PATCH", path, handler);
  }
  delete(path: string, handler: MockHandler): this {
    return this.on("DELETE", path, handler);
  }

  /** Compose domain modules: `api.use(authModule({ user }), schoolsModule())`. */
  use(...modules: MockModule[]): this {
    for (const module of modules) module(this);
    return this;
  }

  /** How many times a path was requested — for "exactly one refresh" style assertions. */
  countCalls(method: HttpMethod, path: string): number {
    const { pattern } = compile(path);
    return this.calls.filter((call) => call.method === method && pattern.test(call.path)).length;
  }

  async install(page: Page): Promise<void> {
    await page.route(API_ROUTE_GLOB, (route) => this.handle(route));
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const origin = request.headers()["origin"] ?? "*";

    // The apps call the API cross-origin with `credentials: "include"`, so a fulfilled
    // response still has to satisfy the browser's CORS check — and preflights never
    // reach a handler.
    const cors: Record<string, string> = {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "authorization,content-type,x-request-id",
      "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    };

    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }

    const method = request.method() as HttpMethod;
    const path = url.pathname.startsWith(API_PATH_PREFIX)
      ? url.pathname.slice(API_PATH_PREFIX.length) || "/"
      : url.pathname;

    const match = this.routes
      .filter((candidate) => candidate.method === method)
      .map((candidate) => ({ route: candidate, result: candidate.pattern.exec(path) }))
      .find((entry): entry is { route: RegisteredRoute; result: RegExpExecArray } => entry.result !== null);

    this.calls.push({ method, path, matched: match !== undefined });

    const response = match
      ? await match.route.handler(
          buildRequest(method, path, url, request.headers(), request.postData(), match),
        )
      : fail(500, `No mock registered for ${method} ${path}`, { code: "e2e_unstubbed_route" });

    await route.fulfill({
      status: response.status,
      headers: { "content-type": "application/json", ...cors, ...response.headers },
      body: response.body === null ? "" : JSON.stringify(response.body),
    });
  }
}

function buildRequest(
  method: HttpMethod,
  path: string,
  url: URL,
  headers: Record<string, string>,
  postData: string | null,
  match: { route: RegisteredRoute; result: RegExpExecArray },
): MockRequest {
  const params: Record<string, string> = {};
  match.route.paramNames.forEach((name, index) => {
    const value = match.result[index + 1];
    if (value !== undefined) params[name] = decodeURIComponent(value);
  });

  return {
    method,
    path,
    params,
    searchParams: url.searchParams,
    headers,
    json<T>(): T | null {
      if (!postData) return null;
      try {
        return JSON.parse(postData) as T;
      } catch {
        return null;
      }
    },
  };
}
