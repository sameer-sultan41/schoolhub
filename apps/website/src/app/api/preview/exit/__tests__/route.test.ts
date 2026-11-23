/**
 * @jest-environment node
 *
 * next/server's NextResponse needs the real Web Response global, which jsdom does not provide.
 */
import { POST } from "../route";

describe("POST /api/preview/exit", () => {
  it("clears the token cookie and returns to the homepage", () => {
    const response = POST();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("schoolhub_preview=");
    expect(cookie).toMatch(/Max-Age=0/i);
  });
});
