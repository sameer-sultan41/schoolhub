/**
 * The `@/services` mock a feature's tests share: `Services.<domain>.<function>` as `jest.fn()`s,
 * and the real `ApiError` and `FileUploadError`. A `jest.mock` factory can't reference an
 * import, so a feature wraps this in its own `<feature>-services-mock.ts`, which each test
 * file reaches through `jest.requireActual`; this must not import `@/services` (that would
 * re-enter the mock).
 */
export function servicesMock(domains: Record<string, readonly string[]>) {
  return {
    ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
    FileUploadError: jest.requireActual<{ FileUploadError: unknown }>(
      "@/services/modules/files/files-errors",
    ).FileUploadError,
    Services: Object.fromEntries(
      Object.entries(domains).map(([domain, functions]) => [
        domain,
        Object.fromEntries(functions.map((name) => [name, jest.fn()])),
      ]),
    ),
  };
}
