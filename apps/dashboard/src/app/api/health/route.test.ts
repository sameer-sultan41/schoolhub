/**
 * @jest-environment node
 *
 * NextResponse.json() needs the real Web Response global, absent under jsdom.
 */
import { GET } from "./route";

describe("GET /api/health", () => {
  it("reports ok with no caching", async () => {
    const response = GET();
    const body = (await response.json()) as { data: { status: string; app: string } };

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.data.status).toBe("ok");
    expect(body.data.app).toBe("dashboard");
  });

  it("includes an ISO timestamp", async () => {
    const response = GET();
    const body = (await response.json()) as { data: { time: string } };

    expect(() => new Date(body.data.time).toISOString()).not.toThrow();
  });
});
