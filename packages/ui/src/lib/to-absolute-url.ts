/** Prefixes a root-relative path with the app's NEXT_PUBLIC_BASE_PATH, when set. */
export function toAbsoluteUrl(pathname: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_PATH;
  if (baseUrl && baseUrl !== "/") {
    return baseUrl + pathname;
  }
  return pathname;
}
