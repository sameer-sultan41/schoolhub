import type { Page, Route } from "@playwright/test";
import {
  API_PATH_PREFIX,
  API_ROUTE_GLOB,
  DASHBOARD_AUTH_PROXY_GLOB,
  DASHBOARD_AUTH_PROXY_PATH_PREFIX,
} from "@/env";
import { type MockResponse, harnessError } from "./envelope";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface MockRequest {
  method: HttpMethod;
  /** Path with the `/api/v1` prefix stripped, e.g. `/auth/login`. */
  path: string;
  /** `:param` values captured from the route pattern. */
  params: Record<string, string>;
  searchParams: URLSearchParams;
  headers: Record<string, string>;
  // Not generic: a type parameter used only in the return position gives the caller a
  // false sense of safety — nothing here actually checks the parsed body against T. The
  // cast belongs at each call site instead, where it is visibly the caller's own claim.
  json(): unknown;
}

export type MockHandler = (request: MockRequest) => MockResponse | Promise<MockResponse>;

/** A reusable bundle of stubs for one API domain. See `./domains`. */
export type MockModule = (api: MockApi) => void;

/**
 * Runs after a stub produces a response but *before* it is delivered to the page.
 * Anything that must be true by the time the app reacts (a cookie the real API would
 * have set) belongs here — a listener on `page.on("response")` fires too late and the
 * app's next navigation races it.
 */
export type SideEffect = (request: MockRequest, response: MockResponse) => Promise<void>;

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
  private readonly sideEffects: SideEffect[] = [];
  readonly calls: RecordedCall[] = [];
  /** Requests no stub matched. Asserted empty at teardown by the `mockApi` fixture. */
  readonly unmatched: string[] = [];

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

  /** Register a side effect awaited before each response reaches the page. */
  after(effect: SideEffect): this {
    this.sideEffects.push(effect);
    return this;
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
    // Login/refresh/logout land on the dashboard's own origin — see
    // DASHBOARD_AUTH_PROXY_GLOB's doc comment in env.ts.
    await page.route(DASHBOARD_AUTH_PROXY_GLOB, (route) => this.handle(route));
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
      "access-control-allow-headers": "authorization,content-type,x-request-id,idempotency-key",
      "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    };

    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }

    const method = request.method() as HttpMethod;
    const path = url.pathname.startsWith(API_PATH_PREFIX)
      ? url.pathname.slice(API_PATH_PREFIX.length) || "/"
      : url.pathname.startsWith(DASHBOARD_AUTH_PROXY_PATH_PREFIX)
        ? url.pathname.slice(DASHBOARD_AUTH_PROXY_PATH_PREFIX.length) || "/"
        : url.pathname;

    const match = this.routes
      .filter((candidate) => candidate.method === method)
      .map((candidate) => ({ route: candidate, result: candidate.pattern.exec(path) }))
      .find(
        (entry): entry is { route: RegisteredRoute; result: RegExpExecArray } =>
          entry.result !== null,
      );

    this.calls.push({ method, path, matched: match !== undefined });

    let response: MockResponse;
    if (match) {
      const mockRequest = buildRequest(
        method,
        path,
        url,
        request.headers(),
        request.postData(),
        match,
      );
      response = await match.route.handler(mockRequest);
      // Awaited here, not in a `page.on` listener: the page must not observe the response
      // before an effect it depends on (a session cookie) has landed.
      for (const effect of this.sideEffects) await effect(mockRequest, response);
    } else {
      this.unmatched.push(`${method} ${path}`);
      // Deliberately not a 5xx: `shouldRetry` in apps/dashboard/src/lib/query-client.ts
      // retries server errors, which would turn one missing stub into three requests.
      response = harnessError(`No mock registered for ${method} ${path}`);
    }

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
    json(): unknown {
      if (!postData) return null;
      try {
        return JSON.parse(postData);
      } catch {
        return null;
      }
    },
  };
}
