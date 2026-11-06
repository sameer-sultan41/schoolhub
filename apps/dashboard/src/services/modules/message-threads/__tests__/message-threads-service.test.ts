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

describe("message-threads-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it("reads one inbox page with only the filters given, as snake_case", async () => {
    const { listThreads } = await import("../message-threads-service");
    mockGet.mockResolvedValue({ data: [{ id: THREAD_ID }], meta: {} });

    const page = await listThreads({ status: "open", threadType: "internal", cursor: "c1" });

    expect(mockGet).toHaveBeenCalledWith("/message-threads", {
      query: { status: "open", thread_type: "internal", cursor: "c1", page_size: 25 },
    });
    expect(page.items).toEqual([{ id: THREAD_ID }]);
  });

  it("fetches one thread", async () => {
    const { fetchThread } = await import("../message-threads-service");
    mockGet.mockResolvedValue({ data: { id: THREAD_ID } });

    await expect(fetchThread(THREAD_ID)).resolves.toEqual({ id: THREAD_ID });
    expect(mockGet).toHaveBeenCalledWith(`/message-threads/${THREAD_ID}`);
  });

  it("creates a thread with its first message", async () => {
    const { createThread } = await import("../message-threads-service");
    const body = { subject: "Trip", thread_type: "internal" as const, body: "Hi" };
    mockPost.mockResolvedValue({ data: { id: THREAD_ID } });

    await createThread(body);

    expect(mockPost).toHaveBeenCalledWith("/message-threads", body);
  });

  it("reads a thread's messages page", async () => {
    const { listMessages } = await import("../message-threads-service");
    mockGet.mockResolvedValue({ data: [], meta: {} });

    await listMessages(THREAD_ID, { cursor: "c2" });

    expect(mockGet).toHaveBeenCalledWith(`/message-threads/${THREAD_ID}/messages`, {
      query: { cursor: "c2", page_size: 25 },
    });
  });

  it("posts a reply to the thread's messages", async () => {
    const { postMessage } = await import("../message-threads-service");
    const body = { body: "Reply", is_internal_note: false };
    mockPost.mockResolvedValue({ data: { id: "m1" } });

    await postMessage(THREAD_ID, body);

    expect(mockPost).toHaveBeenCalledWith(`/message-threads/${THREAD_ID}/messages`, body);
  });

  it.each([
    ["markRead", ":mark-read"],
    ["closeThread", ":close"],
    ["reopenThread", ":reopen"],
  ] as const)("%s posts to the thread's %s colon-action", async (fn, suffix) => {
    const service = await import("../message-threads-service");
    mockPost.mockResolvedValue({ data: {} });

    await service[fn](THREAD_ID);

    expect(mockPost).toHaveBeenCalledWith(`/message-threads/${THREAD_ID}${suffix}`);
  });

  it("searches recipients, sending the term only when given", async () => {
    const { searchRecipients } = await import("../message-threads-service");
    mockGet.mockResolvedValue({ data: [{ user_id: "u1", name: "Ayesha", role: null }] });

    await expect(searchRecipients("aye")).resolves.toHaveLength(1);
    expect(mockGet).toHaveBeenCalledWith("/message-threads/recipients", {
      query: { search: "aye" },
    });

    await searchRecipients();
    expect(mockGet).toHaveBeenLastCalledWith("/message-threads/recipients", { query: undefined });
  });

  it("asks for a signed attachment URL on the colon-action", async () => {
    const { downloadAttachment } = await import("../message-threads-service");
    mockPost.mockResolvedValue({ data: { download_url: "https://files.test/a" } });

    await expect(downloadAttachment(THREAD_ID, FILE_ID)).resolves.toEqual({
      download_url: "https://files.test/a",
    });
    expect(mockPost).toHaveBeenCalledWith(
      `/message-threads/${THREAD_ID}/attachments/${FILE_ID}:download`,
    );
  });
});
