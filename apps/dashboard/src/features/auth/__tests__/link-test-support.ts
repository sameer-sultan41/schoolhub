import { ApiError } from "@schoolhub/api-client";

/** Points the address bar at an emailed link, fragment included (jsdom keeps the URL between tests). */
export function openLink(url: string) {
  window.history.replaceState(null, "", url);
}

export function apiError(code: string, status: number, field?: string, issue = "Not valid.") {
  return new ApiError({
    code,
    message: `Refused: ${code}.`,
    status,
    url: "/auth/test",
    details: field ? [{ field, issue }] : [],
  });
}
