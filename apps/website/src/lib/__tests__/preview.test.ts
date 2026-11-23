import type * as ReactModule from "react";
import { cookies } from "next/headers";
import { PREVIEW_COOKIE, PREVIEW_TOKEN_MAX_LENGTH, getPreviewToken } from "../preview";

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
