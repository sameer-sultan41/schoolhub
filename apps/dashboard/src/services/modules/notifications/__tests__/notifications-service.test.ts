import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockDownloadBlob = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: mockPost,
      put: jest.fn(),
      patch: mockPatch,
      delete: jest.fn(),
      refresh: jest.fn(),
      downloadBlob: mockDownloadBlob,
    })),
  };
});

const PAGE = {
  data: [{ id: "x1" }],
  meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 20 } },
};

describe("notifications-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDownloadBlob.mockReset();
  });

  it("listNotifications GETs the list path with only the filters given", async () => {
    const { listNotifications } = await import("../notifications-service");
    mockGet.mockResolvedValue(PAGE);

    await listNotifications({ read: false, category: "fees", pageSize: 20 });

    expect(mockGet).toHaveBeenCalledWith(
      "/notifications",
      expect.objectContaining({ query: { read: false, category: "fees", page_size: 20 } }),
    );
  });

  it("fetchNotification GETs the detail path", async () => {
    const { fetchNotification } = await import("../notifications-service");
    mockGet.mockResolvedValue({ data: { id: "n1" } });

    await fetchNotification("n1");

    expect(mockGet).toHaveBeenCalledWith("/notifications/n1");
  });

  it("fetchUnreadCount GETs the colon-action path", async () => {
    const { fetchUnreadCount } = await import("../notifications-service");
    mockGet.mockResolvedValue({ data: { unread: 3 } });

    expect(await fetchUnreadCount()).toEqual({ unread: 3 });
    expect(mockGet).toHaveBeenCalledWith("/notifications:unread-count");
  });

  it("markNotificationRead POSTs the mark-read colon-action", async () => {
    const { markNotificationRead } = await import("../notifications-service");
    mockPost.mockResolvedValue({ data: { read_at: "2026-11-05T00:00:00Z" } });

    await markNotificationRead("n1");

    expect(mockPost).toHaveBeenCalledWith("/notifications/n1:mark-read");
  });

  it("markAllNotificationsRead POSTs `before` only when given", async () => {
    const { markAllNotificationsRead } = await import("../notifications-service");
    mockPost.mockResolvedValue({ data: { marked: 2 } });

    await markAllNotificationsRead("2026-11-05T00:00:00Z");
    await markAllNotificationsRead();

    expect(mockPost).toHaveBeenNthCalledWith(1, "/notifications:mark-all-read", {
      before: "2026-11-05T00:00:00Z",
    });
    expect(mockPost).toHaveBeenNthCalledWith(2, "/notifications:mark-all-read", {});
  });
});
