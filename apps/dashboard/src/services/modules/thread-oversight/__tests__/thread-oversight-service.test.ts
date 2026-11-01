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

const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const FILE_ID = "22222222-2222-4222-8222-222222222222";

describe("thread-oversight-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("lists the tenant's threads with the filters given, as snake_case", async () => {
    const { listThreads } = await import("../thread-oversight-service");
    mockGet.mockResolvedValue({ data: [{ id: THREAD_ID }], meta: {} });

    const page = await listThreads({ status: "closed", assignedTo: "u1", studentId: "s1" });

    expect(mockGet).toHaveBeenCalledWith("/message-thread-oversight", {
      query: { status: "closed", student_id: "s1", assigned_to: "u1", page_size: 25 },
    });
    expect(page.items).toEqual([{ id: THREAD_ID }]);
  });

  it("fetches one thread", async () => {
    const { fetchThread } = await import("../thread-oversight-service");
    mockGet.mockResolvedValue({ data: { id: THREAD_ID } });

    await expect(fetchThread(THREAD_ID)).resolves.toEqual({ id: THREAD_ID });
    expect(mockGet).toHaveBeenCalledWith(`/message-thread-oversight/${THREAD_ID}`);
  });

  it("reads the whole conversation page", async () => {
    const { listMessages } = await import("../thread-oversight-service");
    mockGet.mockResolvedValue({ data: [], meta: {} });

    await listMessages(THREAD_ID, { cursor: "c2" });

    expect(mockGet).toHaveBeenCalledWith(`/message-thread-oversight/${THREAD_ID}/messages`, {
      query: { cursor: "c2", page_size: 25 },
    });
  });

  it("asks for a signed attachment URL on the oversight twin", async () => {
    const { downloadAttachment } = await import("../thread-oversight-service");
    mockPost.mockResolvedValue({ data: { download_url: "https://files.test/a" } });

    await expect(downloadAttachment(THREAD_ID, FILE_ID)).resolves.toEqual({
      download_url: "https://files.test/a",
    });
    expect(mockPost).toHaveBeenCalledWith(
      `/message-thread-oversight/${THREAD_ID}/attachments/${FILE_ID}:download`,
    );
  });
});
