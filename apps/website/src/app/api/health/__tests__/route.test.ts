/**
 * @jest-environment node
 *
 * Response.json needs the real Web Response global, which jsdom does not provide.
 */
import { GET } from "../route";

describe("GET /api/health", () => {
  it("answers 200 with an ok status", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
