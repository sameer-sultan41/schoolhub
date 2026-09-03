/**
 * @jest-environment node
 *
 * next/server's NextRequest/NextResponse need the real Web Request/Response globals,
 * which jsdom (this project's default testEnvironment) does not provide.
 */
import { revalidateTag } from "next/cache";
import { NextRequest } from "next/server";
import { POST } from "./route";

jest.mock("next/cache", () => ({ revalidateTag: jest.fn() }));

const mockRevalidateTag = revalidateTag as jest.MockedFunction<typeof revalidateTag>;
const SECRET = "test-webhook-secret"; // matches jest.setup.ts

async function sign(body: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

function makeRequest(body: string, signature: string | null) {
  return new NextRequest("https://cityschool.schoolhub.pk/api/revalidate", {
    method: "POST",
    body,
    headers: signature ? { "x-schoolhub-signature": signature } : {},
  });
}

describe("POST /api/revalidate", () => {
  beforeEach(() => {
    mockRevalidateTag.mockReset();
  });

  it("rejects a request with no signature", async () => {
    const response = await POST(makeRequest(JSON.stringify({ tenant_id: "t1" }), null));
    expect(response.status).toBe(401);
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("rejects a request with an invalid signature", async () => {
    const response = await POST(
      makeRequest(JSON.stringify({ tenant_id: "t1" }), "sha256=deadbeef"),
    );
    expect(response.status).toBe(401);
  });

  it("rejects malformed JSON even with a valid signature", async () => {
    const body = "{not json";
    const response = await POST(makeRequest(body, await sign(body)));
    expect(response.status).toBe(400);
  });

  it("rejects a valid, signed payload with no tenant_id", async () => {
    const body = JSON.stringify({ tags: ["tenant:t1:page:/about"] });
    const response = await POST(makeRequest(body, await sign(body)));
    expect(response.status).toBe(400);
  });

  it("revalidates the tenant-wide tag for a minimal valid payload", async () => {
    const body = JSON.stringify({ tenant_id: "t1" });
    const response = await POST(makeRequest(body, await sign(body)));

    expect(response.status).toBe(200);
    expect(mockRevalidateTag).toHaveBeenCalledWith("tenant:t1", { expire: 0 });
    const payload = (await response.json()) as { data: { revalidated: string[] } };
    expect(payload.data.revalidated).toEqual(["tenant:t1"]);
  });

  it("also revalidates extra tags scoped to the signing tenant", async () => {
    const body = JSON.stringify({ tenant_id: "t1", tags: ["tenant:t1:page:/about"] });
    const response = await POST(makeRequest(body, await sign(body)));

    expect(response.status).toBe(200);
    expect(mockRevalidateTag).toHaveBeenCalledWith("tenant:t1:page:/about", { expire: 0 });
  });

  it("never revalidates a tag belonging to another tenant", async () => {
    const body = JSON.stringify({ tenant_id: "t1", tags: ["tenant:t2:page:/about"] });
    const response = await POST(makeRequest(body, await sign(body)));

    expect(response.status).toBe(200);
    expect(mockRevalidateTag).toHaveBeenCalledTimes(1);
    expect(mockRevalidateTag).toHaveBeenCalledWith("tenant:t1", { expire: 0 });
  });
});
