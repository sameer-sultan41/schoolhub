/** What a spec reads off a Playwright `Request`, which `tests/**` may not import. */
export interface RequestLike {
  method(): string;
  url(): string;
}

/** Whether `request` is a `method` call to an API path matching `path`. */
export function isApiCall(request: RequestLike, method: string, path: RegExp): boolean {
  return request.method() === method && path.test(new URL(request.url()).pathname);
}
