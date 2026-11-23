import type * as ReactModule from "react";
import { cookies } from "next/headers";
import {
  PREVIEW_COOKIE,
  PREVIEW_TOKEN_MAX_LENGTH,
  getPreviewToken,
  previewMaxAgeSeconds,
} from "../preview";

jest.mock("react", () => ({
  ...jest.requireActual<typeof ReactModule>("react"),
  cache: (fn: unknown) => fn,
}));
jest.mock("next/headers", () => ({ cookies: jest.fn() }));

const mockCookies = cookies as jest.MockedFunction<typeof cookies>;

function withCookie(value: string | undefined) {
  mockCookies.mockResolvedValue({
    get: (name: string) => (name === PREVIEW_COOKIE && value !== undefined ? { value } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

describe("getPreviewToken", () => {
  it("is the preview cookie's token: the cookie alone switches preview on", async () => {
    withCookie("tok-1");
    await expect(getPreviewToken()).resolves.toBe("tok-1");
  });

  it("is null without the cookie", async () => {
    withCookie(undefined);
    await expect(getPreviewToken()).resolves.toBeNull();
  });

  it("is null for an empty cookie or one too long to be a signed token", async () => {
    withCookie("");
    await expect(getPreviewToken()).resolves.toBeNull();
    withCookie("a".repeat(PREVIEW_TOKEN_MAX_LENGTH + 1));
    await expect(getPreviewToken()).resolves.toBeNull();
  });
});

describe("previewMaxAgeSeconds", () => {
  const NOW = Date.parse("2026-11-23T10:00:00Z");

  it("is the token's remaining life in whole seconds", () => {
    expect(previewMaxAgeSeconds("2026-11-23T10:05:00Z", NOW)).toBe(300);
    expect(previewMaxAgeSeconds("2026-11-23T10:00:30.900Z", NOW)).toBe(30);
  });

  it.each([
    ["already expired", "2026-11-23T09:59:00Z"],
    ["expiring this instant", "2026-11-23T10:00:00Z"],
    ["under a second left", "2026-11-23T10:00:00.500Z"],
    ["not a date", "soon"],
    ["empty", ""],
    ["missing", null],
  ])("is null (no cookie) when the token is %s", (_label, header) => {
    expect(previewMaxAgeSeconds(header, NOW)).toBeNull();
  });
});
