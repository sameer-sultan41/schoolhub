import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: mockPost,
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      refresh: jest.fn(),
    })),
  };
});

const REQUEST = {
  audience_type: "staff" as const,
  message: "School closed today",
};

describe("broadcasts-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("reads the sender's scope with a GET on the colon-action", async () => {
    const { fetchScope } = await import("../broadcasts-service");
    const scope = { campus_ids: ["33333333-3333-4333-8333-333333333333"] };
    mockGet.mockResolvedValue({ data: scope });

    await expect(fetchScope()).resolves.toEqual(scope);
    expect(mockGet).toHaveBeenCalledWith("/broadcasts:scope");
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("previews on the colon-action and returns the preview", async () => {
    const { preview } = await import("../broadcasts-service");
    const result = {
      recipient_count: 3,
      audience_digest: "d",
      channels: [],
      unavailable_channels: [],
    };
    mockPost.mockResolvedValue({ data: result });

    await expect(preview(REQUEST)).resolves.toEqual(result);
    expect(mockPost).toHaveBeenCalledWith("/broadcasts:preview", REQUEST);
  });

  it("sends on the emergency colon-action with the idempotency key", async () => {
    const { send } = await import("../broadcasts-service");
    const body = { ...REQUEST, confirm_recipient_count: 3, audience_digest: "d" };
    mockPost.mockResolvedValue({ data: { job_id: "j1", status: "queued" } });

    await expect(send(body, "key-1")).resolves.toEqual({ job_id: "j1", status: "queued" });
    expect(mockPost).toHaveBeenCalledWith(
      "/broadcasts:emergency",
      body,
      expect.objectContaining({ idempotencyKey: "key-1" }),
    );
  });
});
