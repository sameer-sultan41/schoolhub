/**
 * @jest-environment node
 *
 * next/server's NextResponse needs the real Web Response global, which jsdom does not provide.
 */
import { draftMode } from "next/headers";
import { POST } from "../route";

jest.mock("next/headers", () => ({ draftMode: jest.fn(), cookies: jest.fn() }));

const mockDraftMode = draftMode as jest.MockedFunction<typeof draftMode>;

describe("POST /api/preview/exit", () => {
  it("disables Draft Mode, clears the token cookie and returns to the homepage", async () => {
    const disable = jest.fn();
    mockDraftMode.mockResolvedValue({ disable } as unknown as Awaited<
      ReturnType<typeof draftMode>
    >);

    const response = await POST();

    expect(disable).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("schoolhub_preview=");
    expect(cookie).toMatch(/Max-Age=0/i);
  });
});
